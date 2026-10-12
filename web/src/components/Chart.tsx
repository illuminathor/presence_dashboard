import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, CustomChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([BarChart, CustomChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

export type EOption = echarts.EChartsCoreOption

/** Pembungkus ECharts: init sekali, setOption saat berubah, ikut resize. */
export default function Chart({ option, height, label }: { option: EOption; height: number; label: string }) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    const c = echarts.init(el.current!, undefined, { renderer: 'canvas' })
    chart.current = c
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el.current!)
    return () => { ro.disconnect(); c.dispose(); chart.current = null }
  }, [])

  useEffect(() => { chart.current?.setOption(option, true) }, [option])

  return <div ref={el} role="img" aria-label={label} style={{ height, width: '100%' }} />
}

/** Warna dari CSS variable (ikut tema terang/gelap). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
