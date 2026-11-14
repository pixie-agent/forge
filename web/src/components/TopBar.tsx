import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import EnvBadge from './EnvBadge'
import LangToggle from './LangToggle'
import ThemeToggle from './ThemeToggle'

export default function TopBar() {
  const { user, setUser } = useAuth()
  const nav = useNavigate()
  const t = useT()

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
    setUser(null)
    nav('/login')
  }

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-gray-800 bg-gray-950 px-2.5 sm:px-4">
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        <Link to="/projects" className="flex shrink-0 items-center gap-2 font-semibold text-gray-100">
          <span className="h-2.5 w-2.5 rounded-sm bg-indigo-400" />
          Forge
        </Link>
        <EnvBadge />
      </div>
      <div className="flex shrink-0 items-center gap-1.5 text-sm text-gray-300 sm:gap-4">
        <Link
          to="/billing"
          title={`${t('topbar.credits')} · ${t('billing.title')}`}
          aria-label={`${t('topbar.credits')} ${user?.credits ?? '-'}`}
          className="rounded-full bg-indigo-500/15 px-2.5 py-1 text-xs text-indigo-300 hover:bg-indigo-500/25 sm:px-3"
        >
          <span className="hidden sm:inline">{t('topbar.credits')} </span>
          <span className="font-medium">{user?.credits ?? '-'}</span>
        </Link>
        <Link
          to="/account"
          title={t('account.title')}
          className="hidden max-w-44 truncate text-xs text-gray-500 hover:text-gray-200 sm:inline"
        >
          {user?.email}
        </Link>
        <Link to="/account" className="text-xs text-gray-400 hover:text-gray-200 sm:hidden">
          {t('topbar.account')}
        </Link>
        <LangToggle />
        <ThemeToggle />
        <button onClick={logout} className="px-0.5 text-xs text-gray-400 hover:text-gray-200">
          {t('topbar.logout')}
        </button>
      </div>
    </header>
  )
}
