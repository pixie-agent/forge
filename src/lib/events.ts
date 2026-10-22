/**
 * 用户大盘的埋点原语(见 docs/FORGE2.md §22)。
 *
 * 两类数据:
 *   - user_daily_active:一个用户一天一行,DAU/WAU/MAU 与留存都从它算;
 *   - user_events:关键行为流水(注册验证/建项目/建任务/发布/结账/支付/订阅)。
 *
 * 纪律:
 *   - 全部 best-effort —— 埋点写失败只打日志,绝不影响注册、生成、支付等主流程;
 *   - 活跃写入按 UTC+8 切日,并且**最多每 10 分钟一次**(requireUser 再用 cookie 把频次压到每天一次),
 *     不把每个 API 请求都变成一次 D1 写;
 *   - user_events 只记少量高价值动作,不做全量请求日志(存储与写入成本都不划算)。
 */

export const ACTIVITY_COOKIE = 'forge_act'

/** UTC+8 的 YYYY-MM-DD;与 SQL 里的 date(..., '+8 hours') 同一口径 */
export function activityDay(now = Date.now()): string {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function readActivityCookie(cookieHeader: string | undefined): string | null {
  const m = new RegExp(`(?:^|;\\s*)${ACTIVITY_COOKIE}=([^;]+)`).exec(cookieHeader ?? '')
  return m ? m[1] : null
}

export function activityCookie(day: string, secure: boolean): string {
  return `${ACTIVITY_COOKIE}=${day}; Path=/; SameSite=Lax; Max-Age=86400${secure ? '; Secure' : ''}`
}

/**
 * 标记「今天活跃」。节流条件同时覆盖两种情况:
 *   1) 距上次写入不足 10 分钟 —— 不重复写;
 *   2) 已跨 UTC+8 的自然日 —— 即使 10 分钟内也要补当天那一行。
 * 只有真的更新了 users 才写 user_daily_active,避免每请求都尝试 INSERT。
 */
export async function touchActivity(db: D1Database, userId: string): Promise<void> {
  try {
    const res = await db
      .prepare(
        `UPDATE users SET last_active_at = datetime('now')
         WHERE id = ? AND (
           last_active_at IS NULL
           OR last_active_at < datetime('now', '-10 minutes')
           OR date(last_active_at, '+8 hours') < date('now', '+8 hours')
         )`
      )
      .bind(userId)
      .run()
    if (!res.meta.changes) return
    await db
      .prepare('INSERT OR IGNORE INTO user_daily_active (user_id, day) VALUES (?, ?)')
      .bind(userId, activityDay())
      .run()
  } catch (err) {
    // 迁移未执行/临时故障:埋点不能影响正常请求
    console.warn(`[analytics] touchActivity 失败:${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 记一条关键行为。props 必须是可 JSON 序列化的轻量对象。 */
export async function logEvent(
  db: D1Database,
  userId: string,
  name: string,
  props?: Record<string, unknown>
): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO user_events (id, user_id, name, props) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), userId, name.slice(0, 64), JSON.stringify(props ?? {}))
      .run()
  } catch (err) {
    console.warn(`[analytics] logEvent(${name}) 失败:${err instanceof Error ? err.message : String(err)}`)
  }
}
