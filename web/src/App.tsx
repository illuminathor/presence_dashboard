import { Navigate, Route, Routes } from 'react-router-dom'
import { configured } from './lib/supabase'
import { useAuth } from './lib/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import SetPassword from './pages/SetPassword'
import Dashboard from './pages/Dashboard'
import MqttConfig from './pages/MqttConfig'

function Splash({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-screen place-items-center p-6 text-center text-muted">{children}</div>
}

export default function App() {
  const { session, role, loading, recovery } = useAuth()

  if (!configured) {
    return <Splash><div>Env <b>VITE_SUPABASE_URL</b> dan <b>VITE_SUPABASE_ANON_KEY</b> belum diisi (lihat web/.env.example).</div></Splash>
  }
  if (loading) return <Splash>Memuat…</Splash>
  if (recovery && session) return <SetPassword />
  if (!session) {
    return <Routes><Route path="*" element={<Login />} /></Routes>
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="settings/mqtt" element={role === 'admin' ? <MqttConfig /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
