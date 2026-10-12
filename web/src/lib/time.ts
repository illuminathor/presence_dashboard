// Semua tampilan waktu dalam Asia/Jakarta (WIB); data tersimpan UTC.
const TZ = 'Asia/Jakarta'
const WIB_OFFSET_MS = 7 * 3600_000

const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('id-ID', { timeZone: TZ, hourCycle: 'h23', ...o })
const fTime = f({ hour: '2-digit', minute: '2-digit' })
const fTimeSec = f({ hour: '2-digit', minute: '2-digit', second: '2-digit' })
const fDay = f({ day: '2-digit', month: 'short' })
const fFull = f({ day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

export const wibTime = (d: Date | number) => fTime.format(d).replace('.', ':')
export const wibTimeSec = (d: Date | number) => fTimeSec.format(d).replaceAll('.', ':')
export const wibDay = (d: Date | number) => fDay.format(d)
export const wibFull = (d: Date | number) => fFull.format(d).replaceAll('.', ':') + ' WIB'
export const wibDayTime = (d: Date | number) => `${wibDay(d)} ${wibTime(d)}`

/** Format durasi: 4j 58m / 12m 04d / 8d */
export function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (d) return `${d}h ${h}j`
  if (h) return `${h}j ${m}m`
  if (m) return `${m}m ${String(sec).padStart(2, '0')}d`
  return `${sec}d`
}

export function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} dtk lalu`
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`
  return `${Math.floor(s / 86400)} hari lalu`
}

/** <input type="datetime-local"> yang dibaca sebagai WIB. */
export const toWibInput = (ms: number) => new Date(ms + WIB_OFFSET_MS).toISOString().slice(0, 16)
export const fromWibInput = (s: string) => new Date(`${s}:00+07:00`).getTime()

/** Untuk chart: geser +7 jam dan pakai useUTC, sehingga sumbu waktu = WIB di zona browser mana pun. */
export const toChartX = (ms: number) => ms + WIB_OFFSET_MS
export const fromChartX = (x: number) => x - WIB_OFFSET_MS

// ───────── time window ─────────
export const PRESETS = {
  '1h': { label: '1 jam', ms: 3600e3, bucket: 5 * 60e3 },
  '6h': { label: '6 jam', ms: 6 * 3600e3, bucket: 30 * 60e3 },
  '24h': { label: '24 jam', ms: 24 * 3600e3, bucket: 3600e3 },
  '7d': { label: '7 hari', ms: 7 * 86400e3, bucket: 86400e3 },
  '30d': { label: '30 hari', ms: 30 * 86400e3, bucket: 86400e3 },
} as const
export type PresetKey = keyof typeof PRESETS

export interface WindowSpec { preset: PresetKey | null; from: number; to: number }

const STEPS = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080].map((m) => m * 60e3)
/** Bucket terkecil yang menghasilkan ≤ 48 bar. */
export const autoBucket = (spanMs: number) => STEPS.find((s) => spanMs / s <= 48) ?? STEPS[STEPS.length - 1]

export const bucketOf = (w: WindowSpec) => (w.preset ? PRESETS[w.preset].bucket : autoBucket(w.to - w.from))

/** Window dari URL: ?w=24h  atau  ?from=<ISO>&to=<ISO> (kustom). Preset bergulir (rolling). */
export function windowFromParams(p: URLSearchParams, now = Date.now()): WindowSpec {
  const from = Date.parse(p.get('from') ?? ''), to = Date.parse(p.get('to') ?? '')
  if (Number.isFinite(from) && Number.isFinite(to) && to > from) return { preset: null, from, to }
  const k = (p.get('w') as PresetKey) in PRESETS ? (p.get('w') as PresetKey) : '24h'
  return { preset: k, from: now - PRESETS[k].ms, to: now }
}
