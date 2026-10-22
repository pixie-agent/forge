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
    <header className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-2 px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
        <Link to="/" className="flex shrink-0 items-center gap-2 font-semibold text-gray-100">
          <span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-br from-indigo-400 to-fuchsia-500" />
          Forge
        </Link>
        <EnvBadge />
      </div>
      <div className="flex shrink-0 items-center gap-2 text-sm sm:gap-3">
        {/* 手机上把「价格」让给页脚,避免窄屏顶栏挤成两行;首页正文仍保留公开价格区块 */}
        <Link to="/pricing" className="hidden text-gray-300 hover:text-gray-100 sm:inline">
          {t('landing.pricingLink')}
        </Link>
        <LangToggle />
        {user ? (
          <Link to="/projects" className="whitespace-nowrap text-gray-300 hover:text-gray-100">
            {t('landing.enterWorkspace')}
          </Link>
        ) : (
          <Link to="/login" className="whitespace-nowrap rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 sm:px-4">
            {t('landing.loginOrRegister')}
          </Link>
        )}
      </div>
    </header>
  )
}
