import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import TopBar from '../components/TopBar'
import { api } from '../lib/api'
import { useAuth } from '../App'
import { formatPrice } from '../lib/billing'
import { formatTime } from '../lib/format'
import { useT, type DictKey } from '../lib/i18n'
import type { BillingPlans, BillingSummary, CreditPack, LedgerReason, SubscriptionPlan } from '../lib/types'

/**
 * 积分与充值页(海外预付:一次性充值包 + 按月订阅)。
 *
 * 价目表来自 `GET /api/billing/plans`(服务端 src/lib/plans.ts 是价格唯一来源),摘要来自
 * `GET /api/billing/summary`。结账走 `POST /api/billing/checkout` → 返回 MoR(Creem)结账页 URL,直接跳转;
 * 支付完成后 Creem 把用户带回 `/billing?checkout=success`,本页据此提示并刷新余额。
 *
 * 支付通道未开通(`plans.checkoutReady === false`)时禁用按钮并显示说明 —— 判断来自服务端配置,不猜。
 */
export default function Billing() {
  const t = useT()
  const { refresh } = useAuth()
  const [params, setParams] = useSearchParams()
  const [plans, setPlans] = useState<BillingPlans | null>(null)
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(() => {
    return Promise.all([api<BillingPlans>('/api/billing/plans'), api<BillingSummary>('/api/billing/summary')]).then(
      ([p, s]) => {
        setPlans(p)
        setSummary(s)
      }
    )
  }, [])

  useEffect(() => {
    load().catch(() => setFailed(true))
  }, [load])

  // 从 MoR 结账页跳回来:提示受理成功并刷新一次余额(积分由 webhook 落账,可能晚几秒到)
  useEffect(() => {
    if (params.get('checkout') !== 'success') return
    setNotice(t('billing.checkoutSuccess'))
    load().catch(() => {})
    refresh().catch(() => {})
    params.delete('checkout')
    setParams(params, { replace: true })
  }, [params, setParams, load, refresh, t])

  async function checkout(kind: 'pack' | 'plan', id: string) {
    setBusyId(id)
    setNotice('')
    try {
      const res = await api<{ url?: string }>('/api/billing/checkout', { method: 'POST', body: { kind, id } })
      // 服务端返回 MoR 结账页,直接跳过去
      if (res.url) location.href = res.url
    } catch (err) {
      setNotice(err instanceof Error ? err.message : t('billing.checkoutNotReady'))
    } finally {
      setBusyId('')
    }
  }

  const ready = plans?.checkoutReady ?? false

  if (failed) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
        <TopBar />
        <main className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-4">
          <p className="text-sm text-gray-500">{t('billing.loadFailed')}</p>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <TopBar />
      <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-4 sm:px-4 sm:py-8">
        <div className="mb-4 flex items-center justify-between sm:mb-6">
          <h1 className="text-xl font-semibold">{t('billing.title')}</h1>
          <Link to="/projects" className="text-sm text-gray-400 hover:text-gray-200">
            {t('projects.title')}
          </Link>
        </div>

        {summary === null || plans === null ? (
          <p className="text-sm text-gray-500">{t('common.loading')}</p>
        ) : (
          <div className="space-y-6 sm:space-y-8">
            {/* 余额 */}
            <section className="rounded-lg border border-gray-800 bg-indigo-500/5 p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400">{t('billing.balance')}</p>
                  <p className="mt-1 text-3xl font-semibold text-indigo-300">{summary.credits}</p>
                </div>
                <p className="text-xs leading-relaxed text-gray-500 sm:max-w-md sm:text-right">
                  {t('billing.balanceHint', { cost: plans.jobCost.generate ?? 1 })}
                </p>
              </div>
            </section>

            {/* 支付通道未开通时明确说明(判断来自服务端 plans.checkoutReady,不猜) */}
            {!ready && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
                {t('billing.comingSoon')}
              </div>
            )}

            {notice && (
              <div className="rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-gray-300">{notice}</div>
            )}

            {/* 收款主体披露:MoR 模式下用户账单上显示的是 Creem 而不是本产品,不提前说清楚会增加拒付 */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3 text-xs leading-relaxed text-gray-500">
              <p>{t('billing.morNotice')}</p>
              <p className="mt-1">{t('billing.creditsNotice')}</p>
            </div>

            {/* 充值包 */}
            <section>
              <h2 className="text-base font-medium">{t('billing.packs')}</h2>
              <p className="mt-1 text-xs text-gray-500">{t('billing.packsHint')}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {plans.packs.map((pack) => (
                  <PackCard
                    key={pack.id}
                    pack={pack}
                    currency={plans.currency}
                    generations={Math.floor(pack.credits / (plans.jobCost.generate ?? 1))}
                    busy={busyId === pack.id}
                    disabled={!ready}
                    onBuy={() => checkout('pack', pack.id)}
                  />
                ))}
              </div>
            </section>

            {/* 订阅 */}
            <section>
              <h2 className="text-base font-medium">{t('billing.subscribe')}</h2>
              <p className="mt-1 text-xs text-gray-500">{t('billing.subscribeHint')}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {plans.plans.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    currency={plans.currency}
                    busy={busyId === plan.id}
                    disabled={!ready}
                    onSubscribe={() => checkout('plan', plan.id)}
                  />
                ))}
              </div>
            </section>

            {/* 积分明细 */}
            <section>
              <h2 className="text-base font-medium">{t('billing.ledger')}</h2>
              {summary.ledger.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">{t('billing.ledgerEmpty')}</p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800">
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead className="bg-gray-900 text-xs text-gray-500">
                      <tr>
                        <th className="px-2 py-2 font-medium sm:px-3">{t('billing.colTime')}</th>
                        <th className="px-2 py-2 font-medium sm:px-3">{t('billing.colReason')}</th>
                        <th className="px-2 py-2 text-right font-medium sm:px-3">{t('billing.colDelta')}</th>
                        {/* 手机屏幕窄:余额与备注属于次要信息,收进桌面端 */}
                        <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">{t('billing.colBalance')}</th>
                        <th className="hidden px-3 py-2 font-medium sm:table-cell">{t('billing.colNote')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.ledger.map((e) => (
                        <tr key={e.id} className="border-t border-gray-800/70">
                          <td className="whitespace-nowrap px-2 py-2 text-gray-400 sm:px-3">{formatTime(e.createdAt)}</td>
                          <td className="px-2 py-2 text-gray-300 sm:px-3">
                            {t(REASON_KEY[e.reason] ?? 'common.unknown')}
                            {/* 手机上备注并到类型下方,不额外占列 */}
                            {e.note && <span className="mt-0.5 block text-[11px] text-gray-500 sm:hidden">{e.note}</span>}
                          </td>
                          <td
                            className={`px-2 py-2 text-right font-medium sm:px-3 ${
                              e.delta >= 0 ? 'text-emerald-400' : 'text-gray-300'
                            }`}
                          >
                            {e.delta >= 0 ? `+${e.delta}` : e.delta}
                            <span className="mt-0.5 block text-[10px] font-normal text-gray-500 sm:hidden">
                              {t('billing.colBalance')} {e.balanceAfter}
                            </span>
                          </td>
                          <td className="hidden px-3 py-2 text-right text-gray-400 sm:table-cell">{e.balanceAfter}</td>
                          <td className="hidden px-3 py-2 text-gray-500 sm:table-cell">{e.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* 订单记录(还没有订单时不显示,避免空表格占位) */}
            {summary.orders.length > 0 && (
              <section>
                <h2 className="text-base font-medium">{t('billing.orders')}</h2>
                <div className="mt-3 overflow-x-auto rounded-xl border border-gray-800">
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead className="bg-gray-900 text-xs text-gray-500">
                      <tr>
                        <th className="px-2 py-2 font-medium sm:px-3">{t('billing.colTime')}</th>
                        <th className="px-2 py-2 font-medium sm:px-3">{t('billing.colAmount')}</th>
                        <th className="px-2 py-2 text-right font-medium sm:px-3">{t('billing.colCredits')}</th>
                        <th className="px-2 py-2 font-medium sm:px-3">{t('billing.colStatus')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.orders.map((o) => (
                        <tr key={o.id} className="border-t border-gray-800/70">
                          <td className="whitespace-nowrap px-2 py-2 text-gray-400 sm:px-3">{formatTime(o.createdAt)}</td>
                          <td className="px-2 py-2 text-gray-300 sm:px-3">
                            {formatPrice(o.amountMinor, o.currency)}
                            <span className="ml-2 hidden text-xs text-gray-600 sm:inline">{o.provider}</span>
                          </td>
                          <td className="px-2 py-2 text-right text-emerald-400 sm:px-3">+{o.credits}</td>
                          <td className="px-2 py-2 text-gray-300 sm:px-3">{t(STATUS_KEY[o.status] ?? 'common.unknown')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

/** 账本类型 → 词典键(键名是契约,这里把它显式收敛成一张表,加类型时编译期就会报缺) */
const REASON_KEY: Record<LedgerReason, DictKey> = {
  signup: 'billing.reason.signup',
  job_hold: 'billing.reason.job_hold',
  job_release: 'billing.reason.job_release',
  purchase: 'billing.reason.purchase',
  refund: 'billing.reason.refund',
  admin_grant: 'billing.reason.admin_grant',
  expire: 'billing.reason.expire',
}

const STATUS_KEY: Record<BillingSummary['orders'][number]['status'], DictKey> = {
  pending: 'billing.status.pending',
  paid: 'billing.status.paid',
  failed: 'billing.status.failed',
  refunded: 'billing.status.refunded',
}

function badgeLabel(badge: string, t: ReturnType<typeof useT>): string {
  if (badge === 'popular') return t('billing.badge.popular')
  if (badge === 'bestValue') return t('billing.badge.bestValue')
  return ''
}

function Badge({ badge, t }: { badge: string; t: ReturnType<typeof useT> }) {
  const label = badgeLabel(badge, t)
  if (!label) return null
  return (
    <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[11px] text-indigo-300">{label}</span>
  )
}

function PackCard({
  pack,
  currency,
  generations,
  busy,
  disabled,
  onBuy,
}: {
  pack: CreditPack
  currency: string
  generations: number
  busy: boolean
  disabled: boolean
  onBuy: () => void
}) {
  const t = useT()
  return (
    <div className="flex flex-col rounded-2xl border border-gray-800 bg-gray-900 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-gray-400">{t('billing.creditsAmount', { credits: pack.credits })}</span>
        <Badge badge={pack.badge} t={t} />
      </div>
      <p className="text-2xl font-semibold text-gray-100">{formatPrice(pack.priceMinor, currency)}</p>
      <p className="mt-1 text-xs text-gray-500">{t('billing.generationsHint', { count: generations })}</p>
      <button
        onClick={onBuy}
        disabled={busy || disabled}
        className="mt-5 rounded-xl bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
      >
        {busy ? t('common.loading') : t('billing.buy')}
      </button>
    </div>
  )
}

function PlanCard({
  plan,
  currency,
  busy,
  disabled,
  onSubscribe,
}: {
  plan: SubscriptionPlan
  currency: string
  busy: boolean
  disabled: boolean
  onSubscribe: () => void
}) {
  const t = useT()
  return (
    <div className="flex flex-col rounded-2xl border border-gray-800 bg-gray-900 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-base font-medium text-gray-100">{plan.name}</span>
        <Badge badge={plan.badge} t={t} />
      </div>
      <p className="text-2xl font-semibold text-gray-100">
        {formatPrice(plan.priceMinor, currency)}
        <span className="text-sm font-normal text-gray-500">{t('billing.perMonthSuffix')}</span>
      </p>
      <p className="mt-1 text-xs text-gray-500">{t('billing.perMonth', { credits: plan.creditsPerPeriod })}</p>
      <button
        onClick={onSubscribe}
        disabled={busy || disabled}
        className="mt-5 rounded-xl border border-indigo-500/50 py-2 text-sm font-medium text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-40"
      >
        {busy ? t('common.loading') : t('billing.subscribeAction')}
      </button>
    </div>
  )
}
