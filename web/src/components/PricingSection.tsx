import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatPrice } from '../lib/billing'
import { useT } from '../lib/i18n'
import type { BillingPlans, CreditPack, SubscriptionPlan } from '../lib/types'

/**
 * 公开价目表:一次性充值包 + 按月订阅。
 *
 * 数据来自 `GET /api/billing/plans`(公开接口,服务端 `src/lib/plans.ts` 是价格唯一来源),
 * 所以首页、价格页、登录后的 `/billing` 三处看到的金额永远一致。这里只展示,不带购买按钮 ——
 * 购买入口在登录后的 `/billing`。
 */
export default function PricingSection() {
  const t = useT()
  const [plans, setPlans] = useState<BillingPlans | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    api<BillingPlans>('/api/billing/plans')
      .then(setPlans)
      .catch(() => setFailed(true))
  }, [])

  if (failed) return <p className="text-sm text-red-400">{t('pricing.loadFailed')}</p>
  if (!plans) return <p className="text-sm text-gray-500">{t('common.loading')}</p>

  const jobCost = plans.jobCost.generate ?? 1

  return (
    <div className="space-y-8 text-left">
      <section>
        <h3 className="text-sm font-medium text-gray-200">{t('billing.packs')}</h3>
        <p className="mt-1 text-xs text-gray-500">{t('billing.packsHint')}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {plans.packs.map((pack) => (
            <PackCard key={pack.id} pack={pack} currency={plans.currency} jobCost={jobCost} />
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium text-gray-200">{t('billing.subscribe')}</h3>
        <p className="mt-1 text-xs text-gray-500">{t('billing.subscribeHint')}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {plans.plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} currency={plans.currency} />
          ))}
        </div>
      </section>

      <p className="text-xs leading-relaxed text-gray-500">{t('pricing.note')}</p>
    </div>
  )
}

function PackCard({ pack, currency, jobCost }: { pack: CreditPack; currency: string; jobCost: number }) {
  const t = useT()
  return (
    <div className="flex flex-col rounded-2xl border border-gray-800 bg-gray-900 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400">{t('billing.creditsAmount', { credits: pack.credits })}</span>
        <Badge badge={pack.badge} />
      </div>
      <p className="text-2xl font-semibold text-gray-100">{formatPrice(pack.priceMinor, currency)}</p>
      <p className="mt-1 text-xs text-gray-500">
        {t('billing.generationsHint', { count: Math.floor(pack.credits / jobCost) })}
      </p>
    </div>
  )
}

function PlanCard({ plan, currency }: { plan: SubscriptionPlan; currency: string }) {
  const t = useT()
  return (
    <div className="flex flex-col rounded-2xl border border-gray-800 bg-gray-900 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-100">{plan.name}</span>
        <Badge badge={plan.badge} />
      </div>
      <p className="text-2xl font-semibold text-gray-100">
        {formatPrice(plan.priceMinor, currency)}
        <span className="text-sm font-normal text-gray-500">{t('billing.perMonthSuffix')}</span>
      </p>
      <p className="mt-1 text-xs text-gray-500">{t('billing.perMonth', { credits: plan.creditsPerPeriod })}</p>
    </div>
  )
}

function Badge({ badge }: { badge: string }) {
  const t = useT()
  const label = badge === 'popular' ? t('billing.badge.popular') : badge === 'bestValue' ? t('billing.badge.bestValue') : ''
  if (!label) return null
  return <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[11px] text-indigo-300">{label}</span>
}
