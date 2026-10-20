import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { SUPPORT_EMAIL } from '../lib/site'

/**
 * 公共页脚:价格 + 三份法务文档 + 支持邮箱。
 *
 * Creem 账户复审要求 Privacy Policy / Terms of Service 能从首页与注册页公开访问,
 * 且支持邮箱必须与店铺 business details 一致(见 `lib/site.ts`)。
 */
export default function PublicFooter() {
  const t = useT()
  const year = new Date().getFullYear()

  return (
    <footer className="mt-16 border-t border-gray-800 bg-gray-950">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-8 text-xs text-gray-500 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-medium text-gray-300">Forge</p>
          <p className="mt-1 max-w-xs leading-relaxed">{t('footer.tagline')}</p>
          <p className="mt-2">{t('footer.rights', { year })}</p>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 sm:justify-end">
          <Link to="/pricing" className="hover:text-gray-200">
            {t('footer.pricing')}
          </Link>
          <Link to="/terms" className="hover:text-gray-200">
            {t('footer.terms')}
          </Link>
          <Link to="/privacy" className="hover:text-gray-200">
            {t('footer.privacy')}
          </Link>
          <Link to="/acceptable-use" className="hover:text-gray-200">
            {t('footer.acceptableUse')}
          </Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-gray-200">
            {t('footer.support')}: {SUPPORT_EMAIL}
          </a>
        </nav>
      </div>
    </footer>
  )
}
