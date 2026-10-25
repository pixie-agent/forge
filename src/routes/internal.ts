import { Hono } from 'hono'
import type { Env } from '../types'
import { commitJob, failJobWith } from '../lib/commit'
import { putCheckpoint } from '../lib/checkpoints'
import { gcpCostUsd, llmCostUsd, type ModelPrice } from '../lib/pricing'

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
 * 里程碑日志追加:agent 只把关键节点(复查轮开始/结束、交付语言重问、告警)发来,
 * 原子追加到 jobs.agent_log。完整 thinking/工具调用过程只写 Cloud Run stdout,不进 D1。
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
 * 断点快照:agent 每 60s(以及异常收尾时)把当前源码树整份发来,存 R2。
 * 源码本体不进 D1;这里只更新 jobs 上的指针与元信息,供「从断点继续」读取。
 * 刻意不做 active 状态守卫:用户点「停止」时 Worker 会先把任务置 cancelled,agent 的
 * 最后一次快照往往在这之后才到(SIGTERM 式的协作取消),那是我们最需要保留的一份。
 * 只拒绝 succeeded:已交付的任务不需要断点(commit 已把产物写进草稿)。
 */
const CHECKPOINT_MAX_BYTES = 8 * 1024 * 1024
app.post('/jobs/:id/checkpoint', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ source?: unknown }>().catch(() => ({}) as { source?: unknown })
  if (!body.source || typeof body.source !== 'object' || Array.isArray(body.source)) {
    return c.json({ error: '源码树格式不正确' }, 400)
  }
  // 只收 string 值;顺手挡住异常大的快照(正常源码树远小于这个量级)
  const source: Record<string, string> = {}
  let totalChars = 0
  for (const [path, content] of Object.entries(body.source as Record<string, unknown>)) {
    if (typeof content !== 'string') continue
    source[path] = content
    totalChars += content.length
    if (totalChars > CHECKPOINT_MAX_BYTES) return c.json({ error: '源码树过大' }, 413)
  }
  if (!Object.keys(source).length) return c.json({ ok: true, changed: 0 })

  const job = await c.env.DB
    .prepare('SELECT project_id, status FROM jobs WHERE id = ?')
    .bind(id)
    .first<{ project_id: string; status: string }>()
  if (!job) return c.json({ error: '任务不存在' }, 404)
  if (job.status === 'succeeded') return c.json({ ok: true, changed: 0 })

  const meta = await putCheckpoint(c.env, job.project_id, id, source)
  await c.env.DB
    .prepare(
      `UPDATE jobs SET checkpoint_key = ?, checkpoint_files = ?, checkpoint_bytes = ?, checkpoint_at = datetime('now')
       WHERE id = ? AND status <> 'succeeded'`
    )
    .bind(meta.key, meta.files, meta.bytes, id)
    .run()
  return c.json({ ok: true, files: meta.files, bytes: meta.bytes })
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

/**
 * 用量上报:agent 在任务收尾时调用,**成功、失败、用户停止三种终态都会调**。
 * 刻意不做 status 守卫 —— 失败与被停掉的任务同样消耗 token 与实例时间,漏记就算不出真实毛利
 * (这正是这次改造要解决的核心问题:在此之前平台完全不知道一次生成花了多少钱)。
 * 幂等:按 job_id upsert,重放不会重复计。成本由 src/lib/pricing.ts 换算(token 才是留存下来的真相)。
 */
interface UsageBody {
  model?: unknown
  input?: unknown
  output?: unknown
  cacheRead?: unknown
  cacheWrite?: unknown
  turns?: unknown
  runMs?: unknown
}

/** 只接受非负有限数,并给一个上限挡住脏数据把后台统计带偏 */
function toCount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0
  return Math.min(Math.floor(v), 1e10)
}

app.post('/jobs/:id/usage', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<UsageBody>().catch(() => ({}) as UsageBody)
  // model_config_id 是增量迁移加的列:迁移没跑(或回滚到旧 schema)时不能把整个用量回调打挂,
  // 否则连 token 用量都记不下来。查不到列就当作没有配置快照,成本回落到内置价格表。
  const job = await c.env.DB
    .prepare('SELECT user_id, project_id, model_config_id FROM jobs WHERE id = ?')
    .bind(id)
    .first<{ user_id: string; project_id: string; model_config_id: string }>()
    .catch(async () => {
      const row = await c.env.DB
        .prepare('SELECT user_id, project_id FROM jobs WHERE id = ?')
        .bind(id)
        .first<{ user_id: string; project_id: string }>()
      return row ? { ...row, model_config_id: '' } : null
    })
  if (!job) return c.json({ error: '任务不存在' }, 404)

  const model = typeof body.model === 'string' ? body.model.slice(0, 80) : ''
  const usage = {
    input: toCount(body.input),
    output: toCount(body.output),
    cacheRead: toCount(body.cacheRead),
    cacheWrite: toCount(body.cacheWrite),
  }
  const turns = toCount(body.turns)
  const runMs = toCount(body.runMs)
  // 价格快照:用任务派发时记录的那条配置(改配置不重算历史);
  // 没有配置(迁移前/后台未启用)时回落到内置价格表。
  const modelConfigId = job.model_config_id ?? ''
  const price = await configPrice(c.env.DB, modelConfigId)
  const llm = llmCostUsd(model, usage, price)
  const gcp = gcpCostUsd(runMs)

  await c.env.DB
    .prepare(
      `INSERT INTO job_usage (job_id, user_id, project_id, model, input_tokens, output_tokens, cache_read, cache_write,
                              turns, run_ms, llm_cost_usd, gcp_cost_usd, cost_usd, model_config_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET
         model = excluded.model, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
         cache_read = excluded.cache_read, cache_write = excluded.cache_write, turns = excluded.turns,
         run_ms = excluded.run_ms, llm_cost_usd = excluded.llm_cost_usd, gcp_cost_usd = excluded.gcp_cost_usd,
         cost_usd = excluded.cost_usd, model_config_id = excluded.model_config_id`
    )
    .bind(
      id, job.user_id, job.project_id, model,
      usage.input, usage.output, usage.cacheRead, usage.cacheWrite,
      turns, runMs, llm, gcp, llm + gcp, modelConfigId
    )
    .run()

  return c.json({ ok: true, llm_cost_usd: llm, gcp_cost_usd: gcp })
})

/** 读取任务配置快照里的单价;配置不存在/迁移未执行时返回 null(由内置价格表兜底) */
async function configPrice(db: D1Database, configId: string): Promise<ModelPrice | null> {
  if (!configId) return null
  try {
    return await db
      .prepare('SELECT input_price AS input, output_price AS output, cache_read_price AS cacheRead, cache_write_price AS cacheWrite FROM model_configs WHERE id = ?')
      .bind(configId)
      .first<ModelPrice>()
  } catch {
    return null
  }
}

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
  // agent 侧已经按界面语言写过错误文案;这里没带就留空,由 failJobWith 按任务语言兜底
  await failJobWith(c.env, c.req.param('id'), String(body.error ?? ''))
  return c.json({ ok: true })
})

export const internalRoutes = app