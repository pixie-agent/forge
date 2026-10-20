import { Link } from 'react-router-dom'
import { useAuth } from '../App'
import { useT } from '../lib/i18n'
import EnvBadge from './EnvBadge'
import LangToggle from './LangToggle'

/** 未登录也可见的公共页头(首页 / 价格 / 法务页共用) */
export default function PublicHeader() {
  const { user } = useAuth()
  const t = useT()

  return (
    <header className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <Link to="/" className="flex items-center gap-2 font-semibold text-gray-100">
          <span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-br from-indigo-400 to-fuchsia-500" />
          Forge
        </Link>
        <EnvBadge />
      </div>
      <div className="flex items-center gap-3 text-sm">
        <Link to="/pricing" className="text-gray-300 hover:text-gray-100">
          {t('landing.pricingLink')}
        </Link>
        <LangToggle />
        {user ? (
          <Link to="/projects" className="text-gray-300 hover:text-gray-100">
            {t('landing.enterWorkspace')}
          </Link>
        ) : (
          <Link to="/login" className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-500">
            {t('landing.loginOrRegister')}
          </Link>
        )}
      </div>
    </header>
  )
}
