import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'

export default function Account() {
  const { user } = useAuth()
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (pw.length < 8) return setMsg({ ok: false, text: 'Password baru minimal 8 karakter.' })
    try {
      await api('POST', '/me/password', { current, password: pw })
      setCurrent(''); setPw('')
      setMsg({ ok: true, text: 'Password diganti. Sesi di perangkat lain sudah keluar.' })
    } catch (x) { setMsg({ ok: false, text: (x as Error).message }) }
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-lg font-semibold">Akun saya</h1>
      <p className="text-sm text-muted">{user?.email} · {user?.role}</p>
      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-line bg-card p-5 shadow-sm">
        <h2 className="font-semibold">Ganti password</h2>
        <input className="field" type="password" autoComplete="current-password" placeholder="Password saat ini" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input className="field" type="password" autoComplete="new-password" placeholder="Password baru (min. 8 karakter)" value={pw} onChange={(e) => setPw(e.target.value)} />
        {msg && <div role="alert" className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-ok-bg text-ok' : 'bg-bad-bg text-bad'}`}>{msg.text}</div>}
        <button className="btn-primary" disabled={!current || !pw}>Simpan password</button>
      </form>
    </div>
  )
}
