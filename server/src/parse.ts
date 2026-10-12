export const SKEW_LIMIT_MS = 5 * 60 * 1000

export type ParsedStatus =
  | { ok: true; ts: Date; status: 'occupied' | 'vacant'; suspect: boolean }
  | { ok: false; reason: string }

/** Cocokkan topic dengan pola MQTT (+ satu level, # sisa level). */
export function topicMatches(pattern: string, topic: string): boolean {
  const p = pattern.split('/')
  const t = topic.split('/')
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '#') return true
    if (i >= t.length) return false
    if (p[i] !== '+' && p[i] !== t[i]) return false
  }
  return p.length === t.length
}

/** device_id = segmen topic di posisi wildcard `+` pertama pada pola. */
export function deviceIdFromTopic(pattern: string, topic: string): string {
  const idx = pattern.split('/').indexOf('+')
  const seg = idx >= 0 ? topic.split('/')[idx] : undefined
  return seg && seg.length > 0 ? seg : 'default'
}

export function parseStatusPayload(raw: string, now = Date.now()): ParsedStatus {
  let j: unknown
  try { j = JSON.parse(raw) } catch { return { ok: false, reason: 'Bukan JSON valid' } }
  if (typeof j !== 'object' || j === null) return { ok: false, reason: 'Payload bukan objek JSON' }
  const o = j as Record<string, unknown>

  if (o.status !== 'occupied' && o.status !== 'vacant') {
    return { ok: false, reason: `status "${String(o.status)}" di luar occupied/vacant` }
  }

  let tsMs: number
  if (o.ts === undefined || o.ts === null) {
    tsMs = now // fallback: waktu terima server
  } else if (typeof o.ts === 'number' && Number.isFinite(o.ts) && o.ts > 0) {
    tsMs = Math.round(o.ts)
  } else {
    return { ok: false, reason: 'ts harus epoch milidetik (angka)' }
  }
  return { ok: true, ts: new Date(tsMs), status: o.status, suspect: Math.abs(now - tsMs) > SKEW_LIMIT_MS }
}

/** Payload online Shelly: "true"/"false" (atau JSON {"online":bool}). */
export function parseOnlinePayload(raw: string): boolean | null {
  const s = raw.trim().toLowerCase()
  if (s === 'true' || s === '1' || s === 'online') return true
  if (s === 'false' || s === '0' || s === 'offline') return false
  try {
    const j = JSON.parse(raw)
    if (typeof j?.online === 'boolean') return j.online
  } catch { /* abaikan */ }
  return null
}
