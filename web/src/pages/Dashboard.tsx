import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchEvents, useDashboard, useDeviceStatus, useDevices, type EventRow, type PeriodStats } from '../lib/data'
import { PRESETS, fmtAgo, fmtDuration, fromWibInput, toWibInput, windowFromParams, wibFull, wibTime, wibTimeSec, wibDayTime, type PresetKey } from '../lib/time'
import { useNow, useTheme } from '../lib/theme'
import { BucketChart, TimelineChart } from '../components/Charts'

const LABEL = { occupied: 'TERISI', vacant: 'KOSONG' } as const

function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-card p-4 shadow-sm ${className}`}>
      {title && <h2 className="mb-3 text-sm font-medium text-muted">{title}</h2>}
      {children}
    </section>
  )
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev === 0 && cur === 0) return <span className="text-muted">– sama dgn periode lalu</span>
  if (prev === 0) return <span className="text-muted">baru (periode lalu 0)</span>
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (pct === 0) return <span className="text-muted">= sama dgn periode lalu ({prev})</span>
  return <span className={pct > 0 ? 'text-occ-fg' : 'text-vac-fg'}>{pct > 0 ? '↑' : '↓'} {Math.abs(pct)}% <span className="text-muted">vs {prev} periode lalu</span></span>
}

function CountCard({ kind, cur, prev }: { kind: 'occupied' | 'vacant'; cur: PeriodStats | undefined; prev: PeriodStats | undefined }) {
  const n = cur ? cur[`${kind}_count`] : null
  const p = prev ? prev[`${kind}_count`] : 0
  return (
    <Card>
      <div className={`flex items-center gap-2 text-sm font-medium ${kind === 'occupied' ? 'text-occ-fg' : 'text-vac-fg'}`}>
        <span aria-hidden>{kind === 'occupied' ? '●' : '○'}</span>
        {kind === 'occupied' ? 'Jadi terisi' : 'Jadi kosong'}
      </div>
      <div className="mt-2 text-4xl font-semibold tabular-nums">{n ?? '–'}</div>
      <div className="mt-1 text-xs">{n !== null && <Delta cur={n} prev={p} />}</div>
    </Card>
  )
}

export default function Dashboard() {
  const { dark } = useTheme()
  const [params, setParams] = useSearchParams()
  const devices = useDevices()
  const device = params.get('d') ?? devices?.[0]?.device_id ?? null
  const spec = useMemo(() => windowFromParams(params), [params])
  const { data, error, loading } = useDashboard(device, spec)
  const ds = useDeviceStatus(device)
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
  const lastSeen = ds?.last_seen ? Date.parse(ds.last_seen) : null

  if (devices && devices.length === 0) {
    return <Card><p className="py-8 text-center text-muted">Belum ada data sensor. Pastikan konfigurasi MQTT (menu admin) sudah benar dan sensor mengirim data.</p></Card>
  }

  return (
    <div className="space-y-4">
      {/* Bar atas: ruangan, status perangkat, time window */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          {devices && devices.length > 1 ? (
            <select className="field !w-auto font-medium" value={device ?? ''} onChange={(e) => setParam((p) => p.set('d', e.target.value))} aria-label="Pilih ruangan">
              {devices.map((d) => <option key={d.device_id} value={d.device_id}>{d.room_name || d.device_id}</option>)}
            </select>
          ) : <h1 className="text-lg font-semibold">{room || device || '…'}</h1>}
          {ds && (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${ds.online ? 'bg-ok-bg text-ok' : 'bg-off-bg text-off-fg'}`}>
              <span aria-hidden>{ds.online ? '●' : '○'}</span>{ds.online ? 'Online' : 'Offline'}
              {lastSeen && <span className="font-normal opacity-80">· data {fmtAgo(now - lastSeen)}</span>}
            </span>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1" role="group" aria-label="Time window">
          {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
            <button key={k} onClick={() => { pickPreset(k); setCustomOpen(false) }} aria-pressed={spec.preset === k}
              className={`rounded-lg border px-3 py-1.5 text-sm ${spec.preset === k ? 'border-brand bg-brand text-brand-fg' : 'border-line bg-card hover:bg-off-bg'}`}>
              {PRESETS[k].label}
            </button>
          ))}
          <button onClick={() => setCustomOpen((o) => !o)} aria-pressed={spec.preset === null}
            className={`rounded-lg border px-3 py-1.5 text-sm ${spec.preset === null ? 'border-brand bg-brand text-brand-fg' : 'border-line bg-card hover:bg-off-bg'}`}>
            Kustom
          </button>
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

      {/* F1–F3 + occupancy */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="col-span-2 lg:col-span-1">
          <div className="text-sm font-medium text-muted">Status sekarang</div>
          {ds && ds.current_status ? (
            <>
              <div className={`mt-2 flex items-center gap-2 text-3xl font-semibold ${!ds.online ? 'text-off-fg' : ds.current_status === 'occupied' ? 'text-occ-fg' : 'text-vac-fg'}`}>
                <span aria-hidden>{!ds.online ? '◌' : ds.current_status === 'occupied' ? '●' : '○'}</span>
                {!ds.online ? 'OFFLINE' : LABEL[ds.current_status]}
              </div>
              <div className="mt-1 text-xs text-muted">
                {!ds.online && <>Status terakhir: {LABEL[ds.current_status]} · </>}
                {since && <>sejak {wibTime(since)} WIB · <span className="tabular-nums">{fmtDuration((now - since) / 1000)}</span></>}
              </div>
            </>
          ) : <div className="mt-2 text-muted">Menunggu data…</div>}
        </Card>
        <CountCard kind="occupied" cur={cur} prev={prev} />
        <CountCard kind="vacant" cur={cur} prev={prev} />
        <Card>
          <div className="text-sm font-medium text-muted">Ruangan terpakai</div>
          <div className="mt-2 text-4xl font-semibold tabular-nums">{cur ? (cur.occupancy_rate === null ? '–' : `${cur.occupancy_rate}%`) : '–'}</div>
          <div className="mt-1 text-xs text-muted">
            {cur && <>{fmtDuration(cur.occupied_seconds)} terisi{cur.offline_seconds > 0 && <> · offline {fmtDuration(cur.offline_seconds)} dikecualikan</>}</>}
            {prev?.occupancy_rate != null && cur?.occupancy_rate != null && <div>Periode lalu {prev.occupancy_rate}%</div>}
          </div>
        </Card>
      </div>

      <Card title={`Timeline status${data ? ` · ${wibDayTime(data.from)} – ${wibDayTime(data.to)} WIB` : ''}`}>
        {data ? <TimelineChart segments={data.segments} from={data.from} to={data.to} dark={dark} /> : <div className="h-28 animate-pulse rounded-lg bg-off-bg" />}
      </Card>

      <Card title="Jumlah perubahan status per periode">
        {data ? <BucketChart buckets={data.buckets} bucketMs={data.bucketMs} dark={dark} /> : <div className="h-60 animate-pulse rounded-lg bg-off-bg" />}
        {loading && <div className="mt-1 text-right text-xs text-muted">memperbarui…</div>}
      </Card>

      {device && data && <EventLog device={device} from={data.from} to={data.to} room={room || device} />}
    </div>
  )
}

