import type { Env } from '../types'
import { ACTIVE_STATUS_SQL } from './jobHelpers'
import { markJobFailed } from './commit'

export type JobType = 'generate' | 'chat'
/** cancelled = 用户手动停止(终态,不扣积分);由 POST /api/projects/:id/cancel 落定,见 src/lib/commit.ts */
export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** agent 心跳间隔 20s;超过这么久没心跳即认为执行体失联(Cold start + 首跳留足余量) */
const HEARTBEAT_TIMEOUT_SECONDS = 180
/** 任务总龄上限:略大于 Cloud Run --timeout(3600s),平台强杀(实例消失、无 fail 回调)后靠巡检兜底判死 */
const JOB_MAX_SECONDS = 3700
/**
 * 免费通道总龄上限:免费执行体 --timeout 3600s + 进程内排队,一个任务从建单到收尾
 * 可能远超 VIP 的 3600s。阈值取 3700s(略大于 3600s),仍由心跳(180s)先兜住真正失联的执行体。
 */
const FREE_JOB_MAX_SECONDS = 3700

/** 创建任务。同一项目同时只允许一个未完成任务:单条条件 INSERT 原子判定,无 check-then-insert 竞态 */
export async function createJob(
  db: Env['DB'],
  projectId: string,
  userId: string,
  type: JobType,
  payload: Record<string, string>,
  /** '' | free | vip;派发时写入,巡检据此放宽免费通道的总龄上限 */
  channel = ''
): Promise<string | null> {
  const id = crypto.randomUUID()
  const insert = (withChannel: boolean) =>
    db
      .prepare(
        `INSERT INTO jobs (id, project_id, user_id, type, payload${withChannel ? ', channel' : ''}, started_at)
         SELECT ?, ?, ?, ?, ?${withChannel ? ', ?' : ''}, datetime('now') WHERE NOT EXISTS (
           SELECT 1 FROM jobs WHERE project_id = ? AND ${ACTIVE_STATUS_SQL}
         )`
      )
      .bind(
        ...(withChannel
          ? [id, projectId, userId, type, JSON.stringify(payload), channel, projectId]
          : [id, projectId, userId, type, JSON.stringify(payload), projectId])
      )
      .run()

  let result: D1Result
  try {
    result = await insert(true)
  } catch (err) {
    // 增量迁移没跑时 channel 列不存在。降级成旧 INSERT,不让「少一列」把整个生成链路打挂;
    // 通道信息丢失只会让该任务按旧阈值巡检,功能仍可用。
    if (!/no such column/i.test(err instanceof Error ? err.message : String(err))) throw err
    console.warn('[jobs] channel 列不存在,退回旧 INSERT(请执行 schema.migrate-model-channel.sql)')
    result = await insert(false)
  }
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

  // 总龄上限按通道区分:free 的任务可能在免费执行体的进程内排队,不能按 VIP 的 3700s 判死。
  // channel 列来自增量迁移:没跑迁移时退回旧的单阈值查询,巡检不能因为少一列就整体失效。
  const timedOut = await env.DB
    .prepare(
      `SELECT id FROM jobs WHERE ${ACTIVE_STATUS_SQL} AND (
         (channel = 'free' AND created_at < datetime('now', '-${FREE_JOB_MAX_SECONDS} seconds'))
         OR (channel <> 'free' AND created_at < datetime('now', '-${JOB_MAX_SECONDS} seconds'))
       )`
    )
    .all<{ id: string }>()
    .catch(async () =>
      env.DB
        .prepare(`SELECT id FROM jobs WHERE ${ACTIVE_STATUS_SQL} AND created_at < datetime('now', '-${JOB_MAX_SECONDS} seconds')`)
        .all<{ id: string }>()
    )
  for (const row of timedOut.results) await markJobFailed(env, row.id, '任务超时未完成,请重新发起')

  // 兜底:追加要求的投递队列只活到任务落定(落定路径已清),这里扫掉异常退出留下的孤儿行
  await env.DB
    .prepare(`DELETE FROM job_messages WHERE job_id NOT IN (SELECT id FROM jobs WHERE ${ACTIVE_STATUS_SQL})`)
    .run()
    .catch(() => {})
}