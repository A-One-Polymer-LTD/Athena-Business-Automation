import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, getToken, setToken, setUnauthorizedHandler } from './api'
import { applySettings, type OrgSettings } from './format'

export type Role =
  | 'Super Admin' | 'Sales Admin' | 'Production Manager' | 'Assistant Production Manager'
  | 'Store Operator' | 'Saw-Mill Supervisor' | 'Warehouse / Delivery'

export interface User {
  id: number
  login_id: string
  name: string
  role: Role
  phone?: string
  designation?: string
  branch_id?: number
  branch?: string
  active: boolean
  /** may enter and edit production cost lines */
  cost_permission: boolean
  /** may see production costs (Super Admin view, or cost permission) */
  can_view_cost: boolean
}

interface AuthState {
  user: User | null
  settings: OrgSettings | null
  loading: boolean
  /** message shown on the login screen, e.g. after a session timeout */
  notice: string
  badges: Record<string, number>
  login: (loginId: string, password: string) => Promise<User>
  logout: () => Promise<void>
  refreshBadges: () => void
  reloadSettings: () => Promise<void>
}

const Ctx = createContext<AuthState>(null as any)
export const useAuth = () => useContext(Ctx)

const IDLE_MS = 30 * 60 * 1000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [settings, setSettings] = useState<OrgSettings | null>(null)
  const [loading, setLoading] = useState(!!getToken())
  const [notice, setNotice] = useState('')
  const [badges, setBadges] = useState<Record<string, number>>({})
  const lastActivity = useRef(Date.now())

  const clear = useCallback((message = '') => {
    setToken(null)
    setUser(null)
    setBadges({})
    setNotice(message)
  }, [])

  const accept = useCallback((d: { user: User; settings: OrgSettings }) => {
    applySettings(d.settings)
    setSettings(d.settings)
    setUser(d.user)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler((message) => clear(message))
    if (!getToken()) return
    api.get('/auth/me').then(accept).catch(() => clear()).finally(() => setLoading(false))
  }, [accept, clear])

  const refreshBadges = useCallback(() => {
    if (getToken()) api.get('/badges').then(setBadges).catch(() => {})
  }, [])

  useEffect(() => {
    if (!user) return
    refreshBadges()
    const t = setInterval(refreshBadges, 60_000)
    return () => clearInterval(t)
  }, [user, refreshBadges])

  // Sessions end after 30 minutes without activity (BRD Section 7, Security).
  useEffect(() => {
    if (!user) return
    const touch = () => { lastActivity.current = Date.now() }
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    const t = setInterval(() => {
      if (Date.now() - lastActivity.current > IDLE_MS) {
        api.post('/auth/logout').catch(() => {})
        clear('Your session ended after 30 minutes without activity. Please sign in again.')
      }
    }, 30_000)
    return () => { events.forEach((e) => window.removeEventListener(e, touch)); clearInterval(t) }
  }, [user, clear])

  const value = useMemo<AuthState>(() => ({
    user, settings, loading, notice, badges, refreshBadges,
    login: async (loginId, password) => {
      const d = await api.post('/auth/login', { login_id: loginId, password })
      setToken(d.token)
      lastActivity.current = Date.now()
      setNotice('')
      accept(d)
      return d.user as User
    },
    logout: async () => {
      try { await api.post('/auth/logout') } catch { /* already signed out */ }
      clear()
    },
    reloadSettings: async () => { accept(await api.get('/auth/me')) },
  }), [user, settings, loading, notice, badges, refreshBadges, accept, clear])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Home screen of each role (FR-GEN-01). */
export function homeFor(role: Role): string {
  switch (role) {
    case 'Super Admin': return '/monitor'
    case 'Sales Admin': return '/sales/dashboard'
    case 'Production Manager': return '/pm/orders'
    case 'Assistant Production Manager': return '/apm/work'
    case 'Store Operator': return '/store/inbox'
    case 'Saw-Mill Supervisor': return '/sawmill/inbox'
    case 'Warehouse / Delivery': return '/warehouse'
  }
}
