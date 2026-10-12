import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface AuthState {
  session: Session | null
  role: 'admin' | 'viewer' | null
  loading: boolean
  recovery: boolean
  clearRecovery: () => void
}
const Ctx = createContext<AuthState>({ session: null, role: null, loading: true, recovery: false, clearRecovery: () => {} })
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<'admin' | 'viewer' | null>(null)
  const [loading, setLoading] = useState(true)
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
      if (!s) { setRole(null); setLoading(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id
  useEffect(() => {
    if (!uid) return
    let live = true
    supabase.from('profiles').select('role').eq('user_id', uid).maybeSingle().then(({ data }) => {
      if (!live) return
      setRole((data?.role as 'admin' | 'viewer') ?? 'viewer')
      setLoading(false)
    })
    return () => { live = false }
  }, [uid])

  return <Ctx.Provider value={{ session, role, loading, recovery, clearRecovery: () => setRecovery(false) }}>{children}</Ctx.Provider>
}
