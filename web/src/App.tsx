import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing'
import Login from './pages/Login'
import VerifyEmail from './pages/VerifyEmail'
import Projects from './pages/Projects'
import Billing from './pages/Billing'
import Pricing from './pages/Pricing'
import Legal from './pages/Legal'
import Workspace from './pages/Workspace'
import AdminLogin from './pages/AdminLogin'
import AdminProjects from './pages/AdminProjects'
import AdminProject from './pages/AdminProject'
import AdminUsers from './pages/AdminUsers'
import AdminUser from './pages/AdminUser'
import { api } from './lib/api'
import { useT } from './lib/i18n'
import type { User } from './lib/types'

interface AuthState {
  user: User | null
  setUser: (u: User | null) => void
  refresh: () => Promise<void>
  loading: boolean
}

export const AuthCtx = createContext<AuthState>({
  user: null,
  setUser: () => {},
  refresh: async () => {},
  loading: true,
})

export function useAuth() {
  return useContext(AuthCtx)
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    try {
      const data = await api<{ user: User }>('/api/auth/me')
      setUser(data.user)
    } catch {
      setUser(null)
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  return (
    <AuthCtx.Provider value={{ user, setUser, refresh, loading }}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          {/* 验证邮件落地页:必须公开(等待验证的用户还没有会话) */}
          <Route path="/verify" element={<VerifyEmail />} />
          {/* 公开法务/价格页:Creem 账户复审要求无需登录即可访问 */}
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/terms" element={<Legal doc="terms" />} />
          <Route path="/privacy" element={<Legal doc="privacy" />} />
          <Route path="/acceptable-use" element={<Legal doc="acceptable" />} />
          <Route
            path="/projects"
            element={
              <Guard>
                <Projects />
              </Guard>
            }
          />
          <Route
            path="/workspace/:id"
            element={
              <Guard>
                <Workspace />
              </Guard>
            }
          />
          <Route
            path="/billing"
            element={
              <Guard>
                <Billing />
              </Guard>
            }
          />
          <Route
            path="/admin"
            element={
              <AdminGate>
                <AdminProjects />
              </AdminGate>
            }
          />
          <Route
            path="/admin/projects/:id"
            element={
              <AdminGate>
                <AdminProject />
              </AdminGate>
            }
          />
          <Route
            path="/admin/users"
            element={
              <AdminGate>
                <AdminUsers />
              </AdminGate>
            }
          />
          <Route
            path="/admin/users/:id"
            element={
              <AdminGate>
                <AdminUser />
              </AdminGate>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthCtx.Provider>
  )
}

function Guard({ children }: { children: ReactNode }) {
  const t = useT()
  const { user, loading } = useAuth()
  if (loading) return <div className="flex h-screen items-center justify-center text-sm text-gray-400">{t('common.loading')}</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** 管理后台门禁:用独立口令校验(/api/admin/me),未通过则显示口令登录 */
function AdminGate({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<boolean | null>(null)
  const check = useCallback(() => {
    api<{ admin: boolean }>('/api/admin/me')
      .then((d) => setAdmin(d.admin))
      .catch(() => setAdmin(false))
  }, [])
  useEffect(() => {
    check()
  }, [check])
  if (admin === null)
    return <div className="flex h-screen items-center justify-center bg-gray-950 text-sm text-gray-400">加载中…</div>
  if (!admin) return <AdminLogin onSuccess={check} />
  return <>{children}</>
}
