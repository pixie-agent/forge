/** 与任务相关的公共小工具(供 generate 路由与 jobs 执行体共用) */

/** 未完成任务判定:任务创建互斥与断线恢复共用同一语义 */
export const ACTIVE_STATUS_SQL = "status IN ('pending','running')"

/** 终态判定:SSE 推完即关流、前端停止订阅,统一以此为准(cancelled 也是终态) */
export function isTerminalStatus(status: string): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

export async function insertMessage(
  db: D1Database,
  projectId: string,
  role: 'user' | 'assistant',
  content: string
) {
  await db
    .prepare('INSERT INTO messages (id, project_id, role, content) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), projectId, role, content)
    .run()
}

/**
 * 清掉某任务的「追加要求」投递队列(见 docs/FORGE2.md §5.2)。
 * 队列只是投递通道,内容早已作为 user 消息写进 messages,所以删掉不影响对话记录;
 * 顺带把里面可能带着的附件 base64(最大 1.6MB)一起释放掉——它本来就只该活到任务落定。
 */
export async function clearJobMessages(db: D1Database, jobId: string): Promise<void> {
  await db.prepare('DELETE FROM job_messages WHERE job_id = ?').bind(jobId).run().catch(() => {})
}

const SNAPSHOT_COLUMNS =
  "id, user_id, type, status, stage, progress, files_preview, agent_log, plan_json, error, result_version, started_at, json_extract(payload, '$.idea') AS idea, json_extract(payload, '$.message') AS chat_message"

interface SnapshotRow {
  id: string
  user_id: string
  type: 'generate' | 'chat'
  status: string
  stage: string
  progress: string | null
  files_preview: string | null
  agent_log: string | null
  plan_json: string | null
  error: string | null
  result_version: number | null
  started_at: string | null
  idea: string | null
  chat_message: string | null
}

function snapshotFromRow(row: SnapshotRow) {
  let filesPreview: { path: string; content: string } | null = null
  if (row.files_preview) {
    try {
      filesPreview = JSON.parse(row.files_preview) as { path: string; content: string }
    } catch {
      filesPreview = null
    }
  }
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    files_preview: filesPreview,
    agent_log: row.agent_log,
    idea: row.idea,
    // 本次任务的输入文本(generate 取 idea、chat 取 message),重试时原样重发
    prompt: row.idea ?? row.chat_message ?? null,
    plan: row.plan_json ? (JSON.parse(row.plan_json) as unknown) : null,
    error: row.error,
    version: row.result_version,
    // D1 datetime('now') 是空格分隔的非 ISO 格式,转成 'T' 再解析,避免依赖 V8 的宽松扩展
    elapsed: row.started_at
      ? Math.max(0, Math.floor((Date.now() - Date.parse(row.started_at.replace(' ', 'T') + 'Z')) / 1000))
      : 0,
  }
}

/** 任务状态快照(轮询/SSE 响应体):只暴露前端需要的字段,elapsed 由服务端计算;
 *  传入 userId 时同时校验属主,非属主与不存在一样返回 null */
export async function jobSnapshot(db: D1Database, jobId: string, userId?: string) {
  const row = await db
    .prepare(`SELECT ${SNAPSHOT_COLUMNS} FROM jobs WHERE id = ?`)
    .bind(jobId)
    .first<SnapshotRow>()
  if (!row || (userId !== undefined && row.user_id !== userId)) return null
  return snapshotFromRow(row)
}

/** 项目的活动任务快照(断线/刷新恢复),单查询完成属主校验;无则返回 null */
export async function activeJobSnapshot(db: D1Database, projectId: string, userId: string) {
  const row = await db
    .prepare(
      `SELECT ${SNAPSHOT_COLUMNS} FROM jobs WHERE project_id = ? AND ${ACTIVE_STATUS_SQL}
       AND EXISTS (SELECT 1 FROM projects WHERE projects.id = jobs.project_id AND projects.user_id = ?)
       ORDER BY updated_at DESC LIMIT 1`
    )
    .bind(projectId, userId)
    .first<SnapshotRow>()
  return row ? snapshotFromRow(row) : null
}

/**
 * 可续任务快照:项目最近一次任务若为失败或用户手动停止,返回它(带着 error / 半成品 files_preview /
 * 原始 idea / 断点信息),供前端还原「未完成卡片 + 重试 / 从断点继续」;最近任务已完成或仍在跑则返回 null。
 *
 * 断点列来自增量迁移 schema.migrate-checkpoint.sql:没跑迁移时退回不带断点的旧查询,
 * 只丢失「继续」能力,不影响失败卡片与重试。
 */
export async function lastFailedJobSnapshot(db: D1Database, projectId: string, userId: string) {
  type UnfinishedRow = SnapshotRow & { checkpoint_key?: string | null; checkpoint_files?: number | null }
  const sql = (cols: string) =>
    `SELECT ${cols} FROM jobs WHERE project_id = ?
     AND EXISTS (SELECT 1 FROM projects WHERE projects.id = jobs.project_id AND projects.user_id = ?)
     ORDER BY updated_at DESC LIMIT 1`
  const row = await db
    .prepare(sql(`${SNAPSHOT_COLUMNS}, checkpoint_key, checkpoint_files`))
    .bind(projectId, userId)
    .first<UnfinishedRow>()
    .catch(() => db.prepare(sql(SNAPSHOT_COLUMNS)).bind(projectId, userId).first<UnfinishedRow>())

  if (!row || (row.status !== 'failed' && row.status !== 'cancelled')) return null
  return {
    ...snapshotFromRow(row),
    resumable: Boolean(row.checkpoint_key),
    checkpoint_files: row.checkpoint_files ?? null,
  }
}

export type JobSnapshot = NonNullable<Awaited<ReturnType<typeof jobSnapshot>>>