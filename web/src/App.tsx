import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import MqttConfig from './pages/MqttConfig'
import Users from './pages/Users'
import Account from './pages/Account'

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <div className="grid min-h-screen place-items-center p-6 text-center text-muted">Memuat…</div>
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>
  const admin = user.role === 'admin'
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="settings/mqtt" element={admin ? <MqttConfig /> : <Navigate to="/" replace />} />
        <Route path="settings/users" element={admin ? <Users /> : <Navigate to="/" replace />} />
        <Route path="akun" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
