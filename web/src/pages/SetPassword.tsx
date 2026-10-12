import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

export default function SetPassword() {
  const { clearRecovery } = useAuth()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 8) return setErr('Minimal 8 karakter.')
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) setErr(error.message); else clearRecovery()
  }
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-card p-6">
        <h1 className="text-lg font-semibold">Atur password baru</h1>
        <input className="field" type="password" autoComplete="new-password" placeholder="Password baru (min. 8 karakter)" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <div role="alert" className="rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">{err}</div>}
        <button className="btn-primary w-full">Simpan password</button>
      </form>
    </div>
  )
}
