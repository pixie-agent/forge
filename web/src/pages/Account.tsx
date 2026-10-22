import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import TopBar from '../components/TopBar'
import { useAuth } from '../App'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * 账号设置:设置 / 修改邮箱密码。
 *
 * 纯 Google 账号(`has_password=false`)没有当前密码,只需填新密码;设置后即可用
 * 邮箱 + 密码登录(同一账号)。已有密码的账号必须验证当前密码。
 * 改密会让其他设备的会话失效,当前设备由服务端换发新 cookie,不会被登出。
 */
export default function Account() {
  const t = useT()
  const { user, refresh } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const hasPassword = user?.has_password ?? false

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    if (next.length < 6) {
      setError(t('account.tooShort'))
      return
    }
    if (next !== confirm) {
      setError(t('account.mismatch'))
      return
    }
    setBusy(true)
    try {
      await api('/api/auth/password', {
        method: 'POST',
        body: hasPassword
          ? { currentPassword: current, newPassword: next }
          : { newPassword: next },
      })
      setCurrent('')
      setNext('')
      setConfirm('')
      setNotice(t('account.saved'))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <TopBar />
      <main className="mx-auto w-full max-w-xl flex-1 px-3 py-6 sm:px-4 sm:py-10">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">{t('account.title')}</h1>
          <Link to="/projects" className="text-sm text-gray-400 hover:text-gray-200">
            {t('projects.title')}
          </Link>
        </div>

        <section className="space-y-4 rounded-2xl border border-gray-800 bg-gray-900/60 p-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">{t('account.email')}</p>
            <p className="mt-1 text-sm text-gray-200">{user?.email}</p>
          </div>

          <div className="border-t border-gray-800 pt-4">
            <h2 className="text-sm font-medium text-gray-200">
              {hasPassword ? t('account.changeTitle') : t('account.setTitle')}
            </h2>
            {!hasPassword && (
              <p className="mt-2 rounded-lg bg-indigo-500/10 px-3 py-2 text-xs leading-relaxed text-indigo-300">
                {t('account.googleHint')}
              </p>
            )}

            <form onSubmit={submit} className="mt-3 space-y-3">
              {hasPassword && (
                <label className="block text-xs text-gray-400">
                  {t('account.current')}
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500"
                  />
                </label>
              )}
              <label className="block text-xs text-gray-400">
                {t('account.new')}
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500"
                />
              </label>
              <label className="block text-xs text-gray-400">
                {t('account.confirm')}
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500"
                />
              </label>

              {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
              {notice && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{notice}</p>}

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
              >
                {busy ? t('common.saving') : hasPassword ? t('account.change') : t('account.set')}
              </button>
            </form>

            <p className="mt-3 text-xs leading-relaxed text-gray-500">{t('account.sessionHint')}</p>
          </div>
        </section>
      </main>
    </div>
  )
}
