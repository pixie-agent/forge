import { useCallback, useEffect, useState, type ReactNode } from 'react'
import AdminBar from '../components/AdminBar'
import { api } from '../lib/api'
import type { AdminDashboard, AdminDashboardSeriesPoint } from '../lib/types'

const PERIODS = [7, 30, 90] as const

const fmtInt = (v: number) => (Number.isFinite(v) ? v.toLocaleString('zh-CN') : '—')
const fmtPct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)
const fmtMoney = (minor: number | null) => (minor === null ? '—' : `$${(minor / 100).toFixed(2)}`)
const fmtUsd = (v: number | null) => (v === null ? '—' : `$${v.toFixed(2)}`)
const fmtMs = (v: number | null) =>
  v === null ? '—' : v >= 60_000 ? `${(v / 60_000).toFixed(1)} 分` : `${Math.round(v / 1000)} 秒`
const fmtHours = (v: number | null) =>
  v === null ? '—' : v >= 24 ? `${(v / 24).toFixed(1)} 天` : `${v.toFixed(1)} 小时`

/** 大盘专用的单值卡片 */
function Stat({ label, value, sub, tone = 'text-gray-100' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  )
}

interface TrendSeries {
  label: string
  color: string
  values: number[]
}

/** 手写 SVG 折线图:不引图表库,管理后台只依赖 Tailwind */
function Trend({ title, points, series }: { title: string; points: string[]; series: TrendSeries[] }) {
  const max = Math.max(1, ...series.flatMap((s) => s.values))
  const W = 640
  const H = 120
  const path = (values: number[]) =>
    values
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i / Math.max(1, points.length - 1)) * W} ${H - (v / max) * H}`)
      .join(' ')

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-300">{title}</h2>
        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-36 w-full" preserveAspectRatio="none">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgb(55 65 81)" strokeWidth="0.5" />
        ))}
        {series.map((s) => (
          <path key={s.label} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="flex justify-between text-[11px] text-gray-600">
        <span>{points[0]}</span>
        <span>峰值 {fmtInt(max)}</span>
        <span>{points[points.length - 1]}</span>
      </div>
    </section>
  )
}

/** 留存格子:值越高颜色越深;未成熟(还没到 Dn)显示 — */
function RetentionCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-gray-600">—</span>
  return (
    <span
      className="inline-block min-w-14 rounded-md px-2 py-1 text-center tabular-nums text-gray-100"
      style={{ backgroundColor: `rgba(99,102,241,${0.12 + value * 0.6})` }}
    >
      {(value * 100).toFixed(1)}%
    </span>
  )
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-gray-200">{title}</h2>
        {desc && <p className="mt-0.5 text-xs text-gray-500">{desc}</p>}
      </div>
      {children}
    </section>
  )
}

export default function AdminDashboardPage() {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null)
  const [days, setDays] = useState<number>(30)
  const [end, setEnd] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api<{ dashboard: AdminDashboard }>(`/api/admin/dashboard?days=${days}&end=${end}`)
      setDashboard(data.dashboard)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [days, end])

  useEffect(() => {
    void load()
  }, [load])

  const points: string[] = dashboard?.series.map((p: AdminDashboardSeriesPoint) => p.day) ?? []

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <AdminBar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-5 sm:px-4 sm:py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">用户大盘</h1>
            <p className="mt-1 text-xs text-gray-500">
              口径固定 UTC+8 · 活跃 = 访问/生成/关键行为按天去重 · 生成活跃 = 当天创建过任务 · 支持今日 / 昨日 T-1
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-gray-800 p-0.5">
              {[
                { value: 0, label: '今日' },
                { value: 1, label: '昨日 T-1' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setEnd(opt.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs ${
                    end === opt.value ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex rounded-xl border border-gray-800 p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setDays(p)}
                  className={`rounded-lg px-3 py-1.5 text-xs ${
                    days === p ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  近 {p} 天
                </button>
              ))}
            </div>
            <button
              onClick={() => void load()}
              className="rounded-xl border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
            >
              刷新
            </button>
          </div>
        </div>

        {error && <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}
        {loading && !dashboard ? (
          <p className="mt-8 text-sm text-gray-500">加载中…</p>
        ) : !dashboard ? (
          <div className="mt-8 rounded-2xl border border-dashed border-gray-800 py-20 text-center text-sm text-gray-500">
            暂无数据
          </div>
        ) : (
          <DashboardBody d={dashboard} points={points} />
        )}
      </main>
    </div>
  )
}

