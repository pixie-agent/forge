import { Link } from 'react-router-dom'
import PublicFooter from '../components/PublicFooter'
import PublicHeader from '../components/PublicHeader'
import PricingSection from '../components/PricingSection'
import { SIGNUP_CREDITS } from '../lib/billing'
import { useT } from '../lib/i18n'

/** 公开价格页(无需登录):Creem 账户复审要求注册前就能看到完整价格 */
export default function Pricing() {
  const t = useT()

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <PublicHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-semibold">{t('pricing.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-gray-400">{t('pricing.subtitle')}</p>
        <p className="mt-2 text-xs text-indigo-300">{t('pricing.included', { credits: SIGNUP_CREDITS })}</p>

        <div className="mt-8 rounded-2xl border border-gray-800 bg-gray-900/40 p-5 sm:p-6">
          <PricingSection />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
          <Link to="/login" className="rounded-xl bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-500">
            {t('pricing.cta')}
          </Link>
          <Link to="/terms" className="text-gray-400 hover:text-gray-200">
            {t('footer.terms')}
          </Link>
          <Link to="/privacy" className="text-gray-400 hover:text-gray-200">
            {t('footer.privacy')}
          </Link>
        </div>
      </main>
      <PublicFooter />
    </div>
  )
}
