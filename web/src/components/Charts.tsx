import { useMemo } from 'react'
import Chart, { cssVar, type EOption } from './Chart'
import type { Bucket, Segment } from '../lib/data'
import { fmtDuration, fromChartX, toChartX, wibDay, wibDayTime, wibFull, wibTime } from '../lib/time'

const KINDS = ['occupied', 'vacant', 'offline'] as const
const KIND = {
  occupied: { label: 'Terisi', varName: '--occ' },
  vacant: { label: 'Kosong', varName: '--vac' },
  offline: { label: 'Offline', varName: '--off' },
} as const

const axisText = () => ({ color: cssVar('--muted'), fontSize: 11 })

/** Pita status (state band): kapan ruangan terisi / kosong / offline. */
export function TimelineChart({ segments, from, to, dark }: { segments: Segment[]; from: number; to: number; dark: boolean }) {
  const option = useMemo<EOption>(() => {
    const data = segments.map((s) => ({ value: [toChartX(s.start), toChartX(s.end), KINDS.indexOf(s.kind)], itemStyle: { color: cssVar(KIND[s.kind].varName) } }))
    return {
      useUTC: true,
      animation: false,
      grid: { left: 8, right: 12, top: 6, bottom: 26 },
      tooltip: {
        trigger: 'item',
        formatter: (p: { value: [number, number, number] }) => {
          const [a, b, ki] = p.value
          const k = KINDS[ki]
          const s = fromChartX(a), e = fromChartX(b)
          return `<b>${KIND[k].label}</b><br/>${wibFull(s)}<br/>s/d ${wibFull(e)}<br/>Durasi ${fmtDuration((e - s) / 1000)}`
        },
      },
      xAxis: {
        type: 'time', min: toChartX(from), max: toChartX(to), axisLabel: { ...axisText(), hideOverlap: true },
        axisLine: { lineStyle: { color: cssVar('--line') } }, splitLine: { show: false },
      },
      yAxis: { type: 'value', min: 0, max: 1, show: false },
      series: [{
        type: 'custom', data, encode: { x: [0, 1] },
        renderItem: (_p: unknown, api: any) => {
          const start = api.coord([api.value(0), 0.5]), end = api.coord([api.value(1), 0.5])
          const h = 56, w = Math.max(end[0] - start[0], 1)
          const kind = KINDS[api.value(2) as number]
          const rect = { x: start[0], y: start[1] - h / 2, width: w, height: h }
          return {
            type: 'group',
            children: [
              { type: 'rect', shape: rect, style: api.style(), emphasis: { style: { opacity: 0.85 } } },
              ...(w > 64 ? [{ type: 'text', style: { text: KIND[kind].label, x: rect.x + w / 2, y: rect.y + h / 2, textAlign: 'center', textVerticalAlign: 'middle', fill: dark && kind !== 'offline' ? '#04201c' : '#ffffff', fontSize: 12, fontWeight: 600 }, silent: true }] : []),
            ],
          }
        },
      }],
    }
  }, [segments, from, to, dark])

  return (
    <div>
      <Chart option={option} height={104} label="Timeline status ruangan: terisi, kosong, dan offline sepanjang periode" />
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => (
          <li key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: `var(${KIND[k].varName})` }} />{KIND[k].label}</li>
        ))}
      </ul>
    </div>
  )
}

/** Jumlah transisi occupied vs vacant per bucket waktu. */
export function BucketChart({ buckets, bucketMs, dark }: { buckets: Bucket[]; bucketMs: number; dark: boolean }) {
  const option = useMemo<EOption>(() => {
    const day = bucketMs >= 86400e3
    const lab = (t: number) => (day ? wibDay(t) : wibTime(t))
    const cats = buckets.map((b) => b.start)
    const multiDay = buckets.length > 0 && wibDay(buckets[0].start) !== wibDay(buckets[buckets.length - 1].start)
    return {
      animation: false,
      grid: { left: 36, right: 8, top: 28, bottom: 28 },
      legend: { top: 0, right: 0, textStyle: axisText(), itemWidth: 12, itemHeight: 8 },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: { dataIndex: number; seriesName: string; value: number; marker: string }[]) =>
          `<b>${wibDayTime(cats[ps[0].dataIndex])}</b>` + (bucketMs >= 60e3 ? ` <span style="opacity:.7">(+${fmtDuration(bucketMs / 1000)})</span>` : '') +
          ps.map((p) => `<br/>${p.marker}${p.seriesName}: <b>${p.value}</b>`).join(''),
      },
      xAxis: { type: 'category', data: cats.map((c) => (multiDay && !day ? `${wibDay(c)}\n${wibTime(c)}` : lab(c))), axisLabel: { ...axisText(), hideOverlap: true }, axisLine: { lineStyle: { color: cssVar('--line') } } },
      yAxis: { type: 'value', minInterval: 1, axisLabel: axisText(), splitLine: { lineStyle: { color: cssVar('--line') } } },
      series: [
        { name: 'Jadi terisi', type: 'bar', data: buckets.map((b) => b.occupied), itemStyle: { color: cssVar('--occ'), borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22 },
        { name: 'Jadi kosong', type: 'bar', data: buckets.map((b) => b.vacant), itemStyle: { color: cssVar('--vac'), borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22 },
      ],
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, bucketMs, dark])
  return <Chart option={option} height={240} label="Grafik batang jumlah perubahan status terisi dan kosong per periode waktu" />
}
