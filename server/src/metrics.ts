import type { Db } from './db.js'

/** Interval setengah-terbuka [start, end) dalam epoch ms. */
export type Iv = [number, number]

export interface PeriodStats {
  occupied_count: number; vacant_count: number
  occupied_seconds: number; offline_seconds: number; window_seconds: number
  occupancy_rate: number | null
  avg_session_seconds: number | null; longest_session_seconds: number | null
}
export interface Segment { kind: 'occupied' | 'vacant' | 'offline'; start: number; end: number }
export interface Bucket { start: number; occupied: number; vacant: number }

/** a − b; keduanya terurut dan tidak saling tumpang tindih. */
export function subtract(a: Iv[], b: Iv[]): Iv[] {
  const out: Iv[] = []
  for (const [s0, e] of a) {
    let s = s0
    for (const [bs, be] of b) {
      if (be <= s || bs >= e) continue
      if (bs > s) out.push([s, bs])
      s = Math.max(s, be)
      if (s >= e) break
    }
    if (s < e) out.push([s, e])
  }
  return out
}
const total = (ivs: Iv[]) => ivs.reduce((n, [s, e]) => n + (e - s), 0)

/** Rentang offline yang beririsan dengan [from, to). */
export function offlineRanges(db: Db, device: string, from: number, to: number): Iv[] {
  const base = db.prepare('select ts, online from device_online_log where device_id = ? and ts <= ? order by ts desc, id desc limit 1')
    .get(device, from) as { ts: number; online: number } | undefined
  const rest = db.prepare('select ts, online from device_online_log where device_id = ? and ts > ? and ts < ? order by ts, id')
    .all(device, from, to) as unknown as { ts: number; online: number }[]
  const rows = base ? [base, ...rest] : rest
  const out: Iv[] = []
  rows.forEach((r, i) => {
    if (r.online) return
    const s = Math.max(r.ts, from), e = Math.min(rows[i + 1]?.ts ?? to, to)
    if (e > s) out.push([s, e])
  })
  return out
}

/** Interval status (dari transisi) yang dipotong ke [from, to). Status awal = transisi terakhir sebelum from. */
export function stateSegments(db: Db, device: string, from: number, to: number): { status: 'occupied' | 'vacant'; r: Iv }[] {
  const base = db.prepare('select ts, status from events where device_id = ? and is_transition = 1 and ts < ? order by ts desc, id desc limit 1')
    .get(device, from) as { ts: number; status: 'occupied' | 'vacant' } | undefined
  const rest = db.prepare('select ts, status from events where device_id = ? and is_transition = 1 and ts >= ? and ts < ? order by ts, id')
    .all(device, from, to) as unknown as { ts: number; status: 'occupied' | 'vacant' }[]
  const rows = base ? [base, ...rest] : rest
  const out: { status: 'occupied' | 'vacant'; r: Iv }[] = []
  rows.forEach((r, i) => {
    const s = Math.max(r.ts, from), e = Math.min(rows[i + 1]?.ts ?? to, to)
    if (e > s) out.push({ status: r.status, r: [s, e] })
  })
  return out
}

export function periodStats(db: Db, device: string, from: number, to: number, now = Date.now()): PeriodStats {
  const vTo = Math.min(to, now)
  const winMs = Math.max(vTo - from, 0)
  const counts = db.prepare('select status, count(*) as n from events where device_id = ? and is_transition = 1 and ts >= ? and ts < ? group by status')
    .all(device, from, to) as unknown as { status: string; n: number }[]
  const cnt = (s: string) => counts.find((c) => c.status === s)?.n ?? 0

  let occ = 0, off = 0
  let sessions: Iv[] = []
  if (winMs > 0) {
    const offR = offlineRanges(db, device, from, vTo)
    off = total(offR) / 1000
    sessions = subtract(stateSegments(db, device, from, vTo).filter((s) => s.status === 'occupied').map((s) => s.r), offR)
    occ = total(sessions) / 1000
  }
  const win = winMs / 1000
  return {
    occupied_count: cnt('occupied'), vacant_count: cnt('vacant'),
    occupied_seconds: Math.round(occ), offline_seconds: Math.round(off), window_seconds: Math.round(win),
    occupancy_rate: win - off > 0 ? Math.round((occ / (win - off)) * 1000) / 10 : null,
    avg_session_seconds: sessions.length ? Math.round(occ / sessions.length) : null,
    longest_session_seconds: sessions.length ? Math.round(Math.max(...sessions.map(([a, b]) => b - a)) / 1000) : null,
  }
}

export function getSummary(db: Db, device: string, from: number, to: number, now = Date.now()) {
  return {
    current: periodStats(db, device, from, to, now),
    prev: periodStats(db, device, from - (to - from), from, now),
  }
}

export function getTimeline(db: Db, device: string, from: number, to: number, now = Date.now()): Segment[] {
  const vTo = Math.min(to, now)
  if (vTo <= from) return []
  const off = offlineRanges(db, device, from, vTo)
  const out: Segment[] = []
  for (const s of stateSegments(db, device, from, vTo)) {
    for (const [start, end] of subtract([s.r], off)) out.push({ kind: s.status, start, end })
  }
  for (const [start, end] of off) out.push({ kind: 'offline', start, end })
  return out.sort((a, b) => a.start - b.start)
}

export function getBuckets(db: Db, device: string, from: number, to: number, bucketMs: number): Bucket[] {
  if (!(bucketMs >= 60_000) || (to - from) / bucketMs > 500) throw new Error('bucket tidak valid')
  const out: Bucket[] = []
  for (let t = from; t < to; t += bucketMs) out.push({ start: t, occupied: 0, vacant: 0 })
  const rows = db.prepare('select ts, status from events where device_id = ? and is_transition = 1 and ts >= ? and ts < ?')
    .all(device, from, to) as unknown as { ts: number; status: string }[]
  for (const r of rows) {
    const b = out[Math.floor((r.ts - from) / bucketMs)]
    if (b) b[r.status === 'occupied' ? 'occupied' : 'vacant']++
  }
  return out
}

const HOUR = 3600_000, WIB = 7 * HOUR

/** Pola okupansi: rata-rata porsi terisi per (hari, jam WIB) selama `weeks` minggu terakhir. cells[dow][jam] ∈ [0,1] atau null (belum ada data); dow 0 = Senin. */
export function getHeatmap(db: Db, device: string, weeks = 4, now = Date.now()): (number | null)[][] {
  const to = now, from = Math.floor((now - weeks * 7 * 86400_000) / HOUR) * HOUR
  const offR = offlineRanges(db, device, from, to)
  const occ = subtract(stateSegments(db, device, from, to).filter((s) => s.status === 'occupied').map((s) => s.r), offR)
  const num = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  const den = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  const slot = (t: number) => { const d = new Date(t + WIB); return [(d.getUTCDay() + 6) % 7, d.getUTCHours()] as const }
  const spread = (ivs: Iv[], into: number[][]) => {
    for (const [a, b] of ivs) {
      for (let t = Math.floor(a / HOUR) * HOUR; t < b; t += HOUR) {
        const ov = Math.min(b, t + HOUR) - Math.max(a, t)
        if (ov > 0) { const [d, h] = slot(t); into[d][h] += ov }
      }
    }
  }
  spread(occ, num)
  spread(subtract([[from, to]], offR), den) // waktu teramati (di luar offline)
  return num.map((row, d) => row.map((v, h) => (den[d][h] > 0 ? Math.round((v / den[d][h]) * 1000) / 1000 : null)))
}
