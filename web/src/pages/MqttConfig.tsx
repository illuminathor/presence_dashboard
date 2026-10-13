import { useCallback, useEffect, useRef, useState } from 'react'
import { api, get } from '../lib/api'
import { fmtAgo, wibTimeSec } from '../lib/time'
import { IconEye, IconEyeOff, IconLock } from '../components/Icons'
import { useNow } from '../lib/theme'

interface Form { host: string; protocol: 'mqtt' | 'mqtts' | 'ws' | 'wss'; port: string; username: string; password: string; topic_status: string; topic_online: string }
interface Step { id: string; label: string; status: 'pending' | 'running' | 'ok' | 'failed'; detail?: string }
interface Sample { t: string; topic: string; payload: string; ok: boolean; reason?: string }
interface TestRow { id: string; status: 'pending' | 'running' | 'done' | 'failed'; steps: Step[]; sample_messages: Sample[] }
interface IngestStatus { state: 'unconfigured' | 'connected' | 'reconnecting' | 'error'; last_message_at: string | null; last_error: string | null; msg_count: number; invalid_count: number; devices: string[]; recent: Sample[] }
interface Dev { device_id: string; room_name: string | null }

const DEFAULT_PORT = { mqtt: '1883', mqtts: '8883', ws: '8083', wss: '8084' } as const
const EMPTY: Form = { host: '', protocol: 'mqtt', port: '1883', username: '', password: '', topic_status: 'presence/+/status', topic_online: 'presence/+/online' }

const STEP_ICON = { pending: '○', running: '…', ok: '✓', failed: '✕' } as const
const STEP_CLR = { pending: 'text-muted', running: 'text-brand', ok: 'text-ok', failed: 'text-bad' } as const

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-6">
      <div className="mb-4 flex items-center gap-2"><h2 className="text-[15px] font-bold">{title}</h2><div className="ml-auto">{right}</div></div>
      {children}
    </section>
  )
}

function Messages({ list }: { list: Sample[] }) {
  if (!list.length) return <p className="text-sm text-muted">Belum ada pesan.</p>
  return (
    <ul className="max-h-64 space-y-1.5 overflow-auto text-xs">
      {list.map((m, i) => (
        <li key={i} className="rounded-lg border border-line p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums text-muted">{wibTimeSec(Date.parse(m.t))}</span>
            <span className="font-mono">{m.topic}</span>
            <span className={`ml-auto rounded-full px-2 py-0.5 font-medium ${m.ok ? 'bg-ok-bg text-ok' : 'bg-bad-bg text-bad'}`}>{m.ok ? '✓ Sesuai' : '✕ Tidak sesuai'}</span>
          </div>
          <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-muted">{m.payload}</pre>
          {m.reason && <div className="mt-1 text-bad">{m.reason}</div>}
        </li>
      ))}
    </ul>
  )
}