function EventLog({ device, from, to, room }: { device: string; from: number; to: number; room: string }) {
  const [rows, setRows] = useState<EventRow[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    let live = true
    fetchEvents(device, from, to, 100).then((r) => { if (live) setRows(r.rows) })
    return () => { live = false }
  }, [open, device, from, to])

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
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-muted">Log event</h2>
        <button className="btn-ghost ml-auto" onClick={() => setOpen((o) => !o)}>{open ? 'Sembunyikan' : 'Tampilkan'}</button>
        <button className="btn-ghost" onClick={exportCsv} disabled={busy}>{busy ? 'Menyiapkan…' : 'Unduh CSV'}</button>
      </div>
      {open && (
        <div className="mt-3 max-h-80 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-card text-xs text-muted"><tr><th className="py-1 pr-3">Waktu (WIB)</th><th className="pr-3">Status</th><th className="pr-3">Dihitung</th><th>Catatan</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="py-1 pr-3 tabular-nums">{wibDayTime(Date.parse(e.ts))}:{wibTimeSec(Date.parse(e.ts)).slice(-2)}</td>
                  <td className={`pr-3 font-medium ${e.status === 'occupied' ? 'text-occ-fg' : 'text-vac-fg'}`}>{e.status === 'occupied' ? '● Terisi' : '○ Kosong'}</td>
                  <td className="pr-3">{e.is_transition ? 'perubahan' : <span className="text-muted">heartbeat</span>}</td>
                  <td className="text-xs text-bad">{e.ts_suspect && 'jam perangkat tidak sinkron'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-muted">Tidak ada event pada periode ini.</td></tr>}
            </tbody>
          </table>
          {rows.length === 100 && <p className="mt-2 text-xs text-muted">Menampilkan 100 terbaru — unduh CSV untuk semuanya.</p>}
        </div>
      )}
    </Card>
  )
}
