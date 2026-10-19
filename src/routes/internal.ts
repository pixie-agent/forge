import { Hono } from 'hono'
import type { Env } from '../types'
import { commitJob, failJobWith } from '../lib/commit'

/**
 * 内部回调接口:供 Cloud Run 的 agent service 上报执行进度与最终结果。用共享密钥(X-Agent-Secret)保护,
 * 不挂用户鉴权中间件、不读 cookie。进度只做字段级更新;终态由 commit / fail 落定(幂等)。
 */
const app = new Hono<{ Bindings: Env }>()

app.use('*', async (c, next) => {
  if (!c.env.AGENT_SECRET || c.req.header('X-Agent-Secret') !== c.env.AGENT_SECRET) {
    return c.json({ error: '未授权' }, 401)
  }
  await next()
})

interface ProgressBody {
  stage?: string
  progress?: string
  plan?: unknown
  /** agent 最近写入的源文件(前端实时看代码) */
  filePreview?: { path?: unknown; content?: unknown }
  heartbeat?: boolean
}

app.post('/jobs/:id/progress', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<ProgressBody>().catch(() => ({}) as ProgressBody)

  const sets: string[] = []
  const binds: unknown[] = []
  if (body.stage === 'planning' || body.stage === 'coding' || body.stage === 'building') {
    sets.push('stage = ?')
    binds.push(body.stage)
  }
  if (typeof body.progress === 'string' && body.progress.trim()) {
    sets.push('progress = ?')
    binds.push(body.progress.slice(0, 300))
  }
  if (body.plan !== undefined) {
    sets.push('plan_json = ?')
    binds.push(JSON.stringify(body.plan))
  }
  if (body.filePreview && typeof body.filePreview.path === 'string' && typeof body.filePreview.content === 'string') {
    sets.push('files_preview = ?')
    binds.push(JSON.stringify({ path: body.filePreview.path, content: body.filePreview.content.slice(0, 20000) }))
  }
  // 纯心跳不携带任何字段:仅触碰 updated_at,cron 据此判断执行体存活
  if (!sets.length && !body.heartbeat) return c.json({ ok: true, changed: 0 })

  sets.push("updated_at = datetime('now')")
  // 只在任务仍活动时更新:终态(成功/失败)后到达的迟到回调不复活任务
  const res = await c.env.DB.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ? AND status IN ('pending','running')`)
    .bind(...binds, id)
    .run()
  return c.json({ ok: true, changed: res.meta.changes })
})

/**
 * 流式日志追加:agent 把 pi 的 thinking/正文/工具调用增量发来,原子追加到 jobs.agent_log。
 * 用 `substr(x || ?, -N)` 保留尾部,无需读改写(并发安全);只在任务仍活动时写入。
 */
const AGENT_LOG_MAX = 20_000
app.post('/jobs/:id/log', async (c) => {
  const body = await c.req.json<{ chunk?: unknown }>().catch(() => ({}) as { chunk?: unknown })
  const chunk = typeof body.chunk === 'string' ? body.chunk : ''
  if (!chunk) return c.json({ ok: true, changed: 0 })
  const res = await c.env.DB.prepare(
    `UPDATE jobs SET agent_log = substr(COALESCE(agent_log, '') || ?, -${AGENT_LOG_MAX}), updated_at = datetime('now')
     WHERE id = ? AND status IN ('pending','running')`
  )
    .bind(chunk, c.req.param('id'))
    .run()
  return c.json({ ok: true, changed: res.meta.changes })
})

/**
 * 任务状态查询(agent 每 5s 巡检一次),一次请求同时承担两件事:
 * - **取消**:协作式取消——Worker 无法反向杀掉 Cloud Run 的在途请求,只能由 agent 自己查、自己 abort。
 * - **追加要求投递**(见 docs/FORGE2.md §5.2):生成过程中用户补充的话/图,先落进 job_messages,
 *   在这里下发并标记 consumed_at。标记而非删除:万一响应在传输中丢了,内容仍留在对话记录里;
 *   队列行(含附件 base64)由任务落定时的 clearJobMessages 整批清掉。
 * 只回 status / cancelled / messages,不碰任何其它字段。
 */
app.get('/jobs/:id/state', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB
    .prepare('SELECT status FROM jobs WHERE id = ?')
    .bind(id)
    .first<{ status: string }>()

  const { results } = await c.env.DB
    .prepare('SELECT id, content, attachments FROM job_messages WHERE job_id = ? AND consumed_at IS NULL ORDER BY created_at, rowid LIMIT 5')
    .bind(id)
    .all<{ id: string; content: string; attachments: string | null }>()
  if (results.length) {
    await c.env.DB
      .prepare(`UPDATE job_messages SET consumed_at = datetime('now') WHERE id IN (${results.map(() => '?').join(',')})`)
      .bind(...results.map((r) => r.id))
      .run()
      .catch(() => {})
  }

  return c.json({
    status: row?.status ?? null,
    cancelled: row?.status === 'cancelled',
    messages: results.map((r) => ({
      id: r.id,
      content: r.content,
      attachments: r.attachments ? (JSON.parse(r.attachments) as unknown[]) : [],
    })),
  })
})

app.post('/jobs/:id/commit', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  try {
    const result = await commitJob(c.env, c.req.param('id'), body)
    return c.json(result)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : '提交失败' }, 400)
  }
})

app.post('/jobs/:id/fail', async (c) => {
  const body = await c.req.json<{ error?: string }>().catch(() => ({}) as { error?: string })
  await failJobWith(c.env, c.req.param('id'), String(body.error ?? '执行失败'))
  return c.json({ ok: true })
})

export const internalRoutes = app