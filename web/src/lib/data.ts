import { useCallback, useEffect, useRef, useState } from 'react'
import { get } from './api'
import { bucketOf, type WindowSpec } from './time'

export interface PeriodStats {
  occupied_count: number; vacant_count: number
  occupied_seconds: number; offline_seconds: number; window_seconds: number
  occupancy_rate: number | null
  avg_session_seconds: number | null; longest_session_seconds: number | null
}
export interface Summary { current: PeriodStats; prev: PeriodStats }
export interface Segment { kind: 'occupied' | 'vacant' | 'offline'; start: number; end: number }
export interface Bucket { start: number; occupied: number; vacant: number }
export interface DeviceRow { device_id: string; room_name: string | null }
export interface DeviceStatus { device_id: string; current_status: 'occupied' | 'vacant' | null; since: string | null; online: boolean; last_seen: string | null }

export function useDevices() {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null)
  useEffect(() => {
    get<DeviceRow[]>('/devices').then(setDevices).catch(() => setDevices([]))
  }, [])
  return devices
}

/** Pemberitahuan "ada data baru" dari server (SSE). Browser menyambung ulang otomatis. */
function useChangeStream(device: string | null, onChange: () => void) {
  const cb = useRef(onChange)
  cb.current = onChange
  useEffect(() => {
    if (!device) return
    const es = new EventSource('/api/stream')
    es.onmessage = (e) => { try { if (JSON.parse(e.data).device === device) cb.current() } catch { /* abaikan */ } }
    return () => es.close()
  }, [device])
}

export function useDeviceStatus(device: string | null) {
  const [status, setStatus] = useState<DeviceStatus | null>(null)
  const load = useCallback(() => {
    if (device) get<DeviceStatus | null>(`/devices/${encodeURIComponent(device)}/status`).then(setStatus).catch(() => {})
  }, [device])
  useEffect(() => {
    load()
    const poll = setInterval(load, 30_000) // cadangan bila koneksi SSE terputus
    return () => clearInterval(poll)
  }, [load])
  useChangeStream(device, load)
  return status
}

export interface DashData { summary: Summary; segments: Segment[]; buckets: Bucket[]; from: number; to: number; bucketMs: number }

/** Ambil semua angka dashboard untuk satu window; refresh saat ada event baru (SSE) dan tiap 30 dtk. */
export function useDashboard(device: string | null, spec: WindowSpec) {
  const [data, setData] = useState<DashData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const specRef = useRef(spec)
  specRef.current = spec
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!device) return
    const s = specRef.current
    // preset bergulir: geser ke "sekarang"
    const to = s.preset ? Date.now() : s.to
    const from = s.preset ? to - (s.to - s.from) : s.from
    const bucketMs = bucketOf(s)
    const my = ++seq.current
    setLoading(true)
    try {
      const r = await get<{ summary: Summary; segments: Segment[]; buckets: Bucket[] }>(
        `/dashboard?device=${encodeURIComponent(device)}&from=${from}&to=${to}&bucket=${bucketMs}`)
      if (my !== seq.current) return
      setError('')
      setData({ ...r, from, to, bucketMs })
    } catch (e) {
      if (my === seq.current) setError((e as Error).message)
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [device])

  const key = `${spec.preset ?? 'c'}-${spec.preset ? spec.to - spec.from : `${spec.from}-${spec.to}`}`
  useEffect(() => { void load() }, [load, key])

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useChangeStream(device, () => { clearTimeout(timer.current); timer.current = setTimeout(() => void load(), 400) })
  useEffect(() => {
    const iv = setInterval(() => void load(), 30_000)
    return () => { clearInterval(iv); clearTimeout(timer.current) }
  }, [load])

  return { data, error, loading }
}

export interface EventRow { id: number; ts: string; status: 'occupied' | 'vacant'; is_transition: boolean; ts_suspect: boolean }

export async function fetchEvents(device: string, from: number, to: number, limit: number, offset = 0) {
  try {
    const rows = await get<EventRow[]>(`/events?device=${encodeURIComponent(device)}&from=${from}&to=${to}&limit=${limit}&offset=${offset}`)
    return { rows, error: null as Error | null }
  } catch (e) { return { rows: [] as EventRow[], error: e as Error } }
}

/** Pola okupansi 7 hari × 24 jam (WIB, Senin dulu), 4 minggu terakhir. */
export function useHeatmap(device: string | null) {
  const [cells, setCells] = useState<(number | null)[][] | null>(null)
  useEffect(() => {
    if (!device) return
    const load = () => get<(number | null)[][]>(`/heatmap?device=${encodeURIComponent(device)}`).then(setCells).catch(() => {})
    load()
    const iv = setInterval(load, 5 * 60_000)
    return () => clearInterval(iv)
  }, [device])
  return cells
}
