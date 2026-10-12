import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useNow, useTheme } from '../lib/theme'
import { useDeviceStatus, useDevices } from '../lib/data'
import { fmtAgo } from '../lib/time'
import { IconMoon, IconRss, IconSun } from './Icons'

const initials = (email: string) => (email.split('@')[0].match(/[a-z0-9]+/gi) ?? ['?']).slice(0, 2).map((s) => s[0]).join('').toUpperCase()

export default function Layout() {
  const { user, logout } = useAuth()
  const role = user?.role
  const { dark, toggle } = useTheme()
  const devices = useDevices()
  const dev = devices?.[0]?.device_id ?? null
  const ds = useDeviceStatus(dev)
  const now = useNow(5000)
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-[10px] px-3.5 py-2.5 text-sm no-underline ${isActive ? 'bg-brand-soft font-semibold text-occ-fg' : 'font-medium text-muted hover:text-fg'}`

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-card px-4 py-3.5 sm:px-8">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-brand text-brand-fg"><IconRss /></span>
            <span className="text-[17px] font-extrabold tracking-tight">Presence</span>
          </div>
          <nav aria-label="Navigasi utama" className="flex flex-wrap gap-1">
            <NavLink to="/" end className={link}>Dashboard</NavLink>
            {role === 'admin' && <NavLink to="/settings/mqtt" className={link}>Koneksi MQTT</NavLink>}
            {role === 'admin' && <NavLink to="/settings/users" className={link}>User</NavLink>}
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {dev && ds && (
            <div className="hidden items-center gap-2 rounded-full border border-line px-3 py-2 text-[13px] md:flex">
              <span className={`h-2 w-2 rounded-full ${ds.online ? 'bg-occ' : 'bg-off'}`} aria-hidden />
              <span className="font-semibold">{dev} · {ds.online ? 'Online' : 'Offline'}</span>
              {ds.last_seen && <span className="text-muted">{fmtAgo(now - Date.parse(ds.last_seen))}</span>}
            </div>
          )}
          <button type="button" onClick={toggle} aria-label={dark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'} title="Ganti tema"
            className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-card hover:bg-surface2">
            {dark ? <IconSun /> : <IconMoon />}
          </button>
          <NavLink to="/akun" className="flex items-center gap-2.5 no-underline" title="Akun saya">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-soft text-[13px] font-bold text-occ-fg">{initials(user?.email ?? '?')}</span>
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="max-w-40 truncate text-[13px] font-semibold">{user?.email}</span>
              <span className="text-xs capitalize text-muted">{role}</span>
            </span>
          </NavLink>
          <button className="btn-ghost !min-h-9 !px-3" onClick={() => void logout()}>Keluar</button>
        </div>
      </header>
      <main className="mx-auto max-w-[1280px] px-4 pb-12 pt-8 sm:px-8"><Outlet /></main>
    </div>
  )
}
