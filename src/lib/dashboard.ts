/**
 * 管理后台大盘的聚合层(见 docs/FORGE2.md §22)。
 *
 * 口径约定:
 *   - 时间一律按 **UTC+8(Asia/Shanghai)** 切日。D1 的 datetime('now') 是 UTC,
 *     所以 SQL 里统一用 date(col, '+8 hours'),区间起点则把「本地日零点」换算回 UTC。
 *   - 活跃用户 = user_daily_active(访问)∪ jobs(生成)∪ user_events(关键行为)按天去重;
 *     生成活跃单独返回,不混成一个数。
 *   - 收入是**现金口径**(paid 订单金额);毛利同时给现金口径与消耗口径,
 *     因为充值当天全额计收入会把刚充值的月份毛利虚高。
 *   - 留存活跃 = user_daily_active ∪ jobs ∪ user_events 的按天去重,
 *     这样埋点上线前的历史留存也能用任务行为回算。
 */

import type { Env } from '../types'
import { SIGNUP_CREDITS } from './credits'
import { SUBSCRIPTION_PLANS } from './plans'

export interface DashboardSeriesPoint {
  day: string
  new_users: number
  active_users: number
  active_job_users: number
  jobs: number
  succeeded: number
  failed: number
  revenue_minor: number
  paid_users: number
  publishes: number
  checkout_starts: number
}

export interface DashboardOverview {
  users_total: number
  users_verified: number
  new_users_today: number
  new_users_7d: number
  projects_total: number
  projects_published: number
  jobs_total: number
  jobs_succeeded: number
  jobs_failed: number
  jobs_cancelled: number
  jobs_today: number
  jobs_7d: number
  /** 活跃用户(访问/生成/关键行为去重) */
  dau: number
  wau: number
  mau: number
  /** 生成活跃(当天创建过任务) */
  dau_jobs: number
  wau_jobs: number
  mau_jobs: number
  /** DAU ÷ MAU */
  stickiness: number | null
  paid_users_total: number
  conversion_rate: number | null
  revenue_total_minor: number
  revenue_30d_minor: number
  active_subscriptions: number
  mrr_minor: number
  cost_30d_usd: number
  cost_per_success_30d_usd: number | null
}

export interface DashboardFunnel {
  registered: number
  verified: number
  has_project: number
  has_job: number
  has_succeeded: number
  has_version: number
  has_published: number
  has_paid: number
}

export interface DashboardActivation {
  users: number
  activated: number
  activated_24h: number
  activated_7d: number
  median_ttv_hours: number | null
  p90_ttv_hours: number | null
}

export interface DashboardRetentionRow {
  /** 周 cohort 的周一(UTC+8) */
  cohort: string
  size: number
  d1: number | null
  d3: number | null
  d7: number | null
  d14: number | null
  d30: number | null
}

export interface DashboardMonetization {
  paying_users: number
  paid_users_30d: number
  conversion_rate: number | null
  paying_penetration_30d: number | null
  revenue_30d_minor: number
  revenue_total_minor: number
  arppu_minor: number | null
  arpu_30d_minor: number | null
  refunded_orders: number
  refund_rate: number | null
  first_purchase_median_days: number | null
  active_subscriptions: number
  mrr_minor: number
  subscription_plans: { catalog_id: string; name: string; count: number; mrr_minor: number }[]
  consumed_credits_30d: number
  purchased_credits_30d: number
  users_with_usage: number
  zero_balance_users: number
  /** 余额为 0 且确实用过积分(把赠送额度耗光的那批人) */
  exhausted_users: number
  /** 上面这批人里已经付过费的 */
  exhausted_paid_users: number
  revenue_per_credit_minor: number | null
  consumed_revenue_30d_minor: number
  cash_margin_30d_usd: number
  consumed_margin_30d_usd: number
}

export interface DashboardQuality {
  jobs: number
  succeeded: number
  failed: number
  cancelled: number
  success_rate: number | null
  avg_run_ms: number
  p50_run_ms: number | null
  p90_run_ms: number | null
  avg_queue_ms: number
  p50_queue_ms: number | null
  p90_queue_ms: number | null
  by_type: { type: string; channel: string; jobs: number; succeeded: number; failed: number; cancelled: number }[]
  top_errors: { error: string; count: number }[]
  tokens: { input: number; output: number; cache_read: number; cache_write: number }
  cost: { llm_usd: number; gcp_usd: number; total_usd: number; per_success_usd: number | null }
}

