import mqtt, { type MqttClient } from 'mqtt'
import { brokerUrl, cfgKey, connectOpts, stableClientId, type MqttCfg } from './config.js'
import { del, patch, PermanentError, rpc, select } from './db.js'
import { deviceIdFromTopic, parseOnlinePayload, parseStatusPayload, topicMatches } from './parse.js'
import { DiskQueue } from './queue.js'
import { runTest } from './tester.js'

if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('Env SUPABASE_URL dan SUPABASE_SECRET_KEY wajib diisi'); process.exit(1)
}
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const queue = new DiskQueue(process.env.QUEUE_FILE ?? './data/queue.jsonl')
const CONFIG_POLL_MS = 5_000
const TEST_POLL_MS = 2_000

// ───────── status yang dilaporkan ke ingest_status ─────────
const st = {
  state: 'unconfigured' as 'unconfigured' | 'connected' | 'reconnecting' | 'error',
  lastError: null as string | null,
  lastMessageAt: null as string | null,
  msgCount: 0, invalidCount: 0,
  devices: new Set<string>(),
  recent: [] as unknown[],
  dirty: true,
}
const touch = () => { st.dirty = true }
function note(topic: string, payload: string, ok: boolean, reason?: string) {
  st.recent.unshift({ t: new Date().toISOString(), topic, payload: payload.slice(0, 300), ok, reason })
  st.recent.length = Math.min(st.recent.length, 10)
  st.lastMessageAt = new Date().toISOString()
  ok ? st.msgCount++ : st.invalidCount++
  touch()
}
async function flushStatus(force = false) {
  if (!st.dirty && !force) return
  st.dirty = false
  try {
    await patch('ingest_status', 'id=eq.1', {
      state: st.state, last_error: st.lastError, last_message_at: st.lastMessageAt,
      msg_count: st.msgCount, invalid_count: st.invalidCount,
      devices: [...st.devices], recent: st.recent, updated_at: new Date().toISOString(),
    })
  } catch (e) { st.dirty = true; log('gagal update ingest_status:', (e as Error).message) }
}

// ───────── MQTT ─────────
let current: { client: MqttClient; cfg: MqttCfg; key: string } | null = null

function handleMessage(cfg: MqttCfg, topic: string, buf: Buffer) {
  const payload = buf.toString()
  if (topicMatches(cfg.topic_status, topic)) {
    const device = deviceIdFromTopic(cfg.topic_status, topic)
    const r = parseStatusPayload(payload)
    if (!r.ok) { log(`pesan ditolak [${topic}]: ${r.reason}`); note(topic, payload, false, r.reason); return }
    st.devices.add(device)
    note(topic, payload, true)
    queue.push({ t: 'event', device, ts: r.ts.toISOString(), status: r.status, raw: safeJson(payload), suspect: r.suspect })
  } else if (cfg.topic_online && topicMatches(cfg.topic_online, topic)) {
    const device = deviceIdFromTopic(cfg.topic_online, topic)
    const online = parseOnlinePayload(payload)
    if (online === null) { note(topic, payload, false, 'Payload online tidak dikenali'); return }
    st.devices.add(device)
    note(topic, payload, true)
    queue.push({ t: 'online', device, online })
  }
}
const safeJson = (s: string) => { try { return JSON.parse(s) } catch { return { raw: s } } }

/** Sambungkan dengan config; resolve bila connect + subscribe sukses (≤ 12 dtk), reject bila gagal. */
function openClient(cfg: MqttCfg): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(brokerUrl(cfg), connectOpts(cfg, { persistent: true, clientId: stableClientId() }))
    let settled = false
    const fail = (e: Error) => { if (!settled) { settled = true; client.end(true); reject(e) } }
    const timer = setTimeout(() => fail(new Error('Timeout saat menyambung ke broker')), 12_000)

    client.on('message', (t, b) => handleMessage(cfg, t, b))
    client.on('error', (e) => { log('mqtt error:', e.message); if (!settled) fail(e); else { st.lastError = e.message; touch() } })
    client.on('offline', () => { if (settled && current?.client === client) { st.state = 'reconnecting'; touch() } })
    client.on('close', () => { if (settled && current?.client === client) { st.state = 'reconnecting'; touch() } })
    client.on('connect', () => {
      const topics = [cfg.topic_status, ...(cfg.topic_online ? [cfg.topic_online] : [])]
      client.subscribe(topics, { qos: 1 }, (err, granted) => {
        if (err || granted?.some((g) => g.qos === 128)) return fail(err ?? new Error('Subscribe ditolak broker'))
        clearTimeout(timer)
        if (!settled) { settled = true; resolve(client) }
        if (current?.client === client) { st.state = 'connected'; st.lastError = null; touch() }
      })
    })
  })
}

