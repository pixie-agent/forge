import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../App'
import EnvBadge from '../components/EnvBadge'
import LangToggle from '../components/LangToggle'
import PublicFooter from '../components/PublicFooter'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import type { User } from '../lib/types'

/**
 * 邮件里的验证链接落地页:/verify?token=...
 * 验证成功即建立会话(服务端 Set-Cookie),然后回到项目列表;
 * 注册时带了 idea 的,回登录页由既有逻辑续跑「登录后继续生成」。
 */
export default function VerifyEmail() {
  const [sp] = useSearchParams()
  const token = sp.get('token') ?? ''
  const [state, setState] = useState<'checking' | 'done' | 'failed'>('checking')
  const [error, setError] = useState('')
  const { setUser } = useAuth()
  const nav = useNavigate()
  const t = useT()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (!token) {
      setError(t('err.verifyLinkInvalid'))
      setState('failed')
      return
    }
    api<{ user: User; idea?: string }>('/api/auth/verify', { method: 'POST', body: { token } })
      .then((d) => {
        setUser(d.user)
        setState('done')
        nav(d.idea ? `/login?idea=${encodeURIComponent(d.idea)}` : '/projects', { replace: true })
      })
      .catch((err) => {
        setError((err as Error).message)
        setState('failed')
      })
  }, [token, nav, setUser, t])

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <div className="flex flex-1 items-center justify-center px-3 py-6 sm:px-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900 p-5 sm:p-6">
          <div className="mb-6 flex items-center gap-2 font-semibold">
            <span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-br from-indigo-400 to-fuchsia-500" />
            Forge
            <EnvBadge />
            <span className="ml-auto">
              <LangToggle />
            </span>
          </div>

          {state === 'checking' && (
            <p className="text-center text-sm text-gray-400">{t('verify.checking')}</p>
          )}

          {state === 'done' && (
            <p className="text-center text-sm text-emerald-300">{t('verify.success')}</p>
          )}

          {state === 'failed' && (
            <div className="space-y-3 text-center">
              <h2 className="text-sm font-semibold text-red-300">{t('verify.failedTitle')}</h2>
              <p className="text-xs leading-relaxed text-gray-400">{error}</p>
              <Link
                to="/login"
                className="block w-full rounded-xl bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500"
              >
                {t('verify.goLogin')}
              </Link>
            </div>
          )}
        </div>
      </div>
      <PublicFooter />
    </div>
  )
}
