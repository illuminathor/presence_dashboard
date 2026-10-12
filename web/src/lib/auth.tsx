import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, get } from './api'

export interface User { id: number; email: string; role: 'admin' | 'viewer' }
interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}
const Ctx = createContext<AuthState>({ user: null, loading: true, login: async () => {}, logout: async () => {} })
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    get<User>('/me').then(setUser).catch(() => setUser(null)).finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    setUser(await api<User>('POST', '/login', { email, password }))
  }, [])
  const logout = useCallback(async () => {
    await api('POST', '/logout', {}).catch(() => {})
    setUser(null)
  }, [])

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>
}
