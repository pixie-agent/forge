import type { Env } from '../types'
import { ACTIVE_STATUS_SQL } from './jobHelpers'
import { markJobFailed } from './commit'

export type JobType = 'generate' | 'chat'
export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed'

/** agent 心跳间隔 20s;超过这么久没心跳即认为执行体失联(Cold start + 首跳留足余量) */
const HEARTBEAT_TIMEOUT_SECONDS = 180
/** 任务总龄上限:略大于 Cloud Run --timeout(1800s),平台强杀(实例消失、无 fail 回调)后靠巡检兜底判死 */
const JOB_MAX_SECONDS = 1900

/** 创建任务。同一项目同时只允许一个未完成任务:单条条件 INSERT 原子判定,无 check-then-insert 竞态 */
export async function createJob(
  db: Env['DB'],
  projectId: string,
  userId: string,
  type: JobType,
  payload: Record<string, string>
): Promise<string | null> {
  const id = crypto.randomUUID()
  const result = await db
    .prepare(
      `INSERT INTO jobs (id, project_id, user_id, type, payload, started_at)
       SELECT ?, ?, ?, ?, ?, datetime('now') WHERE NOT EXISTS (
         SELECT 1 FROM jobs WHERE project_id = ? AND ${ACTIVE_STATUS_SQL}
       )`
    )
    .bind(id, projectId, userId, type, JSON.stringify(payload), projectId)
    .run()
  return result.meta.changes ? id : null
}

/**
 * cron 巡检兜底(Forge 2.0)。执行体在 Cloud Run,与 Worker 无长连接,靠 agent 每 20s 一次的
 * 心跳(写 updated_at)判断存活:
 *  - 心跳停摆(执行体死亡 / 网络断 / 回调丢失)→ 判死解锁项目
 *  - 超过总龄上限 → 终极判死
 * 每条都走 markJobFailed 落定,失败会补一条持久的 assistant 提示(用户不再是"什么都没发生")。
 * 迟到的 commit 回调仍可复活已判死的任务交付页面(见 src/lib/commit.ts 的守卫式落定)。
 */
export async function sweepJobs(env: Env): Promise<void> {
  const stale = await env.DB
    .prepare(`SELECT id FROM jobs WHERE ${ACTIVE_STATUS_SQL} AND updated_at < datetime('now', '-${HEARTBEAT_TIMEOUT_SECONDS} seconds')`)
    .all<{ id: string }>()
  for (const row of stale.results) await markJobFailed(env, row.id, '任务执行体失联,请重试')

  const timedOut = await env.DB
    .prepare(`SELECT id FROM jobs WHERE ${ACTIVE_STATUS_SQL} AND created_at < datetime('now', '-${JOB_MAX_SECONDS} seconds')`)
    .all<{ id: string }>()
  for (const row of timedOut.results) await markJobFailed(env, row.id, '任务超时未完成,请重新发起')
}