async function applyConfig(cfg: MqttCfg, key: string) {
  log(`menyambung ke ${brokerUrl(cfg)} topic=${cfg.topic_status}`)
  try {
    const client = await openClient(cfg)
    const old = current
    current = { client, cfg, key }
    old?.client.end(true)
    st.state = 'connected'; st.lastError = null; touch()
    log('terhubung')
  } catch (e) {
    const msg = (e as Error).message
    log('gagal menyambung dengan config baru:', msg)
    st.lastError = `Config baru gagal: ${msg}` + (current ? ' — tetap memakai config lama' : '')
    if (!current) st.state = 'error'
    touch()
    failedKey = key; failedAt = Date.now() // coba lagi setelah 30 dtk, atau segera bila config berubah
  }
}

let failedKey = ''
let failedAt = 0
async function pollConfig() {
  let rows: (MqttCfg & { has_password: boolean; updated_at: string })[]
  try { rows = await select('mqtt_config', 'id=eq.1&select=*') } catch (e) { log('poll config gagal:', (e as Error).message); return }
  const row = rows[0]
  if (!row) { if (!current) { st.state = 'unconfigured'; touch() } return }
  const key = cfgKey(row)
  if (key === current?.key || (key === failedKey && Date.now() - failedAt < 30_000)) return
  let password: string | null = null
  if (row.has_password) {
    try { password = (await rpc('get_mqtt_password', {})) as string | null } catch (e) { log('gagal baca password:', (e as Error).message); return }
  }
  await applyConfig({ ...row, password }, key)
}

// ───────── tes koneksi ─────────
interface TestReq { id: number; payload: Partial<MqttCfg> & { password?: string } }
let testing = false
async function pollTests() {
  if (testing) return
  let reqs: TestReq[]
  try { reqs = await select('mqtt_test_requests', 'status=eq.pending&order=id&limit=1&select=id,payload') } catch { return }
  const req = reqs[0]
  if (!req) return
  testing = true
  try {
    // klaim, lalu hapus password dari baris (jangan tersimpan di DB)
    const { password, ...safe } = req.payload
    await patch('mqtt_test_requests', `id=eq.${req.id}&status=eq.pending`, { status: 'running', payload: safe })
    const p = req.payload
    let pw: string | null = password || null
    if (!pw) { try { pw = (await rpc('get_mqtt_password', {})) as string | null } catch { /* tanpa password */ } }
    if (!p.host || !p.port || !p.protocol || !p.topic_status) {
      await patch('mqtt_test_requests', `id=eq.${req.id}`, { status: 'failed', steps: [{ id: 'connect', label: 'Terhubung ke broker', status: 'failed', detail: 'Form belum lengkap' }] })
    } else {
      await runTest(req.id, { host: p.host, port: p.port, protocol: p.protocol, username: p.username, password: pw, topic_status: p.topic_status, topic_online: p.topic_online })
    }
  } catch (e) {
    log('tes gagal:', (e as Error).message)
    await patch('mqtt_test_requests', `id=eq.${req.id}`, { status: 'failed' }).catch(() => {})
  } finally { testing = false }
}

// ───────── pengirim antrean → Supabase ─────────
async function drain() {
  let backoff = 1000
  for (;;) {
    const job = queue.peek()
    if (!job) { await sleep(250); continue }
    try {
      if (job.t === 'event') {
        await rpc('ingest_event', { p_device: job.device, p_ts: job.ts, p_status: job.status, p_raw: job.raw, p_suspect: job.suspect })
      } else {
        await rpc('set_device_online', { p_device: job.device, p_online: job.online })
      }
      queue.shift(); backoff = 1000
    } catch (e) {
      if (e instanceof PermanentError) { log('job dibuang (error permanen):', (e as Error).message); queue.shift(); continue }
      log(`kirim gagal (antrean ${queue.length}), coba lagi ${backoff / 1000}s:`, (e as Error).message)
      await sleep(backoff); backoff = Math.min(backoff * 2, 30_000)
    }
  }
}

// ───────── jalan ─────────
async function housekeeping() {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString()
  await del('mqtt_test_requests', `created_at=lt.${cutoff}`).catch(() => {})
  await patch('mqtt_test_requests', `status=in.(pending,running)&created_at=lt.${new Date(Date.now() - 5 * 60_000).toISOString()}`, { status: 'failed' }).catch(() => {})
}

async function shutdown() {
  log('berhenti…')
  current?.client.end(true)
  await flushStatus(true)
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

log(`ingest mulai (antrean awal: ${queue.length})`)
void drain()
void housekeeping()
setInterval(housekeeping, 3600_000)
setInterval(() => void flushStatus(), 3_000)
setInterval(() => void pollConfig(), CONFIG_POLL_MS)
setInterval(() => void pollTests(), TEST_POLL_MS)
void pollConfig()
