import { useMemo } from 'react'
import Chart, { cssVar, type EOption } from './Chart'
import type { Bucket, Segment } from '../lib/data'
import { fmtDuration, wibDay, wibDayTime, wibTime } from '../lib/time'

const mono = 'IBM Plex Mono, ui-monospace, monospace'
const axisText = () => ({ color: cssVar('--muted'), fontSize: 11, fontFamily: mono })

export function Legend({ items }: { items: { label: string; kind: 'occ' | 'vac' | 'off' }[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-[3px] ${i.kind === 'off' ? 'pattern-off border border-off' : i.kind === 'occ' ? 'bg-occ' : 'bg-vac'}`} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

/** Pita status: kapan terisi / kosong / offline (lebar proporsional durasi). */
export function TimelineBar({ segments, from, to, live }: { segments: Segment[]; from: number; to: number; live: boolean }) {
  const end = live ? Math.min(to, Date.now()) : to
  const parts = useMemo(() => {
    const out: { kind: Segment['kind'] | 'none'; start: number; end: number }[] = []
    let t = from
    for (const s of segments) {
      if (s.start > t) out.push({ kind: 'none', start: t, end: s.start })
      out.push(s)
      t = Math.max(t, s.end)
    }
    if (t < end) out.push({ kind: 'none', start: t, end })
    return out
  }, [segments, from, end])

  const span = end - from
  const ticks = [0, 1, 2, 3, 4].map((i) => {
    const t = from + (span * i) / 4
    if (i === 4 && live) return 'Sekarang'
    return i === 0 || span > 36 * 3600e3 ? wibDayTime(t) : wibTime(t)
  })
  const name = { occupied: 'Occupied', vacant: 'Vacant', offline: 'Offline', none: 'Tanpa data' } as const

  return (
    <div>
      <div role="img" aria-label="Timeline status occupied, vacant, dan offline" className="flex h-12 gap-0.5 overflow-hidden rounded-[10px]">
        {parts.map((p, i) => (
          <div key={i} title={`${name[p.kind]} · ${wibDayTime(p.start)} – ${wibDayTime(p.end)} (${fmtDuration((p.end - p.start) / 1000)})`}
            style={{ flex: `${p.end - p.start} 1 0`, minWidth: 3 }}
            className={p.kind === 'occupied' ? 'bg-occ' : p.kind === 'vacant' ? 'bg-vac' : p.kind === 'offline' ? 'pattern-off' : 'bg-surface2'} />
        ))}
      </div>
      <div className="mt-3 flex justify-between font-mono text-xs text-muted">{ticks.map((t, i) => <span key={i}>{t}</span>)}</div>
    </div>
  )
}

/** Jumlah transisi occupied vs vacant per bucket waktu. */
export function BucketChart({ buckets, bucketMs, dark }: { buckets: Bucket[]; bucketMs: number; dark: boolean }) {
  const option = useMemo<EOption>(() => {
    const day = bucketMs >= 86400e3
    const cats = buckets.map((b) => b.start)
    const multiDay = buckets.length > 0 && wibDay(buckets[0].start) !== wibDay(buckets[buckets.length - 1].start)
    const radius = [4, 4, 0, 0]
    return {
      animation: false,
      grid: { left: 30, right: 4, top: 8, bottom: 28 },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: { dataIndex: number; seriesName: string; value: number; marker: string }[]) =>
          `<b>${wibDayTime(cats[ps[0].dataIndex])}</b>` + (bucketMs >= 60e3 ? ` <span style="opacity:.7">(+${fmtDuration(bucketMs / 1000)})</span>` : '') +
          ps.map((p) => `<br/>${p.marker}${p.seriesName}: <b>${p.value}</b>`).join(''),
      },
      xAxis: { type: 'category', data: cats.map((c) => (day ? wibDay(c) : multiDay ? `${wibDay(c)}\n${wibTime(c)}` : wibTime(c))), axisLabel: { ...axisText(), hideOverlap: true }, axisLine: { lineStyle: { color: cssVar('--line') } }, axisTick: { show: false } },
      yAxis: { type: 'value', minInterval: 1, axisLabel: axisText(), splitLine: { lineStyle: { color: cssVar('--line') } } },
      series: [
        { name: 'Occupied', type: 'bar', data: buckets.map((b) => b.occupied), itemStyle: { color: cssVar('--occ'), borderRadius: radius }, barMaxWidth: 14, barGap: '15%' },
        { name: 'Vacant', type: 'bar', data: buckets.map((b) => b.vacant), itemStyle: { color: cssVar('--vac'), borderRadius: radius }, barMaxWidth: 14 },
      ],
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, bucketMs, dark])
  return <Chart option={option} height={200} label="Grafik batang jumlah perubahan status occupied dan vacant per periode waktu" />
}

const DAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']

/** Pola okupansi: porsi terisi rata-rata per hari × jam (WIB). */
export function Heatmap({ cells }: { cells: (number | null)[][] | null }) {
  const max = cells ? Math.max(0.0001, ...cells.flat().map((v) => v ?? 0)) : 1
  return (
    <div role="img" aria-label="Peta panas okupansi per hari dan jam">
      <div className="grid gap-1" style={{ gridTemplateColumns: '28px repeat(24, minmax(0, 1fr))' }}>
        {DAYS.map((d, di) => (
          <div key={d} className="contents">
            <span className="self-center text-xs text-muted">{d}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const v = cells?.[di]?.[h] ?? null
              const pct = v === null ? 0 : Math.round((v / max) * 100)
              return <span key={h} title={v === null ? `${d} ${String(h).padStart(2, '0')}:00 · belum ada data` : `${d} ${String(h).padStart(2, '0')}:00 · terisi ${Math.round(v * 100)}%`}
                className="aspect-square rounded-[5px]" style={{ background: `color-mix(in srgb, var(--occ) ${pct}%, var(--heat-low))`, opacity: v === null ? 0.5 : 1 }} />
            })}
          </div>
        ))}
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="font-mono text-[11px] text-muted">{h % 6 === 0 ? String(h).padStart(2, '0') : ''}</span>)}
      </div>
    </div>
  )
}
