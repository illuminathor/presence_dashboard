import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'
import { IconEye, IconEyeOff, IconInfo, IconPresence } from '../components/Icons'

export default function Login() {
  useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [hint, setHint] = useState(false)
  const { login } = useAuth()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    try { await login(email, password) } catch (x) { setErr((x as Error).message); setBusy(false) }
  }

  return (
    <div className="grid min-h-screen bg-app lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#0B3D24] p-12 text-white lg:flex">
        <div className="flex items-center gap-3 text-lg font-extrabold">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15"><IconPresence size={22} /></span>Presence
        </div>
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" aria-hidden>
          {[420, 300, 190].map((s, i) => <span key={s} className="absolute rounded-full border border-white/15" style={{ width: s, height: s, left: -s / 2, top: -s / 2, opacity: 1 - i * 0.15 }} />)}
          <span className="absolute -left-2 -top-2 h-4 w-4 rounded-full bg-[#4ADE80]" />
        </div>
        <div className="relative">
          <h1 className="max-w-md text-4xl font-extrabold leading-tight">Tahu ruangan mana yang sedang terpakai, kapan saja.</h1>
          <p className="mt-3 max-w-md text-white/70">Pantau okupansi real-time dari sensor radar 24 GHz.</p>
        </div>
      </aside>

      <main className="grid place-items-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Masuk</h2>
            <p className="mt-1 text-sm text-muted">Gunakan akun yang dibuat oleh admin.</p>
          </div>
          <label className="block text-sm font-semibold">Email
            <input className="field mt-1.5 font-normal" type="email" required autoComplete="email" placeholder="nama@perusahaan.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block text-sm font-semibold">
            <span className="flex justify-between">Password
              <button type="button" className="font-semibold text-brand" onClick={() => setHint((h) => !h)}>Lupa password?</button></span>
            <span className="relative mt-1.5 block">
              <input className="field pr-10 font-normal" type={show ? 'text' : 'password'} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" onClick={() => setShow((s) => !s)}>{show ? <IconEyeOff size={18} /> : <IconEye size={18} />}</button>
            </span>
          </label>
          {hint && <div className="rounded-lg bg-surface2 px-3 py-2 text-sm text-muted">Minta admin untuk mengganti password akun Anda.</div>}
          {err && <div role="alert" className="rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">{err}</div>}
          <button className="btn-primary w-full !py-3" disabled={busy}>{busy ? 'Memproses…' : 'Masuk'}</button>
          <div className="flex gap-2 rounded-xl bg-surface2 p-3 text-xs text-muted"><span className="mt-0.5 shrink-0"><IconInfo size={16} /></span>Akses hanya melalui undangan. Hubungi admin bila Anda belum memiliki akun.</div>
        </form>
      </main>
    </div>
  )
}
