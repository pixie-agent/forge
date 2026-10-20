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
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-gray-800 bg-gray-950 px-3 sm:px-4">
      <div className="flex items-center gap-2">
        <Link to="/projects" className="flex items-center gap-2 font-semibold text-gray-100">
          <span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-br from-indigo-400 to-fuchsia-500" />
          Forge
        </Link>
        <EnvBadge />
      </div>
      <div className="flex items-center gap-2.5 text-sm text-gray-300 sm:gap-4">
        <Link
          to="/billing"
          title={t('billing.title')}
          className="rounded-full bg-indigo-500/15 px-3 py-1 text-xs text-indigo-300 hover:bg-indigo-500/25"
        >
          {t('topbar.credits')} {user?.credits ?? '-'}
        </Link>
        <span className="hidden text-xs text-gray-500 sm:inline">{user?.email}</span>
        <LangToggle />
        <ThemeToggle />
        <button onClick={logout} className="text-xs text-gray-400 hover:text-gray-200">
          {t('topbar.logout')}
        </button>
      </div>
    </header>
  )
}
