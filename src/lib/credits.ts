/**
 * 积分:冻结-结算模型。
 *
 * 任务发起时先把积分冻结掉(原子条件扣减),成功即等于收费,失败 / 用户停止时退还。
 *  - 为什么不在成功时才扣:冻结同时是**滥用闸门**。否则用户可以拿 0 积分反复发起注定失败的任务,
 *    而每个失败任务照样烧掉 LLM 与 Cloud Run 的钱(全局并发闸门只有 --max-instances,拦不住这个)。
 *  - 为什么失败要退:「失败不扣积分」是这个产品的既有承诺(前端文案、对话卡片口径都这么写)。
 *
 * 余额仍以 users.credits 为准:所有增减都在一条条件 UPDATE 上完成,并发安全。
 * credit_ledger 是**只追加**的审计流水;极端情况下(扣减成功、写流水之前进程消失)会缺一条流水,
 * 但余额永远是对的 —— 对账以余额为准、流水为证。
 */

/** 每个任务的积分价。机制支持按类型分档,当前都按 1 分 —— 调整只改这一处,调用方无需改动。 */
export const JOB_COST: Record<string, number> = { generate: 1, chat: 1 }

/**
 * 注册赠送 = 能白拿几次生成(1 积分 = 1 次)。
 *
 * 同时是**薅羊毛闸门**:每个假号白拿的额度就是它,按单次成本 $0.06~0.15 算,
 * 5 相当于 $0.3~0.75/号(旧值 20 = $1.2~3.0)。
 *
 * 注意:注册与 Google 首次登录都**显式**把这个值写进 `users.credits`(见 src/routes/auth.ts),
 * 不依赖 `schema.sql` 里的列默认值 —— 已存在的库改不了列默认值(SQLite),
 * 靠 DEFAULT 会让老库上的新用户拿到旧额度,和账本记的对不上。
 * `schema.sql` 里的 `DEFAULT 5` 只是新库的兜底,两边仍保持同值以免读代码时误会。
 */
export const SIGNUP_CREDITS = 5

export function jobCost(type: string): number {
  const n = JOB_COST[type]
  return typeof n === 'number' && n > 0 ? n : 1
}

export interface LedgerEntry {
  userId: string
  delta: number
  reason: LedgerReason
  refType?: string
  refId?: string
  balanceAfter: number
  note?: string
}

export type LedgerReason =
  | 'signup'
  | 'job_hold'
  | 'job_release'
  | 'purchase'
  | 'refund'
  | 'admin_grant'
  | 'expire'

/** 记一笔流水(余额由调用方从 RETURNING 里拿到,避免再查一次造成读数漂移) */
async function insertLedger(db: D1Database, e: LedgerEntry): Promise<void> {
  await db
    .prepare(
      `INSERT INTO credit_ledger (id, user_id, delta, reason, ref_type, ref_id, balance_after, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), e.userId, e.delta, e.reason, e.refType ?? '', e.refId ?? '', e.balanceAfter, e.note ?? '')
    .run()
}

/** 注册 / Google 首次登录的赠送,记一条流水让余额从第一天起就有来源 */
export async function grantSignupCredits(db: D1Database, userId: string, amount: number): Promise<void> {
  await insertLedger(db, { userId, delta: amount, reason: 'signup', balanceAfter: amount, note: '注册赠送' })
}

/**
 * 冻结:原子条件扣减,余额不足返回 false(调用方据此回 402)。
 * 扣减与记账分两条语句,所以流水是「尽力而为」的审计记录,余额才是权威(见文件头注释)。
 */
export async function reserveCredits(db: D1Database, userId: string, jobId: string, amount: number): Promise<boolean> {
  if (amount <= 0) return true
  const row = await db
    .prepare('UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ? RETURNING credits')
    .bind(amount, userId, amount)
    .first<{ credits: number }>()
  if (!row) return false
  await insertLedger(db, {
    userId,
    delta: -amount,
    reason: 'job_hold',
    refType: 'job',
    refId: jobId,
    balanceAfter: row.credits,
    note: '任务冻结',
  })
  return true
}

/**
 * 退还某个任务的冻结积分(任务失败 / 用户停止时调用)。
 * 自己把该退多少查出来,所以调用方只需要 jobId:
 *   1. 账本里没有该任务的冻结行 → 不退还(历史任务、或已经退过),返回 0;
 *   2. 已经有退还行 → 直接返回 0(幂等;唯一索引 idx_ledger_job_once 是最后一道保险)。
 * 调用方的状态迁移本身是原子的(markJobFailed / cancelJob 只在真的迁移成功时返回 true),
 * 所以正常路径下这个方法一个任务只会真正执行一次。
 */
export async function releaseJobCredits(db: D1Database, jobId: string, note = ''): Promise<number> {
  const held = await db
    .prepare(
      `SELECT user_id, delta FROM credit_ledger
       WHERE ref_type = 'job' AND ref_id = ? AND reason = 'job_hold'`
    )
    .bind(jobId)
    .first<{ user_id: string; delta: number }>()
  if (!held) return 0
  const amount = -held.delta
  if (amount <= 0) return 0

  const released = await db
    .prepare(`SELECT 1 AS n FROM credit_ledger WHERE ref_type = 'job' AND ref_id = ? AND reason = 'job_release'`)
    .bind(jobId)
    .first<{ n: number }>()
  if (released) return 0

  const row = await db
    .prepare('UPDATE users SET credits = credits + ? WHERE id = ? RETURNING credits')
    .bind(amount, held.user_id)
    .first<{ credits: number }>()
  if (!row) return 0
  await insertLedger(db, {
    userId: held.user_id,
    delta: amount,
    reason: 'job_release',
    refType: 'job',
    refId: jobId,
    balanceAfter: row.credits,
    note: note || '任务未完成,退还积分',
  })
  return amount
}
