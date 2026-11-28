import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import Landing from './pages/Landing'
import Login from './pages/Login'
import VerifyEmail from './pages/VerifyEmail'
import Projects from './pages/Projects'
import Billing from './pages/Billing'
import Account from './pages/Account'
import Pricing from './pages/Pricing'
import Legal from './pages/Legal'
import Workspace from './pages/Workspace'
import AdminLogin from './pages/AdminLogin'
import AdminProjects from './pages/AdminProjects'
import AdminProject from './pages/AdminProject'
import AdminUsers from './pages/AdminUsers'
import AdminUser from './pages/AdminUser'
import AdminModels from './pages/AdminModels'
import AdminDashboard from './pages/AdminDashboard'
import AdminOrchestration from './pages/AdminOrchestration'
import { api } from './lib/api'
import { takePendingClone } from './lib/pendingClone'
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
        <CloneResumer />
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
            path="/account"
            element={
              <Guard>
                <Account />
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
          <Route
            path="/admin/models"
            element={
              <AdminGate>
                <AdminModels />
              </AdminGate>
            }
          />
          <Route
            path="/admin/orchestration"
            element={
              <AdminGate>
                <AdminOrchestration />
              </AdminGate>
            }
          />
          {/* 编排的五类资源已合并进 /admin/orchestration 单页;旧地址按资源定位过去 */}
          <Route path="/admin/pipeline" element={<Navigate to="/admin/orchestration" replace />} />
          <Route path="/admin/agents" element={<Navigate to="/admin/orchestration?r=agents" replace />} />
          <Route path="/admin/prompts" element={<Navigate to="/admin/orchestration?r=prompts" replace />} />
          <Route path="/admin/skills" element={<Navigate to="/admin/orchestration?r=skills" replace />} />
          <Route path="/admin/mcp" element={<Navigate to="/admin/orchestration?r=mcp" replace />} />
          <Route
            path="/admin/dashboard"
            element={
              <AdminGate>
                <AdminDashboard />
              </AdminGate>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthCtx.Provider>
  )
}

/**
 * 登录后补跑「克隆同款」。
 *
 * 首页点克隆时还没登录 → 跳 `/login?clone=<id>`,登录页会把 id 存进 sessionStorage;
 * 但注册走邮件验证、Google 登录走回调,最终落点都是 `/projects`(URL 上的 clone 早就丢了)。
 * 这里在拿到会话后统一取出待办并克隆,再把用户送进新项目的工作区。
 * 当前 URL 带 clone 参数时由登录页自己处理(它要显示「正在克隆」的状态),这里跳过避免克隆两次。
 */
function CloneResumer() {
  const { user, loading } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const started = useRef(false)
  const hasCloneParam = new URLSearchParams(loc.search).has('clone')

  useEffect(() => {
    if (loading || !user || started.current || hasCloneParam) return
    started.current = true
    const id = takePendingClone()
    if (!id) return
    api<{ id: string }>(`/api/showcase/${id}/clone`, { method: 'POST' })
      .then((p) => nav(`/workspace/${p.id}`))
      .catch(() => {
        // 案例已下线/删除时接口返回 404:静默放弃,用户仍在当前页正常使用
      })
  }, [loading, user, hasCloneParam, nav])

  return null
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
  const t = useT()
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
    return <div className="flex h-screen items-center justify-center bg-gray-950 text-sm text-gray-400">{t('common.loading')}</div>
  if (!admin) return <AdminLogin onSuccess={check} />
  return <>{children}</>
}
