import { Link } from 'react-router-dom'
import { useAuth } from '../App'
import { useT } from '../lib/i18n'
import { GITHUB_URL } from '../lib/site'
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
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
          className="text-gray-300 hover:text-gray-100"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="h-5 w-5">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        </a>
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
