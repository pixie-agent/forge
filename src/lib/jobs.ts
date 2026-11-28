import type { Env } from '../types'
import { ACTIVE_STATUS_SQL, RUNNABLE_STATUS_SQL } from './jobHelpers'
import { markJobFailed } from './commit'
import { deleteCheckpoint } from './checkpoints'
import { langOfPayload, srv } from './i18n'

export type JobType = 'generate' | 'chat'
/** cancelled = 用户手动停止(终态,不扣积分);由 POST /api/projects/:id/cancel 落定,见 src/lib/commit.ts */
/** waiting_human = 人门节点暂停、等用户作答(见 docs/FORGE2.md §17.14);不是终态,仍占项目锁 */
export type JobStatus = 'pending' | 'running' | 'waiting_human' | 'succeeded' | 'failed' | 'cancelled'

/** Agent 接活上限:Cloud Run 冷启动/请求排队应在此时间内完成,首个心跳会把 pending 转为 running。 */
const AGENT_START_TIMEOUT_SECONDS = 45
/** agent 心跳间隔 20s;超过这么久没心跳即认为执行体失联(短暂网络抖动留足余量) */
const HEARTBEAT_TIMEOUT_SECONDS = 180
/** 任务总龄上限:略大于 Cloud Run --timeout(3600s),平台强杀(实例消失、无 fail 回调)后靠巡检兜底判死 */
const JOB_MAX_SECONDS = 3700
/**
 * 免费通道总龄上限:免费执行体 --timeout 3600s + 进程内排队,一个任务从建单到收尾
 * 可能远超 VIP 的 3600s。阈值取 3700s(略大于 3600s),仍由心跳(180s)先兜住真正失联的执行体。
 */
