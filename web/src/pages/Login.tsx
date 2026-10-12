import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/theme'

export default function Login() {
  useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'reset'>('login')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setMsg({ ok: false, text: error.message === 'Invalid login credentials' ? 'Email atau password salah.' : error.message })
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
      setMsg(error ? { ok: false, text: error.message } : { ok: true, text: 'Jika email terdaftar, tautan reset password sudah dikirim.' })
    }
    setBusy(false)
  }

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-brand" aria-hidden><span className="h-3 w-3 rounded-full bg-brand-fg" /></span>
          Presence Monitor
        </div>
        <p className="text-sm text-muted">{mode === 'login' ? 'Masuk untuk melihat status ruangan. Akun hanya lewat undangan admin.' : 'Masukkan email akun Anda untuk menerima tautan reset password.'}</p>
        <label className="block text-sm">Email
          <input className="field mt-1" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === 'login' && (
          <label className="block text-sm">Password
            <input className="field mt-1" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        {msg && <div role="alert" className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-ok-bg text-ok' : 'bg-bad-bg text-bad'}`}>{msg.text}</div>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Memproses…' : mode === 'login' ? 'Masuk' : 'Kirim tautan reset'}</button>
        <button type="button" className="w-full text-center text-sm text-muted underline" onClick={() => { setMode(mode === 'login' ? 'reset' : 'login'); setMsg(null) }}>
          {mode === 'login' ? 'Lupa password?' : 'Kembali ke login'}
        </button>
      </form>
    </div>
  )
}
