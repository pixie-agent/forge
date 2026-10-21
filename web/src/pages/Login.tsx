import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../App'
import EnvBadge from '../components/EnvBadge'
import LangToggle from '../components/LangToggle'
import PublicFooter from '../components/PublicFooter'
import { api } from '../lib/api'
import { SIGNUP_CREDITS } from '../lib/billing'
import { getActiveLang, useI18n } from '../lib/i18n'
import type { User } from '../lib/types'

export default function Login() {
  const [sp] = useSearchParams()
  const idea = sp.get('idea') ?? ''
  // 服务端在 Google 回调失败时把原因放在 URL 里(中文原文),这里翻成当前语言
  const googleError = useI18n().tServer(sp.get('google_error') ?? '')
  const [mode, setMode] = useState<'login' | 'register'>(idea ? 'register' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleEnabled, setGoogleEnabled] = useState(false)
  // 注册成功 / 用未验证邮箱登录 → 显示「等验证」面板,不再走登录态
  const [pending, setPending] = useState<{ email: string; sent: boolean } | null>(null)
  const { user, setUser, loading } = useAuth()
  const nav = useNavigate()
  const { t } = useI18n()
  // 登录态就绪后只跳转一次(Google 回调 / 已登录用户打开登录页都会走到这里)
  const redirected = useRef(false)

  // 后端是否配置了 Google 登录;未配置则隐藏按钮(仅保留邮箱/密码)
  useEffect(() => {
    api<{ google: boolean }>('/api/auth/config')
      .then((d) => setGoogleEnabled(d.google))
      .catch(() => setGoogleEnabled(false))
  }, [])

  useEffect(() => {
    if (loading || !user || redirected.current) return
    redirected.current = true
    const go = idea
      ? api<{ id: string }>('/api/projects', { method: 'POST', body: { idea } }).then(
          (p) => `/workspace/${p.id}?idea=${encodeURIComponent(idea)}`
        )
      : Promise.resolve('/projects')
    go.then((path) => nav(path)).catch(() => nav('/projects'))
  }, [loading, user, idea, nav])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (mode === 'register') {
        // 注册只建号、不发积分、不建会话;验证邮件发出后由用户点链接完成验证
        const data = await api<{ user: User; verificationSent: boolean }>('/api/auth/register', {
          method: 'POST',
          body: { email, password, idea, lang: getActiveLang() },
        })
        setPending({ email: data.user.email, sent: data.verificationSent })
        setBusy(false)
        return
      }
      const data = await api<{ user: User }>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      })
      // 跳转交给上面的 effect 统一处理(带 idea 时先建项目再进工作区)
      setUser(data.user)
    } catch (err) {
      const e = err as Error & { code?: string }
      if (e.code === 'email_unverified') {
        setPending({ email: email.trim().toLowerCase(), sent: true })
        setBusy(false)
        return
      }
      setError(e.message)
      setBusy(false)
    }
  }

  async function resend() {
    if (busy || !pending) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api<{ ok: boolean }>('/api/auth/resend-verification', {
        method: 'POST',
        body: { email: pending.email, lang: getActiveLang() },
      })
      setNotice(t('login.resendSent'))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900 p-6">
        <div className="mb-6 flex items-center gap-2 font-semibold">
          <span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-br from-indigo-400 to-fuchsia-500" />
          Forge
          <EnvBadge />
          <span className="ml-auto">
            <LangToggle />
          </span>
        </div>

        {pending ? (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">{t('login.checkEmailTitle')}</h2>
            <p className="text-xs leading-relaxed text-gray-400">
              {pending.sent
                ? t('login.checkEmailBody', { email: pending.email, credits: SIGNUP_CREDITS })
                : t('login.checkEmailFailed')}
            </p>
            {notice && (
              <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</p>
            )}
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              type="button"
              onClick={resend}
              disabled={busy}
              className="w-full rounded-xl bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {busy ? t('login.resending') : t('login.resend')}
            </button>
            <button
              type="button"
              onClick={() => {
                setPending(null)
                setMode('login')
                setError('')
                setNotice('')
              }}
              className="w-full rounded-xl border border-gray-700 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              {t('login.backToLogin')}
            </button>
            <p className="text-center text-xs leading-relaxed text-gray-500">{t('login.verifyHint')}</p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex rounded-lg border border-gray-700 p-0.5 text-sm">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m)
                    setError('')
                    setNotice('')
                  }}
                  className={`flex-1 rounded-md py-1.5 ${mode === m ? 'bg-gray-700 text-gray-100' : 'text-gray-400'}`}
                >
                  {t(m === 'login' ? 'login.login' : 'login.register')}
                </button>
              ))}
            </div>

            {idea && (
              <p className="mb-3 rounded-lg bg-indigo-500/10 px-3 py-2 text-xs text-indigo-300">
                {t('login.continueIdea', { idea })}
              </p>
            )}

            {googleError && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{googleError}</p>}

            {googleEnabled && (
              <>
                <a
                  href={`/api/auth/google${idea ? `?idea=${encodeURIComponent(idea)}` : ''}`}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-700 bg-white py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
                >
                  <GoogleMark />
                  {t('login.withGoogle')}
                </a>

                <div className="my-4 flex items-center gap-3 text-xs text-gray-500">
                  <span className="h-px flex-1 bg-gray-800" />
                  {t('login.or')}
                  <span className="h-px flex-1 bg-gray-800" />
                </div>
              </>
            )}

            <form onSubmit={submit} className="space-y-3">
              <input
                type="email"
                required
                placeholder={t('login.email')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
              <input
                type="password"
                required
                minLength={6}
                placeholder={t('login.password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
              {notice && (
                <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</p>
              )}
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
              >
                {busy ? t('login.submitting') : mode === 'login' ? t('login.login') : t('login.registerWithCredits', { credits: SIGNUP_CREDITS })}
              </button>
            </form>

            <p className="mt-4 text-center text-xs leading-relaxed text-gray-500">
              {t('login.consentPrefix')}{' '}
              <Link to="/terms" className="text-indigo-300 hover:text-indigo-200">
                {t('footer.terms')}
              </Link>{' '}
              {t('login.consentAnd')}{' '}
              <Link to="/privacy" className="text-indigo-300 hover:text-indigo-200">
                {t('footer.privacy')}
              </Link>
              {t('login.consentSuffix')}
            </p>

            <p className="mt-3 text-center text-xs text-gray-500">{t('login.mergeHint')}</p>
          </>
        )}
      </div>
      </div>
      <PublicFooter />
    </div>
  )
}

/** Google 官方四色 G 标 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}