export default function MqttConfig() {
  const [form, setForm] = useState<Form>(EMPTY)
  const [hasPassword, setHasPassword] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [deb, setDeb] = useState('')
  const [debSaved, setDebSaved] = useState('')
  const [test, setTest] = useState<TestRow | null>(null)
  const [testedKey, setTestedKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [ingest, setIngest] = useState<IngestStatus | null>(null)
  const [devs, setDevs] = useState<Dev[]>([])
  const now = useNow(1000)
  const formKey = JSON.stringify(form)

  useEffect(() => {
    get<(Omit<Form, 'port' | 'password' | 'topic_online' | 'username'> & { port: number; username: string | null; topic_online: string | null; has_password: boolean }) | null>('/mqtt/config').then((data) => {
      if (data) {
        setForm({ host: data.host, protocol: data.protocol, port: String(data.port), username: data.username ?? '', password: '', topic_status: data.topic_status, topic_online: data.topic_online ?? '' })
        setHasPassword(data.has_password)
      }
      setLoaded(true)
    }).catch(() => setLoaded(true))
    get<Dev[]>('/devices').then(setDevs).catch(() => {})
    get<{ debounce_seconds: number }>('/settings').then((r) => { setDeb(String(r.debounce_seconds)); setDebSaved(String(r.debounce_seconds)) }).catch(() => {})
  }, [])

  // status ingest (badge + pesan live), polling 3 dtk
  useEffect(() => {
    let live = true
    const load = () => get<IngestStatus>('/mqtt/status').then((data) => { if (live) setIngest(data) }).catch(() => {})
    load(); const i = setInterval(load, 3000)
    return () => { live = false; clearInterval(i) }
  }, [])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))
  const complete = form.host.trim() && Number(form.port) > 0 && form.topic_status.trim()

  const pollTimer = useRef<ReturnType<typeof setInterval>>(undefined)
  useEffect(() => () => clearInterval(pollTimer.current), [])

  const runTest = useCallback(async () => {
    setNotice(null); setTesting(true); setTest(null)
    const payload = { host: form.host.trim(), port: Number(form.port), protocol: form.protocol, username: form.username.trim() || null, password: form.password, topic_status: form.topic_status.trim(), topic_online: form.topic_online.trim() || null }
    let id: string
    try { id = (await api<{ id: string }>('POST', '/mqtt/test', payload)).id } catch (e) { setTesting(false); return setNotice({ ok: false, text: `Gagal memulai tes: ${(e as Error).message}` }) }
    const key = formKey
    const started = Date.now()
    clearInterval(pollTimer.current)
    pollTimer.current = setInterval(async () => {
      const row = await get<TestRow>(`/mqtt/test/${id}`).catch(() => null)
      if (row) setTest(row)
      const done = row && (row.status === 'done' || row.status === 'failed')
      if (done || Date.now() - started > 60_000) {
        clearInterval(pollTimer.current); setTesting(false)
        if (done) {
          const st = row.steps.slice(0, 3)
          if (st.length === 3 && st.every((x) => x.status === 'ok')) setTestedKey(key)
        } else setNotice({ ok: false, text: 'Tes tidak selesai dalam 60 detik.' })
      }
    }, 1000)
  }, [form, formKey])

  async function save() {
    setSaving(true); setNotice(null)
    try {
      const r = await api<{ ok: boolean; error?: string }>('PUT', '/mqtt/config', {
        host: form.host, port: Number(form.port), protocol: form.protocol, username: form.username,
        password: form.password, topic_status: form.topic_status, topic_online: form.topic_online,
      })
      setSaving(false)
      if (!r.ok) return setNotice({ ok: false, text: `Tersimpan, tapi gagal menyambung: ${r.error}. Koneksi lama (bila ada) tetap dipakai.` })
    } catch (e) { setSaving(false); return setNotice({ ok: false, text: (e as Error).message }) }
    if (form.password) setHasPassword(true)
    set('password', '')
    setNotice({ ok: true, text: 'Tersimpan dan terhubung ke broker. Bila config baru gagal, config lama tetap dipakai.' })
  }

  async function saveDebounce() {
    try {
      const r = await api<{ debounce_seconds: number }>('PUT', '/settings', { debounce_seconds: Number(deb) })
      setDeb(String(r.debounce_seconds)); setDebSaved(String(r.debounce_seconds))
      setNotice({ ok: true, text: 'Debounce tersimpan. Angka di dashboard langsung memakai pengaturan baru.' })
    } catch (e) { setNotice({ ok: false, text: (e as Error).message }) }
  }

  async function renameRoom(id: string, name: string) {
    try { await api('PATCH', `/devices/${encodeURIComponent(id)}`, { room_name: name.trim() || null }) }
    catch (e) { setNotice({ ok: false, text: (e as Error).message }) }
  }

  const canSave = Boolean(complete) && testedKey === formKey && !saving
  const badge = (() => {
    if (testing) return { t: 'Sedang menguji', c: 'bg-brand text-brand-fg' }
    if (!ingest || ingest.state === 'unconfigured') return { t: 'Belum dites', c: 'bg-off-bg text-off-fg' }
    if (ingest.state === 'connected') return { t: `Terhubung${ingest.last_message_at ? ` · pesan ${fmtAgo(now - Date.parse(ingest.last_message_at))}` : ''}`, c: 'bg-ok-bg text-ok' }
    return { t: 'Gagal terhubung', c: 'bg-bad-bg text-bad' }
  })()

  if (!loaded) return <p className="text-muted">Memuat…</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-muted">Pengaturan · Khusus admin</div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">Koneksi MQTT</h1>
          <p className="mt-1 text-sm text-muted">Hubungkan dashboard ke broker tempat Shelly 2PM mengirim data presence.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${badge.c}`} role="status">{badge.t}</span>
      </div>
      {ingest?.last_error && ingest.state !== 'connected' && <div className="rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">{ingest.last_error}</div>}
      {ingest?.last_error && ingest.state === 'connected' && <div className="rounded-lg bg-occ-bg px-3 py-2 text-sm text-occ-fg">{ingest.last_error}</div>}

      <div className="grid items-start gap-4 lg:grid-cols-2">
      <div className="space-y-4">
      <Section title="Broker & topic">
        <div className="grid gap-3 sm:grid-cols-6">
          <label className="text-sm sm:col-span-3">Host<input className="field mt-1" placeholder="mqtt.contoh.local" value={form.host} onChange={(e) => set('host', e.target.value)} /></label>
          <label className="text-sm sm:col-span-2">Protokol
            <select className="field mt-1" value={form.protocol} onChange={(e) => { const p = e.target.value as Form['protocol']; setForm((f) => ({ ...f, protocol: p, port: f.port === DEFAULT_PORT[f.protocol] ? DEFAULT_PORT[p] : f.port })) }}>
              <option value="mqtt">mqtt</option><option value="mqtts">mqtts (TLS)</option><option value="ws">ws</option><option value="wss">wss (TLS)</option>
            </select>
          </label>
          <label className="text-sm">Port<input className="field mt-1" inputMode="numeric" value={form.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} /></label>
          <label className="text-sm sm:col-span-3">Username <span className="text-muted">(opsional)</span><input className="field mt-1" autoComplete="off" value={form.username} onChange={(e) => set('username', e.target.value)} /></label>
          <label className="text-sm sm:col-span-3">Password <span className="text-muted">(opsional)</span>
            <span className="relative mt-1 block"><input className="field pr-10" type={showPw ? 'text' : 'password'} autoComplete="new-password" placeholder={hasPassword ? '•••••• (tersimpan)' : ''} value={form.password} onChange={(e) => set('password', e.target.value)} />
              <button type="button" aria-label={showPw ? 'Sembunyikan password' : 'Tampilkan password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" onClick={() => setShowPw((v) => !v)}>{showPw ? <IconEyeOff size={18} /> : <IconEye size={18} />}</button></span>
          </label>
          <label className="text-sm sm:col-span-3">Topic status presence<input className="field mt-1 font-mono" value={form.topic_status} onChange={(e) => set('topic_status', e.target.value)} /></label>
          <label className="text-sm sm:col-span-3">Topic online <span className="text-muted">(opsional)</span><input className="field mt-1 font-mono" value={form.topic_online} onChange={(e) => set('topic_online', e.target.value)} /></label>
        </div>
        <p className="mt-3 flex gap-1.5 text-xs text-muted"><span className="mt-0.5 shrink-0"><IconLock size={14} /></span><span>Client ID dibuat otomatis dan QoS tetap 1. Wildcard <code>+</code> pada topic menentukan <i>device_id</i>. Password disimpan di database server (file hanya bisa dibaca pemilik) dan tidak pernah dikirim balik ke browser.</span></p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn-outline" onClick={runTest} disabled={!complete || testing}>{testing ? 'Menguji…' : 'Tes koneksi'}</button>
          <button className="btn-primary" onClick={save} disabled={!canSave}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
          {!canSave && complete && !saving && <span className="text-xs text-muted">Simpan aktif setelah tes (langkah 1–3) berhasil dengan isian ini.</span>}
        </div>
        {notice && <div role="alert" className={`mt-3 rounded-lg px-3 py-2 text-sm ${notice.ok ? 'bg-ok-bg text-ok' : 'bg-bad-bg text-bad'}`}>{notice.text}</div>}
      </Section>

      <Section title="Debounce sensor">
        <p className="mb-3 text-sm text-muted">Status yang bertahan kurang dari durasi ini dianggap kedipan sensor dan dilebur ke status di sekitarnya, jadi tidak menambah hitungan &quot;jadi terisi/kosong&quot; dan tidak memecah sesi. Data mentah tidak diubah; isi 0 untuk mematikan.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">Minimal
            <input className="field !w-24" inputMode="numeric" value={deb} onChange={(e) => setDeb(e.target.value.replace(/\D/g, ''))} />detik</label>
          <button className="btn-primary" onClick={saveDebounce} disabled={deb === '' || deb === debSaved}>Simpan</button>
        </div>
      </Section>

      <Section title="Nama ruangan">
        {devs.length === 0 ? <p className="text-sm text-muted">Belum ada device terdeteksi.</p> : (
          <ul className="space-y-2">
            {devs.map((d) => (
              <li key={d.device_id} className="flex flex-wrap items-center gap-3 text-sm">
                <code className="w-40 truncate rounded bg-surface2 px-2 py-1 font-mono">{d.device_id}</code>
                <input className="field !w-64" placeholder="Nama ruangan, mis. Ruang Rapat A" defaultValue={d.room_name ?? ''} onBlur={(e) => e.target.value !== (d.room_name ?? '') && renameRoom(d.device_id, e.target.value)} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      </div>

      <div className="space-y-4">
      {(test || testing) && (
        <Section title="Verifikasi">
          <ol className="space-y-2">
            {(test?.steps?.length ? test.steps : [{ id: 'x', label: 'Menunggu hasil tes…', status: 'running' } as Step]).map((s) => (
              <li key={s.id} className="flex gap-3 text-sm">
                <span className={`w-5 text-center font-bold ${STEP_CLR[s.status]}`} aria-label={s.status}>{STEP_ICON[s.status]}</span>
                <div><div className={s.status === 'failed' ? 'font-medium text-bad' : ''}>{s.label}</div>{s.detail && <div className="text-xs text-muted">{s.detail}</div>}</div>
              </li>
            ))}
          </ol>
          {test && test.sample_messages.length > 0 && <div className="mt-4"><div className="mb-2 text-sm font-medium">Pesan yang masuk saat tes</div><Messages list={test.sample_messages} /></div>}
        </Section>
      )}

      <Section title="Pesan masuk (live)" right={ingest && <span className="text-xs text-muted">{ingest.msg_count} sesuai · {ingest.invalid_count} tidak sesuai · {ingest.devices.length} device{ingest.devices.length ? ` (${ingest.devices.join(', ')})` : ''}</span>}>
        <Messages list={ingest?.recent ?? []} />
        <p className="mt-2 text-xs text-muted">Pesan yang tidak sesuai format diabaikan. Hitungan dihitung sejak server terakhir dijalankan.</p>
      </Section>

      </div>
      </div>
    </div>
  )
}
