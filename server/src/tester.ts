import mqtt from 'mqtt'
import { brokerUrl, connectOpts, type MqttCfg } from './config.js'
import { parseStatusPayload } from './parse.js'

type StepState = 'pending' | 'running' | 'ok' | 'failed'
interface Step { id: string; label: string; status: StepState; detail?: string }

const AUTH_CODES = new Set([4, 5, 134, 135])
const WAIT_MESSAGE_MS = 30_000

function explain(e: Error & { code?: string | number }): string {
  const c = e.code
  if (c === 'ENOTFOUND') return 'Host tidak ditemukan (cek penulisan host / DNS).'
  if (c === 'ECONNREFUSED') return 'Koneksi ditolak — broker tidak aktif atau port salah.'
  if (c === 'ETIMEDOUT' || /timeout/i.test(e.message)) return 'Timeout — host tidak terjangkau (firewall / port salah).'
  if (c === 'ECONNRESET') return 'Koneksi diputus broker (cek protokol mqtt/mqtts dan port).'
  if (typeof c === 'string' && /CERT|SSL|TLS/i.test(c)) return `Masalah sertifikat TLS (${c}).`
  return e.message || String(c)
}

export type Report = (status: 'running' | 'done' | 'failed', steps: Step[], samples: unknown[]) => void

/** Jalankan tes 4 langkah; kemajuan dilaporkan lewat callback `report`. Password tidak pernah disimpan. */
export async function runTest(cfg: MqttCfg, report: Report): Promise<void> {
  const steps: Step[] = [
    { id: 'connect', label: 'Terhubung ke broker', status: 'running' },
    { id: 'auth', label: 'Autentikasi diterima', status: 'pending' },
    { id: 'subscribe', label: 'Subscribe ke topic', status: 'pending' },
    { id: 'message', label: 'Pesan masuk (≤ 30 detik) & format sesuai', status: 'pending' },
  ]
  const samples: unknown[] = []
  const flush = (status: 'running' | 'done' | 'failed', _force = false) =>
    report(status, steps.map((s) => ({ ...s })), [...samples])
  const set = (id: string, status: StepState, detail?: string) => {
    const s = steps.find((x) => x.id === id)!
    s.status = status; s.detail = detail
  }
  const finish = async (status: 'done' | 'failed') => { flush(status, true) }
  flush('running', true)

  const t0 = Date.now()
  const client = mqtt.connect(brokerUrl(cfg), {
    ...connectOpts(cfg, { persistent: false, clientId: 'presence-test-' + Math.random().toString(16).slice(2, 10) }),
    reconnectPeriod: 0, connectTimeout: 10_000,
  })

  const outcome = await new Promise<'connected' | 'failed'>((resolve) => {
    client.once('connect', () => resolve('connected'))
    client.once('error', (e: Error & { code?: string | number }) => {
      if (typeof e.code === 'number' && AUTH_CODES.has(e.code)) {
        set('connect', 'ok', 'Broker terjangkau')
        set('auth', 'failed', 'Username/password ditolak broker (autentikasi gagal).')
      } else {
        set('connect', 'failed', explain(e))
      }
      resolve('failed')
    })
  })
  if (outcome === 'failed') { client.end(true); return finish('failed') }

  set('connect', 'ok', `Latensi ${Date.now() - t0} ms`)
  set('auth', 'ok'); set('subscribe', 'running'); flush('running', true)

  const granted = await new Promise<boolean>((resolve) => {
    client.subscribe(cfg.topic_status, { qos: 1 }, (err, g) => {
      if (err) { set('subscribe', 'failed', err.message); return resolve(false) }
      if (g?.some((x) => x.qos === 128)) { set('subscribe', 'failed', 'Broker menolak subscribe (tidak ada izin pada topic ini).'); return resolve(false) }
      set('subscribe', 'ok', cfg.topic_status); resolve(true)
    })
  })
  if (!granted) { client.end(true); return finish('failed') }

  set('message', 'running', 'Menunggu pesan…'); flush('running', true)
  let valid = 0, invalid = 0
  client.on('message', (topic, buf) => {
    const payload = buf.toString()
    const r = parseStatusPayload(payload)
    const entry = { t: new Date().toISOString(), topic, payload: payload.slice(0, 300), ok: r.ok, reason: r.ok ? undefined : r.reason }
    samples.unshift(entry); samples.length = Math.min(samples.length, 10)
    if (r.ok) { valid++; set('message', 'ok', `${valid} pesan sesuai`) } else { invalid++ }
    if (!valid) set('message', 'running', `${invalid} pesan tidak sesuai, masih menunggu…`)
    flush('running')
  })

  await new Promise<void>((resolve) => {
    const iv = setInterval(() => { if (valid >= 1 && Date.now() - t0 > 3000) { clearInterval(iv); resolve() } }, 500)
    setTimeout(() => { clearInterval(iv); resolve() }, WAIT_MESSAGE_MS)
  })
  client.end(true)
  if (!valid) {
    set('message', 'failed', invalid
      ? `${invalid} pesan masuk tapi formatnya tidak sesuai (lihat alasan di daftar pesan).`
      : 'Tidak ada pesan dalam 30 detik. Sensor mungkin hanya publish saat status berubah — ubah kondisi ruangan lalu tes ulang.')
  }
  return finish('done')
}