export interface DashboardData {
  generated_at: string
  days: number
  /** 统计日偏移:0=今天,1=昨天(T-1) */
  end: number
  timezone: 'UTC+8'
  overview: DashboardOverview
  series: DashboardSeriesPoint[]
  funnel: DashboardFunnel
  activation: DashboardActivation
  retention: DashboardRetentionRow[]
  monetization: DashboardMonetization
  quality: DashboardQuality
}

// ---------- 小工具 ----------

function n(v: unknown): number {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}

function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null
}

function roundMinor(v: number): number {
  return Math.max(0, Math.round(v))
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

function avg(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0
}

/** SQLite 的 datetime('now') 是 'YYYY-MM-DD HH:MM:SS'(UTC),解析时补 Z */
function sqliteUtcMs(s: string | null | undefined): number | null {
  if (!s) return null
  const normalized = s.includes('T') ? s : s.replace(' ', 'T') + 'Z'
  const ms = Date.parse(normalized)
  return Number.isFinite(ms) ? ms : null
}

/** UTC+8 的今天,YYYY-MM-DD */
function today(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/** 最近 days 天(截止到 end 天前,含端点),升序。end=0 为含今天,end=1 为截止昨天 T-1 */
function lastDays(days: number, end: number): string[] {
  const t = addDays(today(), -end)
  const out: string[] = []
  for (let i = days - 1; i >= 0; i--) out.push(addDays(t, -i))
  return out
}

/** 「UTC+8 的某天」的 SQL 表达式(day 偏移,end=0 为今天) */
function dayExpr(end: number): string {
  return `date('now','+8 hours','-${end} days')`
}

/** 窗口起点:days 天窗口(截止 end 天前)的 UTC+8 日零点,换算回 UTC 走 created_at 索引 */
function sinceUtc(days: number, end: number): string {
  return `datetime(date('now','+8 hours','-${days - 1 + end} days'), '-8 hours')`
}

/** 窗口终点(不含):end 天前的次日 UTC+8 零点,换算回 UTC。end=0 时是明天零点,不会截掉当天数据 */
function untilUtc(end: number): string {
  const modifier = end === 0 ? "'+1 day'" : `'-${end - 1} days'`
  return `datetime(date('now','+8 hours',${modifier}), '-8 hours')`
}

/**
 * 活跃用户:user_daily_active(访问)∪ jobs(生成)∪ user_events(关键行为)。
 * 埋点上线前的日子没有 user_daily_active,靠后两者回算,所以 T-1/历史 DAU 不会显示 0。
 * UNION(不是 UNION ALL)天然按 user_id 去重;只选 user_id 时可直接 COUNT(*)。
 */
function activityUnion(startUtc: string, until: string, startDay: string, endDay: string): string {
  return `SELECT user_id FROM user_daily_active WHERE day >= ${startDay} AND day <= ${endDay}
          UNION
          SELECT user_id FROM jobs WHERE created_at >= ${startUtc} AND created_at < ${until}
          UNION
          SELECT user_id FROM user_events WHERE created_at >= ${startUtc} AND created_at < ${until}`
}

function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  const dow = d.getUTCDay() // 0=Sun
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** 空对象工厂,避免每个点都写一遍字段 */
function emptyPoint(day: string): DashboardSeriesPoint {
  return {
    day,
    new_users: 0,
    active_users: 0,
    active_job_users: 0,
    jobs: 0,
    succeeded: 0,
    failed: 0,
    revenue_minor: 0,
    paid_users: 0,
    publishes: 0,
    checkout_starts: 0,
  }
}

// ---------- 主聚合 ----------

export async function buildDashboard(env: Env, requestedDays: number, requestedEnd = 0): Promise<DashboardData> {
  const days = Math.min(90, Math.max(1, Math.floor(requestedDays) || 30))
  /**
   * end=0:统计「今天」;end=1:统计「昨天(T-1)」。
   * 直接按天偏移查询,而不是取「现在往前 24 小时」,保证自然日口径可复现。
   * 允许到 30 天前,便于回看某一天,但 UI 只暴露今天/昨天。
   */
  const end = Math.min(30, Math.max(0, Math.floor(requestedEnd) || 0))
  const day = dayExpr(end)
  const wauStartDay = `date(${day}, '-6 days')`
  const mauStartDay = `date(${day}, '-29 days')`
  const seriesStartDay = `date(${day}, '-${days - 1} days')`
  const db = env.DB
  const since = sinceUtc(days, end)
  const until = untilUtc(end)
  const since30 = sinceUtc(30, end)

  const [
    snapshot,
    seriesNewUsers,
    seriesActive,
    seriesJobUsers,
    seriesJobs,
    seriesRevenue,
    seriesEvents,
    funnelRow,
    activationRows,
    retentionRows,
    firstPurchaseRows,
    subscriptionRows,
    qualityJobs,
    usageRow,
    runRows,
    queueRows,
    byTypeRows,
    errorRows,
    cost30Row,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM users) AS users_total,
           (SELECT COUNT(*) FROM users WHERE email_verified = 1) AS users_verified,
           (SELECT COUNT(*) FROM users WHERE date(created_at,'+8 hours') = ${day}) AS new_users_today,
           (SELECT COUNT(*) FROM users WHERE created_at >= ${sinceUtc(7, end)} AND created_at < ${until}) AS new_users_7d,
           (SELECT COUNT(*) FROM projects) AS projects_total,
           (SELECT COUNT(*) FROM projects WHERE published_version > 0) AS projects_published,
           (SELECT COUNT(*) FROM jobs) AS jobs_total,
           (SELECT COUNT(*) FROM jobs WHERE status = 'succeeded') AS jobs_succeeded,
           (SELECT COUNT(*) FROM jobs WHERE status = 'failed') AS jobs_failed,
           (SELECT COUNT(*) FROM jobs WHERE status = 'cancelled') AS jobs_cancelled,
           (SELECT COUNT(*) FROM jobs WHERE date(created_at,'+8 hours') = ${day}) AS jobs_today,
           (SELECT COUNT(*) FROM jobs WHERE created_at >= ${sinceUtc(7, end)} AND created_at < ${until}) AS jobs_7d,
           (SELECT COUNT(*) FROM (${activityUnion(sinceUtc(1, end), until, day, day)})) AS dau,
           (SELECT COUNT(*) FROM (${activityUnion(sinceUtc(7, end), until, wauStartDay, day)})) AS wau,
           (SELECT COUNT(*) FROM (${activityUnion(sinceUtc(30, end), until, mauStartDay, day)})) AS mau,
           (SELECT COUNT(DISTINCT user_id) FROM jobs WHERE date(created_at,'+8 hours') = ${day}) AS dau_jobs,
           (SELECT COUNT(DISTINCT user_id) FROM jobs WHERE created_at >= ${sinceUtc(7, end)} AND created_at < ${until}) AS wau_jobs,
           (SELECT COUNT(DISTINCT user_id) FROM jobs WHERE created_at >= ${sinceUtc(30, end)} AND created_at < ${until}) AS mau_jobs,
           (SELECT COUNT(*) FROM orders WHERE status = 'paid') AS paid_orders,
           (SELECT COUNT(DISTINCT user_id) FROM orders WHERE status = 'paid') AS paying_users,
           (SELECT COUNT(DISTINCT user_id) FROM orders WHERE status = 'paid' AND paid_at >= ${since30} AND paid_at < ${until}) AS paid_users_30d,
           (SELECT COUNT(*) FROM jobs WHERE status = 'succeeded' AND created_at >= ${since30} AND created_at < ${until}) AS jobs_succeeded_30d,
           (SELECT COALESCE(SUM(amount_minor),0) FROM orders WHERE status = 'paid') AS revenue_total_minor,
           (SELECT COALESCE(SUM(amount_minor),0) FROM orders WHERE status = 'paid' AND paid_at >= ${since30} AND paid_at < ${until}) AS revenue_30d_minor,
           (SELECT COUNT(*) FROM orders WHERE status = 'refunded') AS refunded_orders,
           (SELECT COUNT(*) FROM subscriptions WHERE status IN ('active','trialing')) AS active_subscriptions,
           (SELECT COALESCE(SUM(-delta),0) FROM credit_ledger WHERE reason = 'job_hold' AND created_at >= ${since30} AND created_at < ${until}) AS consumed_credits_30d,
           (SELECT COALESCE(SUM(delta),0) FROM credit_ledger WHERE reason = 'purchase' AND created_at >= ${since30} AND created_at < ${until}) AS purchased_credits_30d,
           (SELECT COALESCE(SUM(delta),0) FROM credit_ledger WHERE reason = 'purchase') AS purchased_credits_total,
           (SELECT COUNT(*) FROM users WHERE credits <= 0) AS zero_balance_users,
           (SELECT COUNT(DISTINCT user_id) FROM credit_ledger WHERE reason = 'job_hold') AS users_with_usage,
           (SELECT COUNT(*) FROM users u
             WHERE u.credits <= 0 AND EXISTS (
               SELECT 1 FROM credit_ledger l WHERE l.user_id = u.id AND l.reason = 'job_hold'
             )) AS exhausted_users,
           (SELECT COUNT(*) FROM users u
             WHERE u.credits <= 0 AND EXISTS (
               SELECT 1 FROM credit_ledger l WHERE l.user_id = u.id AND l.reason = 'job_hold'
             ) AND EXISTS (
               SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status = 'paid'
             )) AS exhausted_paid_users`
      )
      .first<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT date(created_at,'+8 hours') AS day, COUNT(*) AS n
           FROM users WHERE created_at >= ${since} AND created_at < ${until} GROUP BY day`
      )
      .all<{ day: string; n: number }>(),
    db
      .prepare(
        `SELECT day, COUNT(DISTINCT user_id) AS n FROM (
           SELECT user_id, day FROM user_daily_active WHERE day >= ${seriesStartDay} AND day <= ${day}
           UNION ALL
           SELECT user_id, date(created_at,'+8 hours') AS day FROM jobs
            WHERE created_at >= ${since} AND created_at < ${until}
           UNION ALL
           SELECT user_id, date(created_at,'+8 hours') AS day FROM user_events
            WHERE created_at >= ${since} AND created_at < ${until}
         ) GROUP BY day`
      )
      .all<{ day: string; n: number }>(),
    db
      .prepare(
        `SELECT date(created_at,'+8 hours') AS day, COUNT(DISTINCT user_id) AS n
           FROM jobs WHERE created_at >= ${since} AND created_at < ${until} GROUP BY day`
      )
      .all<{ day: string; n: number }>(),
    db
      .prepare(
        `SELECT date(created_at,'+8 hours') AS day,
                COUNT(*) AS jobs,
                COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END),0) AS succeeded,
                COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END),0) AS failed
           FROM jobs WHERE created_at >= ${since} AND created_at < ${until} GROUP BY day`
      )
      .all<{ day: string; jobs: number; succeeded: number; failed: number }>(),
    db
      .prepare(
        `SELECT date(paid_at,'+8 hours') AS day,
                COALESCE(SUM(amount_minor),0) AS revenue_minor,
                COUNT(DISTINCT user_id) AS paid_users
           FROM orders WHERE status = 'paid' AND paid_at >= ${since} AND paid_at < ${until} GROUP BY day`
      )
      .all<{ day: string; revenue_minor: number; paid_users: number }>(),
    db
      .prepare(
        `SELECT date(created_at,'+8 hours') AS day,
                COALESCE(SUM(CASE WHEN name = 'publish' THEN 1 ELSE 0 END),0) AS publishes,
                COALESCE(SUM(CASE WHEN name = 'checkout_start' THEN 1 ELSE 0 END),0) AS checkout_starts
           FROM user_events WHERE created_at >= ${since} AND created_at < ${until} GROUP BY day`
      )
      .all<{ day: string; publishes: number; checkout_starts: number }>(),
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM users) AS registered,
           (SELECT COUNT(*) FROM users WHERE email_verified = 1) AS verified,
           (SELECT COUNT(DISTINCT user_id) FROM projects) AS has_project,
           (SELECT COUNT(DISTINCT user_id) FROM jobs) AS has_job,
           (SELECT COUNT(DISTINCT user_id) FROM jobs WHERE status = 'succeeded') AS has_succeeded,
           (SELECT COUNT(DISTINCT p.user_id) FROM versions v JOIN projects p ON p.id = v.project_id
             WHERE v.version_no > 0) AS has_version,
           (SELECT COUNT(DISTINCT user_id) FROM projects WHERE published_version > 0) AS has_published,
           (SELECT COUNT(DISTINCT user_id) FROM orders WHERE status = 'paid') AS has_paid`
      )
      .first<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT u.created_at AS created_at,
                (SELECT MIN(j.created_at) FROM jobs j
                  WHERE j.user_id = u.id AND j.status = 'succeeded') AS first_success
           FROM users u WHERE u.created_at >= datetime('now','-90 days')`
      )
      .all<{ created_at: string; first_success: string | null }>(),
    db
      .prepare(
        `WITH activity AS (
           SELECT user_id, day FROM user_daily_active
            WHERE day >= date('now','+8 hours','-120 days')
           UNION
           SELECT user_id, date(created_at,'+8 hours') FROM jobs
            WHERE created_at >= datetime('now','-120 days')
           UNION
           SELECT user_id, date(created_at,'+8 hours') FROM user_events
            WHERE created_at >= datetime('now','-120 days')
         ),
         cohort AS (
           SELECT id, date(created_at,'+8 hours') AS d FROM users
            WHERE created_at >= datetime('now','-120 days')
         ),
         pair AS (
           SELECT cohort.d, cohort.id, activity.day
             FROM cohort LEFT JOIN activity ON activity.user_id = cohort.id
         )
         SELECT d AS signup_day,
                COUNT(DISTINCT id) AS size,
                COUNT(DISTINCT CASE WHEN day = date(d,'+1 day')  THEN id END) AS d1,
                COUNT(DISTINCT CASE WHEN day = date(d,'+3 day')  THEN id END) AS d3,
                COUNT(DISTINCT CASE WHEN day = date(d,'+7 day')  THEN id END) AS d7,
                COUNT(DISTINCT CASE WHEN day = date(d,'+14 day') THEN id END) AS d14,
                COUNT(DISTINCT CASE WHEN day = date(d,'+30 day') THEN id END) AS d30
           FROM pair GROUP BY d ORDER BY d`
      )
      .all<{ signup_day: string; size: number; d1: number; d3: number; d7: number; d14: number; d30: number }>(),
    db
      .prepare(
        `SELECT u.created_at AS created_at, MIN(o.paid_at) AS first_paid
           FROM users u JOIN orders o ON o.user_id = u.id AND o.status = 'paid'
          GROUP BY u.id`
      )
      .all<{ created_at: string; first_paid: string | null }>(),
    db
      .prepare(
        `SELECT COALESCE(catalog_id,'') AS catalog_id, status, COUNT(*) AS n
           FROM subscriptions GROUP BY catalog_id, status`
      )
      .all<{ catalog_id: string; status: string; n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS jobs,
                COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END),0) AS succeeded,
                COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END),0) AS failed,
                COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END),0) AS cancelled
           FROM jobs WHERE created_at >= ${since} AND created_at < ${until}`
      )
      .first<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n,
                COALESCE(SUM(input_tokens),0) AS input_tokens,
                COALESCE(SUM(output_tokens),0) AS output_tokens,
                COALESCE(SUM(cache_read),0) AS cache_read,
                COALESCE(SUM(cache_write),0) AS cache_write,
                COALESCE(SUM(llm_cost_usd),0) AS llm_usd,
                COALESCE(SUM(gcp_cost_usd),0) AS gcp_usd,
                COALESCE(SUM(cost_usd),0) AS total_usd
           FROM job_usage WHERE created_at >= ${since} AND created_at < ${until}`
      )
      .first<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT run_ms FROM job_usage WHERE created_at >= ${since} AND created_at < ${until} AND run_ms > 0`
      )
      .all<{ run_ms: number }>(),
    db
      .prepare(
        `SELECT CAST((julianday(started_at) - julianday(created_at)) * 86400000 AS INTEGER) AS ms
           FROM jobs WHERE created_at >= ${since} AND created_at < ${until} AND started_at IS NOT NULL`
      )
      .all<{ ms: number }>(),
    db
      .prepare(
        `SELECT type, COALESCE(NULLIF(channel,''),'vip') AS channel,
                COUNT(*) AS jobs,
                COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END),0) AS succeeded,
                COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END),0) AS failed,
                COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END),0) AS cancelled
           FROM jobs WHERE created_at >= ${since} AND created_at < ${until}
          GROUP BY type, channel ORDER BY jobs DESC`
      )
      .all<{ type: string; channel: string; jobs: number; succeeded: number; failed: number; cancelled: number }>(),
    db
      .prepare(
        `SELECT COALESCE(NULLIF(TRIM(error),''),'(无错误信息)') AS error, COUNT(*) AS count
           FROM jobs WHERE status = 'failed' AND created_at >= ${since} AND created_at < ${until}
          GROUP BY error ORDER BY count DESC LIMIT 8`
      )
      .all<{ error: string; count: number }>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd),0) AS total_usd FROM job_usage WHERE created_at >= ${since30} AND created_at < ${until}`
      )
      .first<{ total_usd: number }>(),
  ])

  const snap = snapshot ?? {}
  const funnelRaw = funnelRow ?? {}
  const qualityRaw = qualityJobs ?? {}
  const usage = usageRow ?? {}

  // ---------- 趋势序列 ----------
  const points = new Map<string, DashboardSeriesPoint>()
  for (const d of lastDays(days, end)) points.set(d, emptyPoint(d))
  const patch = <T extends { day: string }>(rows: T[], apply: (p: DashboardSeriesPoint, row: T) => void) => {
    for (const row of rows) {
      const p = points.get(String(row.day))
      if (p) apply(p, row)
    }
  }
  patch(seriesNewUsers.results, (p, r) => (p.new_users = n(r.n)))
  patch(seriesActive.results, (p, r) => (p.active_users = n(r.n)))
  patch(seriesJobUsers.results, (p, r) => (p.active_job_users = n(r.n)))
  patch(seriesJobs.results, (p, r) => {
    p.jobs = n(r.jobs)
    p.succeeded = n(r.succeeded)
    p.failed = n(r.failed)
  })
  patch(seriesRevenue.results, (p, r) => {
    p.revenue_minor = n(r.revenue_minor)
    p.paid_users = n(r.paid_users)
  })
  patch(seriesEvents.results, (p, r) => {
    p.publishes = n(r.publishes)
    p.checkout_starts = n(r.checkout_starts)
  })
  const series = [...points.values()]

  // ---------- 订阅 / MRR ----------
  const planMap = new Map(SUBSCRIPTION_PLANS.map((p) => [p.id, p]))
  const activeByPlan = new Map<string, number>()
  let activeSubscriptions = 0
  for (const row of subscriptionRows.results) {
    if (row.status !== 'active' && row.status !== 'trialing') continue
    activeSubscriptions += n(row.n)
    activeByPlan.set(row.catalog_id, (activeByPlan.get(row.catalog_id) ?? 0) + n(row.n))
  }
  const subscriptionPlans = SUBSCRIPTION_PLANS.map((plan) => {
    const count = activeByPlan.get(plan.id) ?? 0
    return { catalog_id: plan.id, name: plan.name, count, mrr_minor: count * plan.priceMinor }
  })
  const mrrMinor = subscriptionPlans.reduce((s, p) => s + p.mrr_minor, 0)

  const paidOrders = n(snap.paid_orders)
  const refundedOrders = n(snap.refunded_orders)
  const payingUsers = n(snap.paying_users)
  const mau = n(snap.mau)
  const revenueTotalMinor = n(snap.revenue_total_minor)
  const revenue30dMinor = n(snap.revenue_30d_minor)
  const purchasedCreditsTotal = n(snap.purchased_credits_total)
  const consumedCredits30d = n(snap.consumed_credits_30d)
  const cost30Usd = n(cost30Row?.total_usd)

  // ---------- 激活 / TTV ----------
  const ttvHours: number[] = []
  let activated24h = 0
  let activated7d = 0
  for (const row of activationRows.results) {
    const created = sqliteUtcMs(row.created_at)
    const first = sqliteUtcMs(row.first_success)
    if (created === null || first === null || first < created) continue
    const hours = (first - created) / 3_600_000
    ttvHours.push(hours)
    if (hours <= 24) activated24h += 1
    if (hours <= 168) activated7d += 1
  }

  // ---------- 首购时延 ----------
  const firstPurchaseDays: number[] = []
  for (const row of firstPurchaseRows.results) {
    const created = sqliteUtcMs(row.created_at)
    const paid = sqliteUtcMs(row.first_paid)
    if (created === null || paid === null || paid < created) continue
    firstPurchaseDays.push((paid - created) / 86_400_000)
  }

  // ---------- 留存:按周合并日 cohort ----------
  const weeks = new Map<string, { size: number; d1: number; d3: number; d7: number; d14: number; d30: number }>()
  for (const row of retentionRows.results) {
    const week = mondayOf(row.signup_day)
    const cur = weeks.get(week) ?? { size: 0, d1: 0, d3: 0, d7: 0, d14: 0, d30: 0 }
    cur.size += n(row.size)
    cur.d1 += n(row.d1)
    cur.d3 += n(row.d3)
    cur.d7 += n(row.d7)
    cur.d14 += n(row.d14)
    cur.d30 += n(row.d30)
    weeks.set(week, cur)
  }
  const todayStr = today()
  const retention: DashboardRetentionRow[] = [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([cohort, v]) => {
      const weekEnd = addDays(cohort, 6)
      const matured = (daysLater: number) => addDays(weekEnd, daysLater) <= todayStr
      const pct = (count: number, daysLater: number) =>
        matured(daysLater) && v.size > 0 ? count / v.size : null
      return {
        cohort,
        size: v.size,
        d1: pct(v.d1, 1),
        d3: pct(v.d3, 3),
        d7: pct(v.d7, 7),
        d14: pct(v.d14, 14),
        d30: pct(v.d30, 30),
      }
    })

  // ---------- 质量 ----------
  const runMs = runRows.results.map((r) => n(r.run_ms)).filter((v) => v > 0)
  const queueMs = queueRows.results.map((r) => n(r.ms)).filter((v) => v >= 0)
  const qualitySucceeded = n(qualityRaw.succeeded)
  const qualityCost = n(usage.total_usd)

  // ---------- 组装 ----------
  return {
    generated_at: new Date().toISOString(),
    days,
    end,
    timezone: 'UTC+8',
    overview: {
      users_total: n(snap.users_total),
      users_verified: n(snap.users_verified),
      new_users_today: n(snap.new_users_today),
      new_users_7d: n(snap.new_users_7d),
      projects_total: n(snap.projects_total),
      projects_published: n(snap.projects_published),
      jobs_total: n(snap.jobs_total),
      jobs_succeeded: n(snap.jobs_succeeded),
      jobs_failed: n(snap.jobs_failed),
      jobs_cancelled: n(snap.jobs_cancelled),
      jobs_today: n(snap.jobs_today),
      jobs_7d: n(snap.jobs_7d),
      dau: n(snap.dau),
      wau: n(snap.wau),
      mau,
      dau_jobs: n(snap.dau_jobs),
      wau_jobs: n(snap.wau_jobs),
      mau_jobs: n(snap.mau_jobs),
      stickiness: ratio(n(snap.dau), mau),
      paid_users_total: payingUsers,
      conversion_rate: ratio(payingUsers, n(snap.users_total)),
      revenue_total_minor: revenueTotalMinor,
      revenue_30d_minor: revenue30dMinor,
      active_subscriptions: activeSubscriptions,
      mrr_minor: mrrMinor,
      cost_30d_usd: cost30Usd,
      cost_per_success_30d_usd: (() => {
        const success30 = n(snap.jobs_succeeded_30d)
        return success30 > 0 ? cost30Usd / success30 : null
      })(),
    },
    series,
    funnel: {
      registered: n(funnelRaw.registered),
      verified: n(funnelRaw.verified),
      has_project: n(funnelRaw.has_project),
      has_job: n(funnelRaw.has_job),
      has_succeeded: n(funnelRaw.has_succeeded),
      has_version: n(funnelRaw.has_version),
      has_published: n(funnelRaw.has_published),
      has_paid: n(funnelRaw.has_paid),
    },
    activation: {
      users: activationRows.results.length,
      activated: ttvHours.length,
      activated_24h: activated24h,
      activated_7d: activated7d,
      median_ttv_hours: percentile(ttvHours, 50),
      p90_ttv_hours: percentile(ttvHours, 90),
    },
    retention,
    monetization: {
      paying_users: payingUsers,
      paid_users_30d: n(snap.paid_users_30d),
      conversion_rate: ratio(payingUsers, n(snap.users_total)),
      paying_penetration_30d: ratio(n(snap.paid_users_30d), mau),
      revenue_30d_minor: revenue30dMinor,
      revenue_total_minor: revenueTotalMinor,
      arppu_minor: payingUsers > 0 ? revenueTotalMinor / payingUsers : null,
      arpu_30d_minor: mau > 0 ? revenue30dMinor / mau : null,
      refunded_orders: refundedOrders,
      refund_rate: paidOrders + refundedOrders > 0 ? refundedOrders / (paidOrders + refundedOrders) : null,
      first_purchase_median_days: percentile(firstPurchaseDays, 50),
      active_subscriptions: activeSubscriptions,
      mrr_minor: mrrMinor,
      subscription_plans: subscriptionPlans,
      consumed_credits_30d: consumedCredits30d,
      purchased_credits_30d: n(snap.purchased_credits_30d),
      users_with_usage: n(snap.users_with_usage),
      zero_balance_users: n(snap.zero_balance_users),
      exhausted_users: n(snap.exhausted_users),
      exhausted_paid_users: n(snap.exhausted_paid_users),
      revenue_per_credit_minor:
        purchasedCreditsTotal > 0 ? revenueTotalMinor / purchasedCreditsTotal : null,
      consumed_revenue_30d_minor:
        purchasedCreditsTotal > 0
          ? roundMinor((consumedCredits30d * revenueTotalMinor) / purchasedCreditsTotal)
          : 0,
      cash_margin_30d_usd: revenue30dMinor / 100 - cost30Usd,
      consumed_margin_30d_usd:
        (purchasedCreditsTotal > 0
          ? (consumedCredits30d * revenueTotalMinor) / purchasedCreditsTotal / 100
          : 0) - cost30Usd,
    },
    quality: {
      jobs: n(qualityRaw.jobs),
      succeeded: qualitySucceeded,
      failed: n(qualityRaw.failed),
      cancelled: n(qualityRaw.cancelled),
      success_rate: ratio(qualitySucceeded, n(qualityRaw.jobs)),
      avg_run_ms: avg(runMs),
      p50_run_ms: percentile(runMs, 50),
      p90_run_ms: percentile(runMs, 90),
      avg_queue_ms: avg(queueMs),
      p50_queue_ms: percentile(queueMs, 50),
      p90_queue_ms: percentile(queueMs, 90),
      by_type: byTypeRows.results.map((r) => ({
        type: String(r.type),
        channel: String(r.channel),
        jobs: n(r.jobs),
        succeeded: n(r.succeeded),
        failed: n(r.failed),
        cancelled: n(r.cancelled),
      })),
      top_errors: errorRows.results.map((r) => ({ error: String(r.error), count: n(r.count) })),
      tokens: {
        input: n(usage.input_tokens),
        output: n(usage.output_tokens),
        cache_read: n(usage.cache_read),
        cache_write: n(usage.cache_write),
      },
      cost: {
        llm_usd: n(usage.llm_usd),
        gcp_usd: n(usage.gcp_usd),
        total_usd: qualityCost,
        per_success_usd: qualitySucceeded > 0 ? qualityCost / qualitySucceeded : null,
      },
    },
  }
}

/** 供后台路由复用:把「余额为 0 且用过积分」的定义与注册赠送额度对齐 */
export const EXHAUSTED_AFTER_CREDITS = SIGNUP_CREDITS