const FREE_JOB_MAX_SECONDS = 3700
/** 人门节点暂停后用户作答的等待上限:超时判失败(见 docs/FORGE2.md §17.14),避免项目锁被永久占用 */
const WAIT_HUMAN_MAX_SECONDS = 24 * 3600

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
        `INSERT INTO jobs (id, project_id, user_id, type, payload${withChannel ? ', channel, dispatched_at' : ''}, started_at)
         SELECT ?, ?, ?, ?, ?${withChannel ? ", ?, datetime('now')" : ''}, datetime('now') WHERE NOT EXISTS (
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
 * 任务总龄的计时起点:最近一次派发时间(dispatched_at),没跑迁移时退回 created_at。
 * 人门续跑会刷新 dispatched_at,等用户作答的那段时间不计入总龄(见 schema.migrate-dispatched-at.sql)。
 */
const AGE_FROM = 'COALESCE(dispatched_at, created_at)'
const AGE_FROM_PLAIN = 'created_at'

export async function settleJobIfStale(env: Env, jobId: string): Promise<boolean> {
  const row = await settleRow(env, jobId, AGE_FROM).catch((err) => {
    if (!/no such column/i.test(err instanceof Error ? err.message : String(err))) throw err
    return settleRow(env, jobId, AGE_FROM_PLAIN)
  })
  if (!row) return false
  const key = row.timed_out ? 'job.timeout' : row.status === 'pending' ? 'job.notStarted' : 'job.lost'
  return markJobFailed(env, jobId, srv(langOfPayload(row.payload), key))
}

function settleRow(env: Env, jobId: string, ageFrom: string) {
  return env.DB
    .prepare(
      `SELECT status, payload,
         CASE WHEN ${ageFrom} < datetime('now', '-${JOB_MAX_SECONDS} seconds') THEN 1 ELSE 0 END AS timed_out
       FROM jobs WHERE id = ? AND ${RUNNABLE_STATUS_SQL} AND (
         (status = 'pending' AND created_at < datetime('now', '-${AGENT_START_TIMEOUT_SECONDS} seconds'))
         OR (status = 'running' AND updated_at < datetime('now', '-${HEARTBEAT_TIMEOUT_SECONDS} seconds'))
         OR ${ageFrom} < datetime('now', '-${JOB_MAX_SECONDS} seconds')
       )`
    )
    .bind(jobId)
    .first<{ status: 'pending' | 'running'; payload: string | null; timed_out: number }>()
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
  // 从未收到首个心跳:通常是地址/密钥/入口配置错误。比“执行中失联”更早暴露。
  const unstarted = await env.DB
    .prepare(
      `SELECT id, payload FROM jobs
       WHERE status = 'pending' AND created_at < datetime('now', '-${AGENT_START_TIMEOUT_SECONDS} seconds')`
    )
    .all<{ id: string; payload: string | null }>()
  for (const row of unstarted.results) await markJobFailed(env, row.id, srv(langOfPayload(row.payload), 'job.notStarted'))

  const stale = await env.DB
    .prepare(`SELECT id, payload FROM jobs WHERE status = 'running' AND updated_at < datetime('now', '-${HEARTBEAT_TIMEOUT_SECONDS} seconds')`)
    .all<{ id: string; payload: string | null }>()
  for (const row of stale.results) await markJobFailed(env, row.id, srv(langOfPayload(row.payload), 'job.lost'))

  // 总龄上限按通道区分:free 的任务可能在免费执行体的进程内排队,不能按 VIP 的 3700s 判死。
  // 起点用最近一次派发时间(人门等待不计入);channel / dispatched_at 列来自增量迁移:
  // 没跑迁移时退回旧的单阈值查询,巡检不能因为少一列就整体失效。
  const timedOut = await env.DB
    .prepare(
      `SELECT id, payload FROM jobs WHERE ${RUNNABLE_STATUS_SQL} AND (
         (channel = 'free' AND ${AGE_FROM} < datetime('now', '-${FREE_JOB_MAX_SECONDS} seconds'))
         OR (channel <> 'free' AND ${AGE_FROM} < datetime('now', '-${JOB_MAX_SECONDS} seconds'))
       )`
    )
    .all<{ id: string; payload: string | null }>()
    .catch(async () =>
      env.DB
        .prepare(`SELECT id, payload FROM jobs WHERE ${RUNNABLE_STATUS_SQL} AND ${AGE_FROM_PLAIN} < datetime('now', '-${JOB_MAX_SECONDS} seconds')`)
        .all<{ id: string; payload: string | null }>()
    )
  for (const row of timedOut.results) await markJobFailed(env, row.id, srv(langOfPayload(row.payload), 'job.timeout'))

  // 人门等待超时:用户 24h 未作答,判失败并清恢复对象(见 docs/FORGE2.md §17.14)。
  // 断点保留(失败卡片仍可「从断点继续」);恢复对象由 markJobFailed 一并删除。
  const waitingExpired = await env.DB
    .prepare(`SELECT id, payload FROM jobs WHERE status = 'waiting_human' AND updated_at < datetime('now', '-${WAIT_HUMAN_MAX_SECONDS} seconds')`)
    .all<{ id: string; payload: string | null }>()
  for (const row of waitingExpired.results) await markJobFailed(env, row.id, srv(langOfPayload(row.payload), 'job.waitTimeout'))

  // 兜底:追加要求的投递队列只活到任务落定(落定路径已清),这里扫掉异常退出留下的孤儿行
  await env.DB
    .prepare(`DELETE FROM job_messages WHERE job_id NOT IN (SELECT id FROM jobs WHERE ${ACTIVE_STATUS_SQL})`)
    .run()
    .catch(() => {})

  // 断点快照保留 7 天:过期后删 R2 对象并清指针。成功交付的快照在 commit 里已删,这里只会扫到
  // 失败/停止任务。checkpoint_key 列来自增量迁移 —— 没跑迁移时查询失败,巡检整体不受影响。
  const expired = await env.DB
    .prepare(
      `SELECT id, project_id FROM jobs
       WHERE checkpoint_key IS NOT NULL AND checkpoint_at < datetime('now', '-7 days')`
    )
    .all<{ id: string; project_id: string }>()
    .catch(() => null)
  for (const row of expired?.results ?? []) {
    await deleteCheckpoint(env, row.project_id, row.id)
    await env.DB
      .prepare('UPDATE jobs SET checkpoint_key = NULL, checkpoint_files = NULL, checkpoint_bytes = NULL WHERE id = ?')
      .bind(row.id)
      .run()
      .catch(() => {})
  }
}