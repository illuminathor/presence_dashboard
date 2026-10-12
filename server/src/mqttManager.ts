import mqtt, { type MqttClient } from 'mqtt'
import { brokerUrl, cfgKey, connectOpts, stableClientId, type MqttCfg } from './config.js'
import type { Db } from './db.js'
import { ingestEvent, setDeviceOnline } from './ingest.js'
import { deviceIdFromTopic, parseOnlinePayload, parseStatusPayload, topicMatches } from './parse.js'

interface Sample { t: string; topic: string; payload: string; ok: boolean; reason?: string }

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)

export class MqttManager {
  state: 'unconfigured' | 'connected' | 'reconnecting' | 'error' = 'unconfigured'
  lastError: string | null = null
  lastMessageAt: string | null = null
  msgCount = 0
  invalidCount = 0
  devices = new Set<string>()
  recent: Sample[] = []

  private current: { client: MqttClient; key: string } | null = null
  private failedKey = ''
  private failedAt = 0
  private applying = false

  constructor(private db: Db) {}

  status() {
    return {
      state: this.state, last_error: this.lastError, last_message_at: this.lastMessageAt,
      msg_count: this.msgCount, invalid_count: this.invalidCount, devices: [...this.devices], recent: this.recent,
    }
  }

  private note(topic: string, payload: string, ok: boolean, reason?: string) {
    this.recent.unshift({ t: new Date().toISOString(), topic, payload: payload.slice(0, 300), ok, reason })
    this.recent.length = Math.min(this.recent.length, 10)
    this.lastMessageAt = new Date().toISOString()
    if (ok) this.msgCount++; else this.invalidCount++
  }

  private handle(cfg: MqttCfg, topic: string, buf: Buffer) {
    const payload = buf.toString()
    try {
      if (topicMatches(cfg.topic_status, topic)) {
        const device = deviceIdFromTopic(cfg.topic_status, topic)
        const r = parseStatusPayload(payload)
        if (!r.ok) { log(`pesan ditolak [${topic}]: ${r.reason}`); return this.note(topic, payload, false, r.reason) }
        this.devices.add(device)
        this.note(topic, payload, true)
        let raw: unknown; try { raw = JSON.parse(payload) } catch { raw = { raw: payload } }
        ingestEvent(this.db, device, r.ts.getTime(), r.status, raw, r.suspect)
      } else if (cfg.topic_online && topicMatches(cfg.topic_online, topic)) {
        const device = deviceIdFromTopic(cfg.topic_online, topic)
        const online = parseOnlinePayload(payload)
        if (online === null) return this.note(topic, payload, false, 'Payload online tidak dikenali')
        this.devices.add(device)
        this.note(topic, payload, true)
        setDeviceOnline(this.db, device, online)
      }
    } catch (e) { log('gagal menyimpan pesan:', (e as Error).message) }
  }

  /** Sambungkan; resolve bila connect + subscribe sukses (≤ 12 dtk), reject bila gagal. */
  private open(cfg: MqttCfg): Promise<MqttClient> {
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(brokerUrl(cfg), connectOpts(cfg, { persistent: true, clientId: stableClientId() }))
      let settled = false
      const fail = (e: Error) => { if (!settled) { settled = true; client.end(true); reject(e) } }
      const timer = setTimeout(() => fail(new Error('Timeout saat menyambung ke broker')), 12_000)
      const lost = () => { if (settled && this.current?.client === client) this.state = 'reconnecting' }

      client.on('message', (t, b) => this.handle(cfg, t, b))
      client.on('error', (e) => { log('mqtt error:', e.message); if (!settled) fail(e); else this.lastError = e.message })
      client.on('offline', lost)
      client.on('close', lost)
      client.on('connect', () => {
        const topics = [cfg.topic_status, ...(cfg.topic_online ? [cfg.topic_online] : [])]
        client.subscribe(topics, { qos: 1 }, (err, granted) => {
          if (err || granted?.some((g) => g.qos === 128)) return fail(err ?? new Error('Subscribe ditolak broker'))
          clearTimeout(timer)
          if (!settled) { settled = true; resolve(client) }
          if (this.current?.client === client) { this.state = 'connected'; this.lastError = null }
        })
      })
    })
  }

  readConfig(): (MqttCfg & { updated_at: number }) | null {
    return (this.db.prepare('select * from mqtt_config where id = 1').get() as (MqttCfg & { updated_at: number }) | undefined) ?? null
  }

  /** Terapkan config tersimpan. Bila gagal dan sudah ada koneksi, koneksi lama tetap dipakai. */
  async apply(force = false): Promise<{ ok: boolean; error?: string }> {
    const cfg = this.readConfig()
    if (!cfg) { if (!this.current) this.state = 'unconfigured'; return { ok: true } }
    const key = cfgKey(cfg)
    if (!force && key === this.current?.key) return { ok: true }
    if (this.applying) return { ok: false, error: 'Sedang menyambung, coba lagi sebentar.' }
    this.applying = true
    log(`menyambung ke ${brokerUrl(cfg)} topic=${cfg.topic_status}`)
    try {
      const client = await this.open(cfg)
      const old = this.current
      this.current = { client, key }
      old?.client.end(true)
      this.state = 'connected'; this.lastError = null
      log('terhubung')
      return { ok: true }
    } catch (e) {
      const msg = (e as Error).message
      log('gagal menyambung:', msg)
      this.lastError = `Config gagal: ${msg}` + (this.current ? ' — tetap memakai config lama' : '')
      if (!this.current) this.state = 'error'
      this.failedKey = key; this.failedAt = Date.now()
      return { ok: false, error: msg }
    } finally { this.applying = false }
  }

  /** Coba lagi secara berkala bila config tersimpan tapi belum tersambung. */
  startRetry() {
    const t = setInterval(() => {
      const cfg = this.readConfig()
      if (!cfg || this.current?.key === cfgKey(cfg)) return
      if (cfgKey(cfg) === this.failedKey && Date.now() - this.failedAt < 30_000) return
      void this.apply()
    }, 10_000)
    t.unref()
  }

  stop() { this.current?.client.end(true) }
}
