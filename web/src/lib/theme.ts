import { useCallback, useEffect, useState } from 'react'

const mq = () => matchMedia('(prefers-color-scheme: dark)')
const read = (): boolean => {
  try { const t = localStorage.getItem('theme'); if (t) return t === 'dark' } catch { /* abaikan */ }
  return mq().matches
}

/** Default mengikuti sistem; toggle manual disimpan di browser. */
export function useTheme() {
  const [dark, setDark] = useState(read)
  useEffect(() => { document.documentElement.classList.toggle('dark', dark) }, [dark])
  useEffect(() => {
    const m = mq()
    const on = () => { try { if (localStorage.getItem('theme')) return } catch { /* abaikan */ } setDark(m.matches) }
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  const toggle = useCallback(() => {
    setDark((d) => { try { localStorage.setItem('theme', d ? 'light' : 'dark') } catch { /* abaikan */ } return !d })
  }, [])
  return { dark, toggle }
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(i) }, [intervalMs])
  return now
}