function DashboardBody({ d, points }: { d: AdminDashboard; points: string[] }) {
  const o = d.overview
  const m = d.monetization
  const q = d.quality
  const dayLabel = d.end === 0 ? '今日' : '昨日'
  const funnelStages = [
    ['注册', d.funnel.registered],
    ['邮箱验证', d.funnel.verified],
    ['建项目', d.funnel.has_project],
    ['发起任务', d.funnel.has_job],
    ['任务成功', d.funnel.has_succeeded],
    ['生成版本', d.funnel.has_version],
    ['发布', d.funnel.has_published],
    ['付费', d.funnel.has_paid],
  ] as const
  const maxFunnel = Math.max(1, ...funnelStages.map(([, v]) => v))

  return (
    <>
      <Section title="总览" desc={`统计日 ${dayLabel} · 生成时间 ${new Date(d.generated_at).toLocaleString('zh-CN')} · 趋势窗口 ${d.days} 天(截止${d.end === 0 ? '今天' : '昨天'})`}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="注册用户" value={fmtInt(o.users_total)} sub={`已验证 ${fmtInt(o.users_verified)}`} />
          <Stat label={`${dayLabel}新增`} value={fmtInt(o.new_users_today)} sub={`近 7 天 ${fmtInt(o.new_users_7d)}`} />
          <Stat
            label={d.end === 0 ? '活跃用户 DAU' : '活跃用户(昨日)'}
            value={fmtInt(o.dau)}
            sub={`WAU ${fmtInt(o.wau)} · MAU ${fmtInt(o.mau)} · 粘性 ${fmtPct(o.stickiness)}`}
          />
          <Stat
            label={d.end === 0 ? '生成活跃 DAU' : '生成活跃(昨日)'}
            value={fmtInt(o.dau_jobs)}
            sub={`WAU ${fmtInt(o.wau_jobs)} · MAU ${fmtInt(o.mau_jobs)}`}
            tone="text-indigo-300"
          />
          <Stat
            label="付费用户"
            value={fmtInt(o.paid_users_total)}
            sub={`累计转化 ${fmtPct(o.conversion_rate)} · 30 日 ${fmtInt(m.paid_users_30d)}`}
            tone="text-emerald-300"
          />
          <Stat label="近 30 天收入" value={fmtMoney(o.revenue_30d_minor)} sub={`累计 ${fmtMoney(o.revenue_total_minor)}`} />
          <Stat label="MRR" value={fmtMoney(o.mrr_minor)} sub={`活跃订阅 ${fmtInt(o.active_subscriptions)}`} />
          <Stat
            label="任务 / 成功率"
            value={fmtInt(o.jobs_today)}
            sub={`${dayLabel} · 累计 ${fmtInt(o.jobs_total)} · 7 日 ${fmtInt(o.jobs_7d)}`}
          />
          <Stat
            label="近 30 天成本"
            value={fmtUsd(o.cost_30d_usd)}
            sub={`单成功任务 ${fmtUsd(o.cost_per_success_30d_usd)}`}
            tone="text-amber-300"
          />
          <Stat label="项目 / 已发布" value={`${fmtInt(o.projects_total)} / ${fmtInt(o.projects_published)}`} sub="项目总数 / 发布过" />
          <Stat
            label="任务结果"
            value={`${fmtInt(o.jobs_succeeded)} / ${fmtInt(o.jobs_failed)}`}
            sub={`成功 / 失败 · 取消 ${fmtInt(o.jobs_cancelled)}`}
          />
          <Stat
            label={`${dayLabel}任务`}
            value={fmtInt(o.jobs_today)}
            sub={`近 7 天 ${fmtInt(o.jobs_7d)}`}
          />
        </div>
      </Section>

      <Section title="趋势" desc="按 UTC+8 自然日聚合;统计日选「昨日 T-1」时窗口截止到昨天">
        <div className="grid gap-3 lg:grid-cols-2">
          <Trend
            title="新增用户"
            points={points}
            series={[{ label: '新增注册', color: 'rgb(129 140 248)', values: d.series.map((p) => p.new_users) }]}
          />
          <Trend
            title="活跃用户"
            points={points}
            series={[
              { label: '活跃用户', color: 'rgb(52 211 153)', values: d.series.map((p) => p.active_users) },
              { label: '生成活跃', color: 'rgb(129 140 248)', values: d.series.map((p) => p.active_job_users) },
            ]}
          />
          <Trend
            title="任务量"
            points={points}
            series={[
              { label: '全部', color: 'rgb(148 163 184)', values: d.series.map((p) => p.jobs) },
              { label: '成功', color: 'rgb(52 211 153)', values: d.series.map((p) => p.succeeded) },
              { label: '失败', color: 'rgb(248 113 113)', values: d.series.map((p) => p.failed) },
            ]}
          />
          <Trend
            title="收入(美分)"
            points={points}
            series={[{ label: '已支付', color: 'rgb(251 191 36)', values: d.series.map((p) => p.revenue_minor) }]}
          />
        </div>
      </Section>

      <Section title="激活漏斗" desc="累计口径:每个阶段有多少用户至少完成过一次">
        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
          <div className="space-y-2.5">
            {funnelStages.map(([label, value], index) => {
              const prev = index === 0 ? value : funnelStages[index - 1][1]
              const step = index === 0 ? null : prev > 0 ? value / prev : null
              return (
                <div key={label} className="grid grid-cols-[5.5rem_1fr_7rem] items-center gap-3 text-sm">
                  <span className="text-gray-400">{label}</span>
                  <div className="h-5 overflow-hidden rounded-md bg-gray-800/60">
                    <div
                      className="h-full rounded-md bg-indigo-500/70"
                      style={{ width: `${Math.max(value > 0 ? 2 : 0, (value / maxFunnel) * 100)}%` }}
                    />
                  </div>
                  <div className="text-right tabular-nums text-gray-300">
                    {fmtInt(value)}
                    <span className="ml-2 text-xs text-gray-500">{step === null ? '100%' : fmtPct(step)}</span>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-800 pt-4 text-xs text-gray-500 sm:grid-cols-4">
            <div>
              激活用户 <span className="text-gray-200">{fmtInt(d.activation.activated)}</span> / {fmtInt(d.activation.users)}
            </div>
            <div>
              24h 激活 <span className="text-gray-200">{fmtInt(d.activation.activated_24h)}</span>
            </div>
            <div>
              7d 激活 <span className="text-gray-200">{fmtInt(d.activation.activated_7d)}</span>
            </div>
            <div>
              首成功耗时中位数 <span className="text-gray-200">{fmtHours(d.activation.median_ttv_hours)}</span>
              <span className="ml-1 text-gray-600">P90 {fmtHours(d.activation.p90_ttv_hours)}</span>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="留存"
        desc="按注册周 cohort;活跃 = 当天有会话请求、任务或事件。未到对应天数显示 —,避免用未成熟数据下结论"
      >
        {d.retention.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-800 py-12 text-center text-sm text-gray-500">
            暂无 cohort 数据
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-900 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">注册周(周一)</th>
                  <th className="px-4 py-2.5 font-medium">用户数</th>
                  <th className="px-4 py-2.5 font-medium">D1</th>
                  <th className="px-4 py-2.5 font-medium">D3</th>
                  <th className="px-4 py-2.5 font-medium">D7</th>
                  <th className="px-4 py-2.5 font-medium">D14</th>
                  <th className="px-4 py-2.5 font-medium">D30</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {d.retention.map((row) => (
                  <tr key={row.cohort}>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{row.cohort}</td>
                    <td className="px-4 py-2.5 tabular-nums text-gray-300">{fmtInt(row.size)}</td>
                    <td className="px-4 py-2.5"><RetentionCell value={row.d1} /></td>
                    <td className="px-4 py-2.5"><RetentionCell value={row.d3} /></td>
                    <td className="px-4 py-2.5"><RetentionCell value={row.d7} /></td>
                    <td className="px-4 py-2.5"><RetentionCell value={row.d14} /></td>
                    <td className="px-4 py-2.5"><RetentionCell value={row.d30} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="商业化" desc="收入为现金口径(已支付订单);毛利同时给现金口径与消耗口径">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="付费转化率(累计)" value={fmtPct(m.conversion_rate)} sub={`${fmtInt(m.paying_users)} 付费 / ${fmtInt(o.users_total)} 注册`} tone="text-emerald-300" />
          <Stat label="30 日付费渗透" value={fmtPct(m.paying_penetration_30d)} sub={`${fmtInt(m.paid_users_30d)} 付费用户 / MAU ${fmtInt(o.mau)}`} />
          <Stat label="ARPPU" value={fmtMoney(m.arppu_minor)} sub={`ARPU(30d) ${fmtMoney(m.arpu_30d_minor)}`} />
          <Stat label="首购时延中位数" value={m.first_purchase_median_days === null ? '—' : `${m.first_purchase_median_days.toFixed(1)} 天`} sub="注册 → 首笔已支付订单" />
          <Stat label="退款率" value={fmtPct(m.refund_rate)} sub={`退款订单 ${fmtInt(m.refunded_orders)}`} />
          <Stat label="MRR" value={fmtMoney(m.mrr_minor)} sub={`活跃订阅 ${fmtInt(m.active_subscriptions)}`} />
          <Stat label="现金毛利(30d)" value={fmtUsd(m.cash_margin_30d_usd)} sub="收入 - 成本" tone={m.cash_margin_30d_usd >= 0 ? 'text-emerald-300' : 'text-red-400'} />
          <Stat
            label="消耗口径毛利(30d)"
            value={fmtUsd(m.consumed_margin_30d_usd)}
            sub={`消耗收入 ${fmtMoney(m.consumed_revenue_30d_minor)} - 成本`}
            tone={m.consumed_margin_30d_usd >= 0 ? 'text-emerald-300' : 'text-red-400'}
          />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
            <h3 className="text-sm font-medium text-gray-300">订阅档位</h3>
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="pb-2 font-medium">档位</th>
                  <th className="pb-2 font-medium">活跃订阅</th>
                  <th className="pb-2 text-right font-medium">MRR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {m.subscription_plans.map((p) => (
                  <tr key={p.catalog_id}>
                    <td className="py-2 text-gray-300">{p.name}</td>
                    <td className="py-2 tabular-nums text-gray-400">{fmtInt(p.count)}</td>
                    <td className="py-2 text-right tabular-nums text-gray-300">{fmtMoney(p.mrr_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-gray-600">
              订阅收入只在 subscription.paid 时发积分,因此 MRR 用活跃订阅 × 本地目录月价估算。
            </p>
          </div>

          <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
            <h3 className="text-sm font-medium text-gray-300">积分经济(30 天)</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="text-gray-500">消耗积分 <div className="mt-0.5 text-gray-200">{fmtInt(m.consumed_credits_30d)}</div></div>
              <div className="text-gray-500">购买积分 <div className="mt-0.5 text-gray-200">{fmtInt(m.purchased_credits_30d)}</div></div>
              <div className="text-gray-500">用过积分用户 <div className="mt-0.5 text-gray-200">{fmtInt(m.users_with_usage)}</div></div>
              <div className="text-gray-500">余额为 0 <div className="mt-0.5 text-gray-200">{fmtInt(m.zero_balance_users)}</div></div>
              <div className="text-gray-500">耗尽赠送额度 <div className="mt-0.5 text-gray-200">{fmtInt(m.exhausted_users)}</div></div>
              <div className="text-gray-500">耗尽后付费 <div className="mt-0.5 text-emerald-300">{fmtInt(m.exhausted_paid_users)}</div></div>
            </div>
            <div className="mt-4 border-t border-gray-800 pt-3 text-xs text-gray-500">
              每积分均价 {fmtMoney(m.revenue_per_credit_minor)} · 耗尽后付费转化{' '}
              <span className="text-gray-200">
                {m.exhausted_users > 0 ? fmtPct(m.exhausted_paid_users / m.exhausted_users) : '—'}
              </span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="质量与成本" desc="区间与顶部趋势窗口一致;成本来自 agent 上报的 job_usage">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="任务量" value={fmtInt(q.jobs)} sub={`成功 ${fmtInt(q.succeeded)} · 失败 ${fmtInt(q.failed)} · 取消 ${fmtInt(q.cancelled)}`} />
          <Stat label="成功率" value={fmtPct(q.success_rate)} sub="成功 ÷ 全部任务" tone="text-emerald-300" />
          <Stat label="生成耗时 P50 / P90" value={`${fmtMs(q.p50_run_ms)} / ${fmtMs(q.p90_run_ms)}`} sub={`均值 ${fmtMs(q.avg_run_ms)}`} />
          <Stat label="排队耗时 P50 / P90" value={`${fmtMs(q.p50_queue_ms)} / ${fmtMs(q.p90_queue_ms)}`} sub={`均值 ${fmtMs(q.avg_queue_ms)}`} />
          <Stat label="区间成本" value={fmtUsd(q.cost.total_usd)} sub={`LLM ${fmtUsd(q.cost.llm_usd)} · GCP ${fmtUsd(q.cost.gcp_usd)}`} tone="text-amber-300" />
          <Stat label="单成功任务成本" value={fmtUsd(q.cost.per_success_usd)} sub="失败任务成本也摊在里面" />
          <Stat label="输入 / 输出 token" value={`${fmtInt(q.tokens.input)} / ${fmtInt(q.tokens.output)}`} sub={`缓存读 ${fmtInt(q.tokens.cache_read)} · 写 ${fmtInt(q.tokens.cache_write)}`} />
          <Stat label="已发布项目" value={fmtInt(o.projects_published)} sub={`项目总数 ${fmtInt(o.projects_total)}`} />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-2xl border border-gray-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-900 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">类型</th>
                  <th className="px-4 py-2.5 font-medium">通道</th>
                  <th className="px-4 py-2.5 font-medium">任务</th>
                  <th className="px-4 py-2.5 font-medium">成功</th>
                  <th className="px-4 py-2.5 font-medium">失败</th>
                  <th className="px-4 py-2.5 font-medium">取消</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {q.by_type.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-gray-600">
                      区间内没有任务
                    </td>
                  </tr>
                ) : (
                  q.by_type.map((r) => (
                    <tr key={`${r.type}-${r.channel}`}>
                      <td className="px-4 py-2.5 text-gray-300">{r.type === 'generate' ? '生成' : r.type === 'chat' ? '对话' : r.type}</td>
                      <td className="px-4 py-2.5 text-gray-400">{r.channel === 'free' ? '免费' : 'VIP'}</td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-300">{fmtInt(r.jobs)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-emerald-400">{fmtInt(r.succeeded)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-red-400">{fmtInt(r.failed)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-500">{fmtInt(r.cancelled)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
            <h3 className="text-sm font-medium text-gray-300">失败原因 Top</h3>
            {q.top_errors.length === 0 ? (
              <p className="mt-4 text-xs text-gray-600">区间内没有失败任务</p>
            ) : (
              <ol className="mt-3 space-y-2">
                {q.top_errors.map((e, i) => (
                  <li key={`${i}-${e.error.slice(0, 20)}`} className="flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words text-gray-400">{e.error}</span>
                    <span className="shrink-0 tabular-nums text-gray-300">{fmtInt(e.count)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </Section>

      <Section title="口径说明">
        <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-gray-500">
          <li>活跃用户:访问(user_daily_active)∪ 生成(jobs)∪ 关键行为(user_events)按天去重;埋点上线前的历史用后两者回算。</li>
          <li>生成活跃:当天创建过任务(generate 或 chat)的去重用户。</li>
          <li>激活 = 首个成功任务;TTV = 注册到首个成功任务的耗时。</li>
          <li>付费转化(累计)= 有已支付订单的用户 ÷ 全部注册用户;30 日渗透 = 近 30 天付费用户 ÷ MAU。</li>
          <li>现金口径毛利 = 近 30 天已支付金额 − 近 30 天成本;消耗口径毛利 = 消耗积分按购买均价折算的收入 − 成本。</li>
          <li>留存分母是注册周 cohort;Dn 指注册后第 n 天当天有活跃行为,不是「n 天内任意一天」。</li>
        </ul>
      </Section>
    </>
  )
}
