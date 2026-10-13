import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchEvents, fetchTransitions, useDashboard, useDeviceStatus, useDevices, useHeatmap, type EventRow, type PeriodStats, type TransitionRow } from '../lib/data'
import { PRESETS, fmtDuration, fromWibInput, toWibInput, windowFromParams, wibDayTime, wibFull, wibTime, wibTimeSec, type PresetKey } from '../lib/time'
import { useNow, useTheme } from '../lib/theme'
import { BucketChart, Heatmap, Legend, TimelineBar } from '../components/Charts'
import { IconDownload, IconPresence, IconPresenceOff } from '../components/Icons'

function Card({ title, right, children, className = '' }: { title?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-card p-5 ${className}`}>
      {(title || right) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-bold">{title}</h2>{right}
        </div>
      )}
      {children}
    </section>
  )
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev === 0 && cur === 0) return <span className="text-muted">sama dgn periode lalu</span>
  if (prev === 0) return <span className="text-muted">baru (periode lalu 0)</span>
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (pct === 0) return <span className="text-muted">sama dgn periode lalu ({prev})</span>
  return <span className="text-muted"><b className={pct > 0 ? 'text-occ-fg' : 'text-bad'}>{pct > 0 ? '↑' : '↓'} {Math.abs(pct)}%</b> vs {prev} periode lalu</span>
}

function CountCard({ kind, cur, prev }: { kind: 'occupied' | 'vacant'; cur: PeriodStats | undefined; prev: PeriodStats | undefined }) {
  const n = cur ? cur[`${kind}_count`] : null
  const p = prev ? prev[`${kind}_count`] : 0
  return (
    <Card>
      <div className="flex items-center gap-2 text-sm font-semibold text-muted">
        <span className={`h-2.5 w-2.5 rounded-full ${kind === 'occupied' ? 'bg-occ' : 'bg-vac'}`} />
        {kind === 'occupied' ? 'Jadi Occupied' : 'Jadi Vacant'}
      </div>
      <div className="mt-2 text-[30px] font-extrabold leading-none sm:text-[40px] tabular-nums">{n ?? '–'}</div>
      <div className="mt-2 text-xs">{n !== null && <Delta cur={n} prev={p} />}</div>
    </Card>
  )
}

const seg = (on: boolean) => `rounded-lg px-3 py-1.5 text-sm font-semibold ${on ? 'bg-card text-fg shadow-sm' : 'text-muted hover:text-fg'}`

export default function Dashboard() {
  const { dark } = useTheme()
  const [params, setParams] = useSearchParams()
  const devices = useDevices()
  const device = params.get('d') ?? devices?.[0]?.device_id ?? null
  const spec = useMemo(() => windowFromParams(params), [params])
  const { data, error, loading } = useDashboard(device, spec)
  const ds = useDeviceStatus(device)
  const heat = useHeatmap(device)
  const now = useNow(1000)

  const setParam = (mut: (p: URLSearchParams) => void) => setParams((old) => { const p = new URLSearchParams(old); mut(p); return p }, { replace: true })
  const pickPreset = (k: PresetKey) => setParam((p) => { p.delete('from'); p.delete('to'); p.set('w', k) })

  const [customOpen, setCustomOpen] = useState(spec.preset === null)
  const [cFrom, setCFrom] = useState(toWibInput(spec.from))
  const [cTo, setCTo] = useState(toWibInput(spec.to))
  const customValid = cFrom && cTo && fromWibInput(cTo) > fromWibInput(cFrom)
  const applyCustom = () => setParam((p) => { p.delete('w'); p.set('from', new Date(fromWibInput(cFrom)).toISOString()); p.set('to', new Date(fromWibInput(cTo)).toISOString()) })

  const cur = data?.summary.current, prev = data?.summary.prev
  const room = devices?.find((d) => d.device_id === device)?.room_name
  const since = ds?.since ? Date.parse(ds.since) : null

  if (devices && devices.length === 0) {
    return <Card><p className="py-8 text-center text-muted">Belum ada data sensor. Pastikan konfigurasi MQTT (menu admin) sudah benar dan sensor mengirim data.</p></Card>
  }

  const occ = ds?.current_status === 'occupied'
  const offline = ds ? !ds.online : false
  const usedPct = cur?.occupancy_rate ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{room || (device === 'default' ? 'Ruangan' : device) || '…'}</h1>
          <p className="mt-1 text-sm text-muted">
            {devices && devices.length > 1 ? (
              <select className="field !w-auto !py-1" value={device ?? ''} onChange={(e) => setParam((p) => p.set('d', e.target.value))} aria-label="Pilih ruangan">
                {devices.map((d) => <option key={d.device_id} value={d.device_id}>{d.room_name || d.device_id}</option>)}
              </select>
            ) : device && device !== 'default' && room ? <span className="font-mono text-xs">{device}</span> : <span>Radar presence 24 GHz</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl bg-surface2 p-1" role="group" aria-label="Time window">
          {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
            <button key={k} onClick={() => { pickPreset(k); setCustomOpen(false) }} aria-pressed={spec.preset === k} className={seg(spec.preset === k)}>{PRESETS[k].label}</button>
          ))}
          <button onClick={() => setCustomOpen((o) => !o)} aria-pressed={spec.preset === null} className={seg(spec.preset === null)}>Custom</button>
        </div>
      </div>

      {customOpen && (
        <Card className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Dari (WIB)<input className="field mt-1" type="datetime-local" value={cFrom} onChange={(e) => setCFrom(e.target.value)} /></label>
          <label className="text-sm">Sampai (WIB)<input className="field mt-1" type="datetime-local" value={cTo} onChange={(e) => setCTo(e.target.value)} /></label>
          <button className="btn-primary" disabled={!customValid} onClick={applyCustom}>Terapkan</button>
          {!customValid && <span className="text-xs text-bad">Waktu akhir harus setelah waktu awal.</span>}
        </Card>
      )}

      {error && <div role="alert" className="rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">Gagal memuat data: {error}</div>}

      {/* Status sekarang */}
      <section className={`flex flex-wrap items-center gap-6 rounded-2xl border p-6 ${offline ? 'border-line bg-card' : occ ? 'border-occ-line bg-occ-bg' : 'border-line bg-card'}`}>
        <div className={`grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full ${offline || !occ ? 'bg-vac-bg text-vac-fg' : 'bg-occ text-occ-fg'}`}>
          {occ && !offline ? <IconPresence size={36} /> : <IconPresenceOff size={36} />}
        </div>
        <div className="min-w-[180px]">
          <div className="text-xs font-bold uppercase tracking-wider text-muted">Status sekarang</div>
          <div className="text-4xl font-extrabold leading-tight">
            {!ds ? '…' : offline ? 'Offline' : !ds.current_status ? 'Menunggu data' : occ ? 'Occupied' : 'Vacant'}
          </div>
          {ds && offline && ds.current_status && <div className="text-xs text-muted">Status terakhir: {occ ? 'Occupied' : 'Vacant'}</div>}
        </div>
        <div className="ml-auto flex flex-wrap gap-x-10 gap-y-3">
          <Fact label="Sejak" value={since ? `${wibTime(since)} WIB` : '–'} />
          <Fact label="Durasi berjalan" value={since ? fmtDuration((now - since) / 1000) : '–'} />
          <Fact label="Sensor" value="Radar 24 GHz" />
          <div className="flex items-center gap-2 self-end text-xs font-bold text-muted">
            <span className={`h-2 w-2 rounded-full ${offline ? 'bg-off' : 'animate-pulse bg-occ'}`} />{offline ? 'OFFLINE' : 'LIVE'}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <CountCard kind="occupied" cur={cur} prev={prev} />
        <CountCard kind="vacant" cur={cur} prev={prev} />
        <Card>
          <div className="text-sm font-semibold text-muted">Occupancy rate</div>
          <div className="mt-2 text-[30px] font-extrabold leading-none sm:text-[40px] tabular-nums">{usedPct === null ? '–' : `${usedPct}%`}</div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full bg-occ" style={{ width: `${usedPct ?? 0}%` }} /></div>
          <div className="mt-2 text-xs text-muted">
            {cur && <>{fmtDuration(cur.occupied_seconds)} terpakai{cur.offline_seconds > 0 && <> · offline {fmtDuration(cur.offline_seconds)} dikecualikan</>}</>}
          </div>
        </Card>
        <Card>
          <div className="text-sm font-semibold text-muted">Rata-rata sesi</div>
          <div className="mt-2 text-[30px] font-extrabold leading-none sm:text-[40px]">{cur?.avg_session_seconds != null ? fmtDuration(cur.avg_session_seconds) : '–'}</div>
          <div className="mt-2 text-xs text-muted">Sesi terpanjang <b className="text-fg">{cur?.longest_session_seconds != null ? fmtDuration(cur.longest_session_seconds) : '–'}</b></div>
        </Card>
      </div>

      <Card title="Timeline status" right={<Legend items={[{ label: 'Occupied', kind: 'occ' }, { label: 'Vacant', kind: 'vac' }, { label: 'Offline', kind: 'off' }]} />}>
        {data ? <TimelineBar segments={data.segments} from={data.from} to={data.to} live={spec.preset !== null} /> : <div className="h-12 animate-pulse rounded-lg bg-surface2" />}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Perubahan status per periode" right={<Legend items={[{ label: 'Occupied', kind: 'occ' }, { label: 'Vacant', kind: 'vac' }]} />}>
          {data ? <BucketChart buckets={data.buckets} bucketMs={data.bucketMs} dark={dark} /> : <div className="h-[200px] animate-pulse rounded-lg bg-surface2" />}
          {loading && <div className="mt-1 text-right text-xs text-muted">memperbarui…</div>}
        </Card>
        <Card title="Pola okupansi" right={
          <span className="flex items-center gap-2 text-xs text-muted">Rendah
            <span className="h-2.5 w-20 rounded-full" style={{ background: 'linear-gradient(90deg, var(--heat-low), var(--occ))' }} />Tinggi</span>}>
          <Heatmap cells={heat} />
        </Card>
      </div>

      {device && data && <EventLog key={`${device}-${spec.preset ?? 'c'}-${spec.preset ? spec.to - spec.from : spec.from}`} device={device} from={data.from} to={data.to} room={room || device} />}

      <p className="pb-4 text-center text-xs text-muted">Waktu dalam WIB (UTC+7) · Diperbarui real-time</p>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 text-base font-bold tabular-nums">{value}</div>
    </div>
  )
}

function EventLog({ device, from, to, room }: { device: string; from: number; to: number; room: string }) {
  const [rows, setRows] = useState<TransitionRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(10)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    fetchTransitions(device, from, to, size, page * size).then((r) => { if (live) { setRows(r.rows); setTotal(r.total) } })
    return () => { live = false }
  }, [device, from, to, page, size])
  const pages = Math.max(1, Math.ceil(total / size))
  const cur = Math.min(page, pages - 1)

  async function exportCsv() {
    setBusy(true)
    const all: EventRow[] = []
    for (let off = 0; off < 50_000; off += 1000) {
      const { rows: r } = await fetchEvents(device, from, to, 1000, off)
      all.push(...r)
      if (r.length < 1000) break
    }
    const esc = (v: string) => `"${v.replaceAll('"', '""')}"`
    const csv = ['waktu_wib,waktu_utc,ruangan,status,dihitung_sebagai_perubahan,ts_mencurigakan',
      ...all.reverse().map((e) => [esc(wibFull(Date.parse(e.ts))), e.ts, esc(room), e.status, e.is_transition ? 'ya' : 'tidak', e.ts_suspect ? 'ya' : 'tidak'].join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `event-${device}-${new Date(from).toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(a.href)
    setBusy(false)
  }

  return (
    <Card title="Event terbaru" right={<button className="btn-outline" onClick={exportCsv} disabled={busy}><IconDownload size={16} />{busy ? 'Menyiapkan…' : 'Export CSV'}</button>}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-card text-xs text-muted"><tr><th className="py-2 pr-3 font-semibold">Waktu</th><th className="pr-3 font-semibold">Status</th><th className="font-semibold">Durasi</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className={`border-t border-line ${e.debounced ? 'opacity-70' : ''}`}>
                <td className="py-2.5 pr-3 font-mono text-[13px]">{wibDayTime(e.ts)}:{wibTimeSec(e.ts).slice(-2)}</td>
                <td className="pr-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${e.status === 'occupied' ? 'bg-occ-bg text-occ-fg' : 'bg-vac-bg text-vac-fg'}`}>{e.status === 'occupied' ? 'Occupied' : 'Vacant'}</span>
                  {e.debounced && <span title="Status singkat yang dianggap kedipan sensor (debounce), tidak dihitung di statistik" className="ml-2 rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-muted">kedipan</span>}</td>
                <td className="text-muted">{e.duration_s === null ? 'berjalan' : fmtDuration(e.duration_s)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-muted">Tidak ada event pada periode ini.</td></tr>}
          </tbody>
        </table>
      </div>
      {total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm text-muted">
          <span>{cur * size + 1}–{Math.min((cur + 1) * size, total)} dari {total} perubahan</span>
          <div className="flex items-center gap-2">
            <select className="field !w-auto !py-1" aria-label="Baris per halaman" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0) }}>
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / halaman</option>)}
            </select>
            <button className="btn-outline !min-h-9 !px-3" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Sebelumnya</button>
            <span className="tabular-nums">{cur + 1} / {pages}</span>
            <button className="btn-outline !min-h-9 !px-3" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Berikutnya</button>
          </div>
        </div>
      )}
    </Card>
  )
}
