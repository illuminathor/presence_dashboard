import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  addUser, createSession, destroySession, MIN_PASSWORD, SESSION_SECONDS, setPassword, userFromToken, verifyPassword, type User,
} from './auth.js'
import { bus } from './bus.js'
import type { Db } from './db.js'
import { getBuckets, getHeatmap, getSummary, getTimeline, getDebounceSeconds, setDebounceSeconds, MAX_DEBOUNCE_S } from './metrics.js'
import type { MqttManager } from './mqttManager.js'
import { runTest } from './tester.js'

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg) } }
const bad = (msg: string) => new HttpError(400, msg)

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
}

interface TestState { id: string; status: 'running' | 'done' | 'failed'; steps: unknown[]; sample_messages: unknown[]; at: number }

export function createApp(db: Db, mqttMgr: MqttManager, webDir: string) {
  const webRoot = resolve(webDir)
  const tests = new Map<string, TestState>()
  const fails = new Map<string, { n: number; until: number }>()

  const clientIp = (req: IncomingMessage) => {
    const ra = req.socket.remoteAddress ?? ''
    const loop = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1'
    return loop ? String(req.headers['x-forwarded-for'] ?? ra).split(',')[0].trim() : ra
  }
  const cookies = (req: IncomingMessage) => Object.fromEntries(
    String(req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]))
  const secure = (req: IncomingMessage) => req.headers['x-forwarded-proto'] === 'https'
  const setCookie = (req: IncomingMessage, res: ServerResponse, value: string, maxAge: number) =>
    res.setHeader('Set-Cookie', `sid=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`)

  const send = (res: ServerResponse, status: number, body: unknown) => {
    const s = JSON.stringify(body ?? null)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(s)
  }
  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    // Wajib JSON: form lintas-situs tidak bisa mengirim Content-Type ini tanpa preflight (proteksi CSRF).
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw bad('Content-Type harus application/json')
    let size = 0; const chunks: Buffer[] = []
    for await (const c of req) { size += c.length; if (size > 100_000) throw bad('Body terlalu besar'); chunks.push(c) }
    try { const v = JSON.parse(Buffer.concat(chunks).toString() || '{}'); if (v && typeof v === 'object') return v } catch { /* jatuh ke error */ }
    throw bad('JSON tidak valid')
  }
  const num = (v: string | null, name: string) => { const n = Number(v); if (!Number.isFinite(n)) throw bad(`${name} tidak valid`); return n }
  const str = (v: unknown, name: string, max = 200) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw bad(`${name} tidak valid`); return v.trim() }

  async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
    const method = req.method ?? 'GET'
    const path = url.pathname.slice(4) // buang "/api"
    const q = url.searchParams

    // ── tanpa login ──
    if (method === 'POST' && path === '/login') {
      const body = await readJson(req)
      const ip = clientIp(req)
      const f = fails.get(ip)
      if (f && f.n >= 10 && f.until > Date.now()) throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.')
      const email = typeof body.email === 'string' ? body.email.trim() : ''
      const row = db.prepare('select id, email, role, password_hash from users where email = ?').get(email) as (User & { password_hash: string }) | undefined
      const ok = await verifyPassword(typeof body.password === 'string' ? body.password : '', row?.password_hash ?? null)
      if (!ok || !row) {
        fails.set(ip, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 10 * 60_000 })
        throw new HttpError(401, 'Email atau password salah.')
      }
      fails.delete(ip)
      setCookie(req, res, createSession(db, row.id), SESSION_SECONDS)
      return send(res, 200, { id: row.id, email: row.email, role: row.role })
    }

    const token = cookies(req).sid
    const user = userFromToken(db, token)
    if (method === 'POST' && path === '/logout') {
      if (token) destroySession(db, token)
      setCookie(req, res, '', 0)
      return send(res, 200, { ok: true })
    }
    if (!user) throw new HttpError(401, 'Belum login')
    const admin = () => { if (user.role !== 'admin') throw new HttpError(403, 'Khusus admin') }

    if (method === 'GET' && path === '/me') return send(res, 200, user)

    // ── data dashboard ──
    if (method === 'GET' && path === '/devices') {
      return send(res, 200, db.prepare('select device_id, room_name from devices order by device_id').all())
    }
    let m = path.match(/^\/devices\/([^/]+)$/)
    if (m && method === 'PATCH') {
      admin()
      const body = await readJson(req)
      const name = typeof body.room_name === 'string' && body.room_name.trim() ? body.room_name.trim().slice(0, 100) : null
      db.prepare('update devices set room_name = ? where device_id = ?').run(name, decodeURIComponent(m[1]))
      return send(res, 200, { ok: true })
    }
    m = path.match(/^\/devices\/([^/]+)\/status$/)
    if (m && method === 'GET') {
      const r = db.prepare('select device_id, current_status, since, online, last_seen from device_status where device_id = ?').get(decodeURIComponent(m[1])) as
        { device_id: string; current_status: string | null; since: number | null; online: number; last_seen: number | null } | undefined
      if (!r) return send(res, 200, null)
      return send(res, 200, {
        device_id: r.device_id, current_status: r.current_status, online: r.online === 1,
        since: r.since === null ? null : new Date(r.since).toISOString(),
        last_seen: r.last_seen === null ? null : new Date(r.last_seen).toISOString(),
      })
    }
    if (method === 'GET' && path === '/dashboard') {
      const device = str(q.get('device'), 'device'), from = num(q.get('from'), 'from'), to = num(q.get('to'), 'to'), bucket = num(q.get('bucket'), 'bucket')
      if (to <= from) throw bad('Rentang waktu tidak valid')
      let buckets
      try { buckets = getBuckets(db, device, from, to, bucket) } catch (e) { throw bad((e as Error).message) }
      return send(res, 200, { summary: getSummary(db, device, from, to), segments: getTimeline(db, device, from, to), buckets })
    }
    if (method === 'GET' && path === '/heatmap') {
      return send(res, 200, getHeatmap(db, str(q.get('device'), 'device')))
    }
    if (method === 'GET' && path === '/events') {
      const device = str(q.get('device'), 'device'), from = num(q.get('from'), 'from'), to = num(q.get('to'), 'to')
      const limit = Math.min(Math.max(num(q.get('limit') ?? '100', 'limit'), 1), 1000), offset = Math.max(num(q.get('offset') ?? '0', 'offset'), 0)
      const rows = db.prepare(`select id, ts, status, is_transition, ts_suspect from events where device_id = ? and ts >= ? and ts < ?
        order by ts desc, id desc limit ? offset ?`).all(device, from, to, limit, offset) as unknown as
        { id: number; ts: number; status: string; is_transition: number; ts_suspect: number }[]
      return send(res, 200, rows.map((r) => ({ id: r.id, ts: new Date(r.ts).toISOString(), status: r.status, is_transition: r.is_transition === 1, ts_suspect: r.ts_suspect === 1 })))
    }
    if (method === 'GET' && path === '/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
      res.write('retry: 5000\n\n')
      const onChange = (device: string) => res.write(`data: ${JSON.stringify({ device })}\n\n`)
      bus.on('change', onChange)
      const hb = setInterval(() => res.write(': ping\n\n'), 25_000)
      req.on('close', () => { bus.off('change', onChange); clearInterval(hb) })
      return
    }

    // ── pengaturan umum (admin) ──
    if (path === '/settings') {
      admin()
      if (method === 'GET') return send(res, 200, { debounce_seconds: getDebounceSeconds(db) })
      if (method === 'PUT') {
        const b = await readJson(req)
        const n = Number(b.debounce_seconds)
        if (!Number.isInteger(n) || n < 0 || n > MAX_DEBOUNCE_S) throw bad(`Debounce harus bilangan bulat 0–${MAX_DEBOUNCE_S} detik`)
        setDebounceSeconds(db, n)
        return send(res, 200, { debounce_seconds: n })
      }
    }

    // ── konfigurasi MQTT (admin) ──
    if (path.startsWith('/mqtt')) {
      admin()
      if (method === 'GET' && path === '/mqtt/config') {
        const c = mqttMgr.readConfig()
        return send(res, 200, c && { host: c.host, port: c.port, protocol: c.protocol, username: c.username, has_password: Boolean(c.password), topic_status: c.topic_status, topic_online: c.topic_online })
      }
      if (method === 'GET' && path === '/mqtt/status') return send(res, 200, mqttMgr.status())
      if (method === 'PUT' && path === '/mqtt/config') {
        const b = await readJson(req)
        const port = Number(b.port)
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw bad('Port tidak valid')
        if (!['mqtt', 'mqtts', 'ws', 'wss'].includes(String(b.protocol))) throw bad('Protokol tidak valid')
        const old = mqttMgr.readConfig()
        const pw = typeof b.password === 'string' && b.password !== '' ? b.password : (old?.password ?? null) // kosong = pakai yang lama
        db.prepare(`insert into mqtt_config (id, host, port, protocol, username, password, topic_status, topic_online, updated_at) values (1,?,?,?,?,?,?,?,?)
          on conflict (id) do update set host=excluded.host, port=excluded.port, protocol=excluded.protocol, username=excluded.username,
            password=excluded.password, topic_status=excluded.topic_status, topic_online=excluded.topic_online, updated_at=excluded.updated_at`)
          .run(str(b.host, 'Host'), port, String(b.protocol), typeof b.username === 'string' && b.username.trim() ? b.username.trim() : null, pw,
            str(b.topic_status, 'Topic status'), typeof b.topic_online === 'string' && b.topic_online.trim() ? b.topic_online.trim() : null, Date.now())
        return send(res, 200, await mqttMgr.apply(true))
      }
      if (method === 'POST' && path === '/mqtt/test') {
        const b = await readJson(req)
        const port = Number(b.port)
        if (!str(b.host, 'Host') || !Number.isInteger(port) || !['mqtt', 'mqtts', 'ws', 'wss'].includes(String(b.protocol)) || !str(b.topic_status, 'Topic status')) throw bad('Form belum lengkap')
        const old = mqttMgr.readConfig()
        const pw = typeof b.password === 'string' && b.password !== '' ? b.password : (old?.password ?? null)
        const id = randomBytes(8).toString('hex')
        const st: TestState = { id, status: 'running', steps: [], sample_messages: [], at: Date.now() }
        tests.set(id, st)
        for (const [k, v] of tests) if (Date.now() - v.at > 10 * 60_000) tests.delete(k)
        void runTest({
          host: String(b.host).trim(), port, protocol: b.protocol as 'mqtt', username: typeof b.username === 'string' ? b.username.trim() || null : null, password: pw,
          topic_status: String(b.topic_status).trim(), topic_online: typeof b.topic_online === 'string' ? b.topic_online.trim() || null : null,
        }, (status, steps, samples) => { st.status = status; st.steps = steps; st.sample_messages = samples })
          .catch(() => { st.status = 'failed' })
        return send(res, 200, { id })
      }
      m = path.match(/^\/mqtt\/test\/([a-f0-9]+)$/)
      if (m && method === 'GET') {
        const t = tests.get(m[1]); if (!t) throw new HttpError(404, 'Tes tidak ditemukan')
        return send(res, 200, t)
      }
    }

    // ── manajemen user (admin) ──
    if (path.startsWith('/users')) {
      admin()
      if (method === 'GET' && path === '/users') return send(res, 200, db.prepare('select id, email, role, created_at from users order by id').all())
      if (method === 'POST' && path === '/users') {
        const b = await readJson(req)
        const email = str(b.email, 'Email'), pw = str(b.password, 'Password', 200)
        if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('Email tidak valid')
        if (pw.length < MIN_PASSWORD) throw bad(`Password minimal ${MIN_PASSWORD} karakter`)
        try { return send(res, 201, await addUser(db, email, pw, b.role === 'admin' ? 'admin' : 'viewer')) }
        catch (e) { throw (e as Error).message.includes('UNIQUE') ? new HttpError(409, 'Email sudah terdaftar') : e }
      }
      m = path.match(/^\/users\/(\d+)$/)
      if (m) {
        const id = Number(m[1])
        const target = db.prepare('select id, role from users where id = ?').get(id) as { id: number; role: string } | undefined
        if (!target) throw new HttpError(404, 'User tidak ditemukan')
        const otherAdmins = (db.prepare("select count(*) as n from users where role = 'admin' and id <> ?").get(id) as { n: number }).n
        if (method === 'DELETE') {
          if (id === user.id) throw bad('Tidak bisa menghapus akun sendiri')
          db.prepare('delete from users where id = ?').run(id)
          return send(res, 200, { ok: true })
        }
        if (method === 'PATCH') {
          const b = await readJson(req)
          if (b.role !== undefined) {
            if (b.role !== 'admin' && b.role !== 'viewer') throw bad('Role tidak valid')
            if (b.role === 'viewer' && target.role === 'admin' && otherAdmins === 0) throw bad('Harus ada minimal satu admin')
            db.prepare('update users set role = ? where id = ?').run(b.role, id)
          }
          if (b.password !== undefined) {
            const pw = str(b.password, 'Password')
            if (pw.length < MIN_PASSWORD) throw bad(`Password minimal ${MIN_PASSWORD} karakter`)
            await setPassword(db, id, pw)
          }
          return send(res, 200, { ok: true })
        }
      }
    }
    if (method === 'POST' && path === '/me/password') {
      const b = await readJson(req)
      const row = db.prepare('select password_hash from users where id = ?').get(user.id) as { password_hash: string }
      if (!(await verifyPassword(typeof b.current === 'string' ? b.current : '', row.password_hash))) throw bad('Password saat ini salah')
      const pw = str(b.password, 'Password baru')
      if (pw.length < MIN_PASSWORD) throw bad(`Password minimal ${MIN_PASSWORD} karakter`)
      await setPassword(db, user.id, pw)
      setCookie(req, res, createSession(db, user.id), SESSION_SECONDS) // sesi lain sudah dicabut; sesi ini diganti baru
      return send(res, 200, { ok: true })
    }
    throw new HttpError(404, 'Tidak ditemukan')
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
    let file = normalize(join(webRoot, decodeURIComponent(pathname)))
    if (file !== webRoot && !file.startsWith(webRoot + sep)) { res.writeHead(403).end(); return }
    let spa = false
    if (!existsSync(file) || statSync(file).isDirectory()) { file = join(webRoot, 'index.html'); spa = true }
    if (!existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Web belum di-build (jalankan: npm run build di folder web).'); return }
    const html = spa || file.endsWith('index.html')
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': html ? 'no-cache' : 'public, max-age=31536000, immutable',
    })
    if (req.method === 'HEAD') return void res.end()
    createReadStream(file).pipe(res)
  }

  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    if (url.pathname.startsWith('/api/')) {
      api(req, res, url).catch((e) => {
        if (res.headersSent) return res.end()
        if (e instanceof HttpError) return send(res, e.status, { error: e.message })
        console.error(new Date().toISOString(), 'error API:', e)
        send(res, 500, { error: 'Terjadi kesalahan di server' })
      })
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      try { serveStatic(req, res, url.pathname) } catch { res.writeHead(400).end() }
    } else res.writeHead(405).end()
  })
}
