import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, get } from '../lib/api'
import { useAuth } from '../lib/auth'

interface Row { id: number; email: string; role: 'admin' | 'viewer'; created_at: number }

export default function Users() {
  const { user } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [role, setRole] = useState<'admin' | 'viewer'>('viewer')

  const load = useCallback(() => { get<Row[]>('/users').then(setRows).catch((e) => setMsg({ ok: false, text: e.message })) }, [])
  useEffect(load, [load])

  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setMsg(null)
    try { await fn(); setMsg({ ok: true, text: okText }); load() } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    await run(() => api('POST', '/users', { email, password: pw, role }), `User ${email} dibuat.`)
    setEmail(''); setPw('')
  }
  function resetPw(r: Row) {
    const p = window.prompt(`Password baru untuk ${r.email} (min. 8 karakter):`)
    if (p) void run(() => api('PATCH', `/users/${r.id}`, { password: p }), `Password ${r.email} diganti.`)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">User</h1>
      {msg && <div role="alert" className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-ok-bg text-ok' : 'bg-bad-bg text-bad'}`}>{msg.text}</div>}

      <form onSubmit={add} className="grid gap-3 rounded-2xl border border-line bg-card p-5 shadow-sm sm:grid-cols-6">
        <h2 className="font-semibold sm:col-span-6">Tambah user</h2>
        <input className="field sm:col-span-2" type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="field sm:col-span-2" type="text" required minLength={8} autoComplete="off" placeholder="Password awal (min. 8)" value={pw} onChange={(e) => setPw(e.target.value)} />
        <select className="field" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'viewer')}><option value="viewer">viewer</option><option value="admin">admin</option></select>
        <button className="btn-primary">Tambah</button>
        <p className="text-xs text-muted sm:col-span-6">Bagikan password awal ke yang bersangkutan; mereka bisa menggantinya di menu Akun.</p>
      </form>

      <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{r.email}{r.id === user?.id && <span className="ml-2 text-xs text-muted">(Anda)</span>}</span>
              <select className="field !w-auto" value={r.role} disabled={r.id === user?.id}
                onChange={(e) => void run(() => api('PATCH', `/users/${r.id}`, { role: e.target.value }), `Role ${r.email} diubah.`)}>
                <option value="viewer">viewer</option><option value="admin">admin</option>
              </select>
              <button className="btn-ghost" onClick={() => resetPw(r)}>Ganti password</button>
              <button className="btn-ghost text-bad" disabled={r.id === user?.id}
                onClick={() => window.confirm(`Hapus ${r.email}?`) && void run(() => api('DELETE', `/users/${r.id}`), `${r.email} dihapus.`)}>Hapus</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
