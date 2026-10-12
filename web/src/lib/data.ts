import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { bucketOf, type WindowSpec } from './time'

export interface PeriodStats {
  occupied_count: number; vacant_count: number
  occupied_seconds: number; offline_seconds: number; window_seconds: number
  occupancy_rate: number | null
}
export interface Summary { current: PeriodStats; prev: PeriodStats }
export interface Segment { kind: 'occupied' | 'vacant' | 'offline'; start: number; end: number }
export interface Bucket { start: number; occupied: number; vacant: number }
export interface DeviceRow { device_id: string; room_name: string | null }
export interface DeviceStatus { device_id: string; current_status: 'occupied' | 'vacant' | null; since: string | null; online: boolean; last_seen: string | null }

export function useDevices() {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null)
  useEffect(() => {
    supabase.from('devices').select('device_id, room_name').order('device_id').then(({ data }) => setDevices(data ?? []))
  }, [])
  return devices
}

export function useDeviceStatus(device: string | null) {
  const [status, setStatus] = useState<DeviceStatus | null>(null)
  useEffect(() => {
    if (!device) return
    let live = true
    const load = () => supabase.from('device_status').select('*').eq('device_id', device).maybeSingle()
      .then(({ data }) => { if (live) setStatus(data as DeviceStatus | null) })
    load()
    const ch = supabase.channel(`ds-${device}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_status', filter: `device_id=eq.${device}` }, load)
      .subscribe()
    const poll = setInterval(load, 30_000) // cadangan bila Realtime terputus
    return () => { live = false; clearInterval(poll); supabase.removeChannel(ch) }
  }, [device])
  return status
}

export interface DashData { summary: Summary; segments: Segment[]; buckets: Bucket[]; from: number; to: number; bucketMs: number }

/** Ambil semua angka dashboard untuk satu window; refresh saat ada event baru (Realtime) dan tiap 30 dtk. */
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
    const args = { p_device: device, p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() }
    const [sum, tl, bk] = await Promise.all([
      supabase.rpc('get_summary', args),
      supabase.rpc('get_timeline', args),
      supabase.rpc('get_buckets', { ...args, p_bucket: `${Math.round(bucketMs / 1000)} seconds` }),
    ])
    if (my !== seq.current) return
    setLoading(false)
    const err = sum.error ?? tl.error ?? bk.error
    if (err) return setError(err.message)
    setError('')
    setData({
      summary: sum.data as Summary,
      segments: (tl.data as { kind: Segment['kind']; start_ts: string; end_ts: string }[]).map((r) => ({ kind: r.kind, start: Date.parse(r.start_ts), end: Date.parse(r.end_ts) })),
      buckets: (bk.data as { bucket_start: string; occupied: number; vacant: number }[]).map((r) => ({ start: Date.parse(r.bucket_start), occupied: r.occupied, vacant: r.vacant })),
      from, to, bucketMs,
    })
  }, [device])

  const key = `${spec.preset ?? 'c'}-${spec.preset ? spec.to - spec.from : `${spec.from}-${spec.to}`}`
  useEffect(() => { void load() }, [load, key])

  useEffect(() => {
    if (!device) return
    let t: ReturnType<typeof setTimeout> | undefined
    const soon = () => { clearTimeout(t); t = setTimeout(() => void load(), 400) }
    const ch = supabase.channel(`ev-${device}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: `device_id=eq.${device}` }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_status', filter: `device_id=eq.${device}` }, soon)
      .subscribe()
    const iv = setInterval(() => void load(), 30_000)
    return () => { clearTimeout(t); clearInterval(iv); supabase.removeChannel(ch) }
  }, [device, load])

  return { data, error, loading }
}

export interface EventRow { id: number; ts: string; status: 'occupied' | 'vacant'; is_transition: boolean; ts_suspect: boolean }

export async function fetchEvents(device: string, from: number, to: number, limit: number, offset = 0) {
  const { data, error } = await supabase.from('events').select('id, ts, status, is_transition, ts_suspect')
    .eq('device_id', device).gte('ts', new Date(from).toISOString()).lt('ts', new Date(to).toISOString())
    .order('ts', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1)
  return { rows: (data ?? []) as EventRow[], error }
}
