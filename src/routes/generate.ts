import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv, ProjectRow } from '../types'
import { requireUser } from '../lib/auth'
import { assertCredits, activeJobSnapshot, lastFailedJobSnapshot, insertMessage, ACTIVE_STATUS_SQL } from '../lib/jobHelpers'
import { dispatchAgent, type FileMap } from '../lib/agent'
import { attachmentMarkdown, parseAttachments, SEND_LIMITS, STEER_LIMITS, type AgentAttachment } from '../lib/attachments'
import { DRAFT_VERSION_NO } from '../lib/artifacts'
import { type JobType, createJob } from '../lib/jobs'
import { cancelJob } from '../lib/commit'

const app = new Hono<AppEnv>()
app.use('*', requireUser)

async function ownedProject(c: Context<AppEnv>, id: string): Promise<ProjectRow | null> {
  return c.env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').bind(id, c.get('user').id).first<ProjectRow>()
}

/** 取指定正式版本的源码树 */
async function srcAtVersion(db: D1Database, projectId: string, versionNo: number): Promise<FileMap | undefined> {
  if (versionNo < 1) return undefined
  const row = await db
    .prepare('SELECT src_json FROM versions WHERE project_id = ? AND version_no = ?')
    .bind(projectId, versionNo)
    .first<{ src_json: string }>()
  if (!row) return undefined
  try {
    return JSON.parse(row.src_json) as FileMap
  } catch {
    return undefined
  }
}

/** 当前工作内容:优先草稿(version_no=0),否则当前生效版本。chat 以此为改动基线,保证在草稿上继续改 */
async function workingSrc(db: D1Database, projectId: string, currentVersion: number): Promise<FileMap | undefined> {
  const draft = await db
    .prepare('SELECT src_json FROM versions WHERE project_id = ? AND version_no = ?')
    .bind(projectId, DRAFT_VERSION_NO)
    .first<{ src_json: string }>()
  if (draft) {
    try {
      return JSON.parse(draft.src_json) as FileMap
    } catch {
      // 草稿损坏则回退到当前生效版本
    }
  }
  return srcAtVersion(db, projectId, currentVersion)
}

/** 最近若干轮对话(供 agent 理解上下文,实现连续对话);去掉末尾这条本次刚写入的用户消息,避免重复 */
async function recentHistory(db: D1Database, projectId: string, limit = 8): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const { results } = await db
    .prepare('SELECT role, content FROM messages WHERE project_id = ? ORDER BY rowid DESC LIMIT ?')
    .bind(projectId, limit)
    .all<{ role: 'user' | 'assistant'; content: string }>()
  const rows = results.reverse()
  if (rows.length && rows[rows.length - 1].role === 'user') rows.pop()
  return rows.map((r) => ({ role: r.role, content: r.content.slice(0, 1500) }))
}

/**
 * 建任务 + 落用户消息 + 派发到 Cloud Run agent,返回 {jobId} 或 409。
 * 派发不等待结果:agent 执行期间通过 /internal 回调写进度,跑完通过 /internal commit 落定结果。
 * Cloudflare 对超长出站请求会掐断(524),但 Cloud Run 只要 handler 未返回就继续跑;交付以 commit 回调为准。
 * 派发本身失败由 cron 心跳兜底判死。补偿删除:用户消息插入失败时删掉刚建的任务再抛错。
 */
async function launchJob(
  c: Context<AppEnv>,
  project: ProjectRow,
  type: JobType,
  payload: Record<string, string>,
  userText: string,
  attachments?: AgentAttachment[]
) {
  const jobId = await createJob(c.env.DB, project.id, c.get('user').id, type, payload)
  if (!jobId) return c.json({ error: '该项目已有生成任务在进行中,请稍候' }, 409)
  try {
    // 附件字节只走这次 dispatch;消息里补一行清单,刷新后仍能看到当时附了什么
    await insertMessage(c.env.DB, project.id, 'user', userText + attachmentMarkdown(attachments))
  } catch (err) {
    await c.env.DB.prepare(`DELETE FROM jobs WHERE id = ? AND status = 'pending'`).bind(jobId).run().catch(() => {})
    throw err
  }

  const dispatch = async () => {
    const currentFiles = type === 'chat' ? await workingSrc(c.env.DB, project.id, project.current_version) : undefined
    const history = type === 'chat' ? await recentHistory(c.env.DB, project.id) : undefined
    await dispatchAgent(c.env, {
      jobId,
      projectId: project.id,
      type,
      idea: payload.idea,
      message: payload.message,
      note: payload.note,
      currentFiles,
      history,
      attachments: attachments?.length ? attachments : undefined,
    })
  }
  // 不 await:agent 长跑期间连接可能被掐断(524);结果经 commit 回调交付
  c.executionCtx.waitUntil(dispatch().catch((err) => console.error(`[dispatch] ${jobId.slice(0, 8)} ${err instanceof Error ? err.message : String(err)}`)))
  return c.json({ jobId })
}

