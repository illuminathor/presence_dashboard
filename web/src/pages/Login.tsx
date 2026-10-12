import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'

export default function Login() {
  useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { login } = useAuth()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    try { await login(email, password) } catch (x) { setErr((x as Error).message); setBusy(false) }
  }

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-brand" aria-hidden><span className="h-3 w-3 rounded-full bg-brand-fg" /></span>
          Presence Monitor
        </div>
        <p className="text-sm text-muted">Masuk untuk melihat status ruangan. Akun dibuat oleh admin; lupa password? Minta admin menggantinya.</p>
        <label className="block text-sm">Email
          <input className="field mt-1" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm">Password
          <input className="field mt-1" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <div role="alert" className="rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">{err}</div>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Memproses…' : 'Masuk'}</button>
      </form>
    </div>
  )
}
