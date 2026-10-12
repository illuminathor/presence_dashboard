import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'

export default function Layout() {
  const { user, logout } = useAuth()
  const role = user?.role
  const { dark, toggle } = useTheme()
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-off-bg font-medium' : 'text-muted hover:text-fg'}`

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-brand-fg" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-brand-fg" />
            </span>
            Presence Monitor
          </div>
          <nav className="flex gap-1">
            <NavLink to="/" end className={link}>Dashboard</NavLink>
            {role === 'admin' && <NavLink to="/settings/mqtt" className={link}>Konfigurasi MQTT</NavLink>}
            {role === 'admin' && <NavLink to="/settings/users" className={link}>User</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn-ghost !px-3" onClick={toggle} aria-label={dark ? 'Ganti ke tema terang' : 'Ganti ke tema gelap'} title="Ganti tema">
              {dark ? '☀️' : '🌙'}
            </button>
            <NavLink to="/akun" className="hidden text-xs text-muted underline-offset-2 hover:underline sm:inline" title="Akun saya">{user?.email} · {role}</NavLink>
            <button className="btn-ghost" onClick={() => void logout()}>Keluar</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5"><Outlet /></main>
    </div>
  )
}