/**
 * 生成过程中追加要求(steering,见 docs/FORGE2.md §5.2)。
 * 两件事一起做:① 立刻落一条 user 消息进对话记录(用户马上能看到,顺序也对);
 *              ② 投进 job_messages 队列,等 agent 每 5s 的巡检取走并交给 pi 的 session.steer()。
 * 只对活动任务有效 —— 任务已结束就返回 409,让前端走正常的"直接发送"。
 */
app.post('/:id/steer', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)

  const body = await c.req
    .json<{ jobId?: string; message?: string; attachments?: unknown }>()
    .catch(() => ({}) as { jobId?: string; message?: string; attachments?: unknown })
  const message = String(body.message ?? '').trim()
  const parsed = parseAttachments(body.attachments, STEER_LIMITS)
  if (parsed.error) return c.json({ error: parsed.error }, 400)
  const attachments = parsed.attachments ?? []
  if (!message && !attachments.length) return c.json({ error: '内容不能为空' }, 400)

  const job = await c.env.DB
    .prepare(`SELECT id FROM jobs WHERE id = ? AND project_id = ? AND ${ACTIVE_STATUS_SQL}`)
    .bind(String(body.jobId ?? ''), project.id)
    .first<{ id: string }>()
  if (!job) return c.json({ error: '任务已结束,请直接发送' }, 409)

  await insertMessage(c.env.DB, project.id, 'user', message + attachmentMarkdown(attachments))
  await c.env.DB
    .prepare('INSERT INTO job_messages (id, job_id, content, attachments) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), job.id, message, attachments.length ? JSON.stringify(attachments) : null)
    .run()
  return c.json({ ok: true })
})

/** 首次生成(或按想法重新生成) */
app.post('/:id/generate', async (c) => {
  const user = c.get('user')
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)

  const body = await c.req
    .json<{ idea?: string; note?: string; attachments?: unknown }>()
    .catch(() => ({}) as { idea?: string; note?: string; attachments?: unknown })
  const idea = String(body.idea ?? '').trim()
  if (!idea) return c.json({ error: '想法不能为空' }, 400)
  const note = String(body.note ?? '').trim()
  const parsed = parseAttachments(body.attachments)
  if (parsed.error) return c.json({ error: parsed.error }, 400)
  if (!(await assertCredits(c.env.DB, user.id))) return c.json({ error: '积分不足,无法生成' }, 402)

  return launchJob(c, project, 'generate', note ? { idea, note } : { idea }, idea, parsed.attachments)
})

/** 对话式迭代修改:同样走后台任务,agent 在现有源码树上改并重新构建 */
app.post('/:id/chat', async (c) => {
  const user = c.get('user')
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)

  const body = await c.req
    .json<{ message?: string; attachments?: unknown }>()
    .catch(() => ({}) as { message?: string; attachments?: unknown })
  const message = String(body.message ?? '').trim()
  if (!message) return c.json({ error: '内容不能为空' }, 400)

  const src = await workingSrc(c.env.DB, project.id, project.current_version)
  if (!src) return c.json({ error: '请先生成应用,再进行修改' }, 400)
  const parsed = parseAttachments(body.attachments)
  if (parsed.error) return c.json({ error: parsed.error }, 400)
  if (!(await assertCredits(c.env.DB, user.id))) return c.json({ error: '积分不足,无法生成' }, 402)

  return launchJob(c, project, 'chat', { message }, message, parsed.attachments)
})

/** 断线/刷新恢复:活动任务(接管轮询)+ 最近一次失败任务(还原未完成卡片与半成品预览) */
app.get('/:id/job/active', async (c) => {
  const userId = c.get('user').id
  const projectId = c.req.param('id')
  const [job, resume] = await Promise.all([
    activeJobSnapshot(c.env.DB, projectId, userId),
    lastFailedJobSnapshot(c.env.DB, projectId, userId),
  ])
  return c.json({ job, resume })
})

/**
 * 手动停止当前任务。落定是立即的(置 cancelled → 项目锁当场释放,cron 不必再等心跳超时),
 * 但 Cloud Run 侧的在途执行只能"协作式"停下:Worker 无法反向杀掉那个请求,agent 每几秒查一次
 * /internal/jobs/:id/state,看到 cancelled 就 abort 当前轮次并放弃本轮产物。故本接口不扣积分、
 * 不写版本,已跑出的中间结果一并丢弃。
 */
app.post('/:id/cancel', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)

  const job = await c.env.DB
    .prepare(`SELECT id FROM jobs WHERE project_id = ? AND ${ACTIVE_STATUS_SQL} ORDER BY updated_at DESC LIMIT 1`)
    .bind(project.id)
    .first<{ id: string }>()
  if (!job) return c.json({ error: '当前没有正在执行的任务' }, 409)

  if (!(await cancelJob(c.env, job.id))) return c.json({ error: '任务刚刚已结束,无需停止' }, 409)
  // 落一条 assistant 消息,让对话历史里"用户要求 → 已停止"是完整的一轮,而不是悬空的一句;
  // 这是锦上添花,写失败不该让"已经停下来了"变成 500
  await insertMessage(c.env.DB, project.id, 'assistant', '已停止本次任务(未扣除积分),中间结果未保留。修改要求后可重新发送。').catch(() => {})
  return c.json({ ok: true, jobId: job.id })
})

export const generateRoutes = app