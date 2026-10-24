/**
 * 管理后台:跨用户查看全部产物 —— 项目列表、每个项目的全部版本 HTML、对话记录、
 * 任务(含 agent 流式日志)、站点数据,以及公开链接。并可按用户聚合查看使用情况
 * (项目/版本/对话/任务数、积分、活跃度、产物体量)。
 * 除「模型配置」外全部只读:模型配置是运行时数据(见 docs/FORGE2.md §21),
 * 改配置不需要重新部署;其余接口不允许写用户数据。
 * 版本与「草稿(version_no = 0,工作副本)」都可预览:草稿不进版本列表,作为独立字段下发,
 * 列表页可直接预览尚未生成正式版本的项目。鉴权与普通用户体系隔离,见 lib/admin.ts(`ADMIN_PASSWORD` 口令 + 派生 cookie)。
 */

import { Hono } from 'hono'
import type { ArtifactManifest, Env } from '../types'
import { adminCookie, clearAdminCookie, isAdmin, requireAdmin, verifyAdminPassword } from '../lib/admin'
import { isSecureRequest } from '../lib/auth'
import { DRAFT_VERSION_NO, signPreviewToken } from '../lib/artifacts'
import { callProjectDb, projectSchema, runProjectSql, seedProjectDocs, type SeedRow } from '../lib/projectDb'
import { parseModelConfigInput, type ModelConfigRow } from '../lib/modelConfig'
import { hasPrice } from '../lib/pricing'
import { buildDashboard } from '../lib/dashboard'
import { normalizeShowcaseTags, showcaseTagsText } from '../lib/showcase'
import { grantAdminCredits } from '../lib/credits'

const app = new Hono<{ Bindings: Env }>()

/** 草稿(工作副本)在后台呈现所需的元信息 */
interface AdminDraftMeta {
  version_no: number
  bytes: number
  prompt: string
  created_at: string
  /** 是否已有构建产物(产物在 R2,清单的 files 长度即产物文件数) */
  has_artifacts: boolean
  /** 预览令牌;无产物时为 null,前端据此显示空状态而不是打开一个 404 的 iframe */
  preview_token: string | null
}

/**
 * 草稿行(version_no = 0)的查询:产物文件数交给 SQL 算,避免把整棵清单 manifest_json 拉进 Worker。
 * json_valid 兜底损坏数据(json_extract 遇到非法 JSON 会直接报错)。
 */
const DRAFT_SELECT = `SELECT bytes, prompt, created_at,
    COALESCE(CASE WHEN json_valid(manifest_json) THEN json_array_length(json_extract(manifest_json, '$.files')) END, 0) AS artifact_files
  FROM versions WHERE project_id = ? AND version_no = ${DRAFT_VERSION_NO}`

interface DraftRow {
  bytes: number
  prompt: string
  created_at: string
  artifact_files: number
}

/**
 * 把草稿行加工成后台可用的预览项。
 * 后台原先只列正式版本(version_no > 0),于是「只对话过、还没生成过版本」的项目在这里没有任何可看的内容;
 * 草稿才是真正的工作副本,补上它才能预览到用户当下看到的样子。
 * 令牌是无状态 HMAC(绑定 projectId + versionNo),与 /p/:token 的定位方式一致,不依赖 cookie。
 */
async function draftMeta(env: Env, projectId: string, row: DraftRow | null): Promise<AdminDraftMeta | null> {
  if (!row) return null
  const hasArtifacts = (row.artifact_files ?? 0) > 0
  return {
    version_no: DRAFT_VERSION_NO,
    bytes: row.bytes,
    prompt: row.prompt,
    created_at: row.created_at,
    has_artifacts: hasArtifacts,
    preview_token: hasArtifacts ? await signPreviewToken(env, projectId, DRAFT_VERSION_NO) : null,
  }
}

/** 某行的构建清单是否有产物:后台只在有产物时才签发预览令牌 */
function hasArtifactsOf(manifest: ArtifactManifest | null): boolean {
  return Array.isArray(manifest?.files) && manifest.files.length > 0
}

/**
 * 单个用户使用情况的聚合列(SELECT 片段,供列表/详情复用)。
 * 关联子查询而非 JOIN + GROUP BY:jobs/messages/versions 各行数独立,避免多表 JOIN 造成笛卡尔放大。
 * 任务量以 jobs 表为准(generate/chat、成功/失败),近 7/30 天按 jobs.created_at 过滤;
 * 已消耗积分 ≈ 成功任务数(每次成功 commit 扣 1,见 lib/commit.ts)。
 */
const USER_USAGE_COLUMNS = `
  (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects_count,
  (SELECT COUNT(*) FROM versions v JOIN projects p ON p.id = v.project_id
     WHERE p.user_id = u.id AND v.version_no > 0) AS versions_count,
  (SELECT COUNT(*) FROM messages m JOIN projects p ON p.id = m.project_id
     WHERE p.user_id = u.id) AS messages_count,
  (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id) AS jobs_total,
  (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id AND j.type = 'generate') AS jobs_generate,
  (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id AND j.type = 'chat') AS jobs_chat,
  (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id AND j.status = 'succeeded') AS jobs_succeeded,
  (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id AND j.status = 'failed') AS jobs_failed,
  (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id AND j.created_at >= datetime('now','-7 days')) AS jobs_7d,
  (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id AND j.created_at >= datetime('now','-30 days')) AS jobs_30d,
  (SELECT COALESCE(SUM(v.bytes),0) FROM versions v JOIN projects p ON p.id = v.project_id
     WHERE p.user_id = u.id AND v.version_no > 0) AS bytes_total,
  COALESCE(u.last_active_at, (SELECT MAX(j.created_at) FROM jobs j WHERE j.user_id = u.id), u.created_at) AS last_active_at`

/** 项目在两个环境(draft/live)下的数据行数之和:逐环境读该项目的独立 SQLite,库未创建按 0 */
async function countProjectData(env: Env, projectId: string): Promise<number> {
  let count = 0
  for (const envName of ['draft', 'live'] as const) {
    try {
      const { body } = await callProjectDb<{ collections: { count: number }[] }>(env, projectId, envName, 'db.collections')
      count += (body.collections ?? []).reduce((s, col) => s + (col.count ?? 0), 0)
    } catch {
      // 该环境的库可能从未创建;计 0
    }
  }
  return count
}

// ---------- 会话:登录 / 登出 / 身份(不挂 requireAdmin) ----------

app.post('/login', async (c) => {
  const body = await c.req.json<{ password?: unknown }>().catch(() => ({}) as { password?: unknown })
  if (!(await verifyAdminPassword(c.env, String(body.password ?? '')))) {
    return c.json({ error: '口令错误' }, 401)
  }
  c.header('Set-Cookie', await adminCookie(c.env, isSecureRequest(c.req.url)))
  return c.json({ ok: true })
})

app.post('/logout', (c) => {
  c.header('Set-Cookie', clearAdminCookie(isSecureRequest(c.req.url)))
  return c.json({ ok: true })
})

app.get('/me', async (c) => c.json({ admin: await isAdmin(c.env, c.req.raw) }))

// ---------- 以下全部需要管理员 ----------

app.use('/projects', requireAdmin)
app.use('/projects/*', requireAdmin)
app.use('/users', requireAdmin)
app.use('/users/*', requireAdmin)
app.use('/models', requireAdmin)
app.use('/models/*', requireAdmin)

/** 顶层统计:给列表页头部用(产物 + 用户 + 任务全局计数) */
app.get('/stats', requireAdmin, async (c) => {
  const row = await c.env.DB
    .prepare(
      `SELECT (SELECT COUNT(*) FROM projects) AS projects,
              (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(*) FROM versions WHERE version_no > 0) AS versions,
              (SELECT COUNT(*) FROM jobs) AS jobs,
              (SELECT COUNT(*) FROM jobs WHERE status = 'succeeded') AS jobs_succeeded,
              (SELECT COUNT(*) FROM jobs WHERE status = 'failed') AS jobs_failed,
              (SELECT COUNT(*) FROM jobs WHERE created_at >= datetime('now','-7 days')) AS jobs_7d,
              (SELECT COUNT(DISTINCT user_id) FROM jobs WHERE created_at >= datetime('now','-7 days')) AS active_users_7d`
    )
    .first<{
      projects: number
      users: number
      versions: number
      jobs: number
      jobs_succeeded: number
      jobs_failed: number
      jobs_7d: number
      active_users_7d: number
    }>()
  return c.json({
    stats: row ?? { projects: 0, users: 0, versions: 0, jobs: 0, jobs_succeeded: 0, jobs_failed: 0, jobs_7d: 0, active_users_7d: 0 },
  })
})

/**
 * 用户大盘(见 docs/FORGE2.md §22):一次返回总览、趋势、漏斗、激活、留存、商业化与质量成本。
 * 时间口径固定 UTC+8;days 只影响「趋势/质量」窗口,累计类指标(注册、付费转化、留存 cohort)不受影响。
 * end=0 统计今天,end=1 统计昨天(T-1);日级指标与滚动窗口都以该日为终点。
 */
app.get('/dashboard', requireAdmin, async (c) => {
  const days = Number(c.req.query('days') ?? 30)
  const end = Number(c.req.query('end') ?? 0)
  return c.json({ dashboard: await buildDashboard(c.env, days, end) })
})

/**
 * 模型配置 + 近 7 天用量(控制台最小版,见 docs/FORGE2.md §21)。
 * 配置是数据(不是部署参数):表里 enabled = 1 的那条会被下一次任务使用;表为空时回落 Cloud Run env。
 * 用量来自 job_usage(agent 每次任务收尾上报),按配置/模型聚合;无用量记录的任务单独计数,
 * 避免「报表看起来正常,实际有一批任务根本没上报」。
 */
app.get('/models', async (c) => {
  const [configsRes, byConfigRes, byModelRes, totalsRow, noUsageRow] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM model_configs ORDER BY enabled DESC, created_at DESC').all<Record<string, unknown>>(),
    c.env.DB
      .prepare(
        `SELECT ju.model_config_id AS config_id,
                COALESCE(MAX(ju.model), '') AS model,
                COUNT(*) AS jobs,
                COALESCE(SUM(CASE WHEN j.status = 'succeeded' THEN 1 ELSE 0 END), 0) AS succeeded,
                COALESCE(SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
                COALESCE(SUM(CASE WHEN j.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
                COALESCE(AVG(ju.run_ms), 0) AS avg_run_ms,
                COALESCE(SUM(ju.input_tokens), 0) AS input_tokens,
                COALESCE(SUM(ju.output_tokens), 0) AS output_tokens,
                COALESCE(SUM(ju.llm_cost_usd), 0) AS llm_cost_usd,
                COALESCE(SUM(ju.gcp_cost_usd), 0) AS gcp_cost_usd,
                COALESCE(SUM(ju.cost_usd), 0) AS cost_usd
           FROM job_usage ju LEFT JOIN jobs j ON j.id = ju.job_id
          WHERE ju.created_at >= datetime('now', '-7 days')
          GROUP BY ju.model_config_id`
      )
      .all<UsageAgg>(),
    c.env.DB
      .prepare(
        `SELECT ju.model AS model,
                ju.model_config_id AS config_id,
                COALESCE(MAX(j.channel), '') AS channel,
                COUNT(*) AS jobs,
                COALESCE(SUM(CASE WHEN j.status = 'succeeded' THEN 1 ELSE 0 END), 0) AS succeeded,
                COALESCE(SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
                COALESCE(SUM(CASE WHEN j.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
                COALESCE(AVG(ju.run_ms), 0) AS avg_run_ms,
                COALESCE(SUM(ju.input_tokens), 0) AS input_tokens,
                COALESCE(SUM(ju.output_tokens), 0) AS output_tokens,
                COALESCE(SUM(ju.llm_cost_usd), 0) AS llm_cost_usd,
                COALESCE(SUM(ju.gcp_cost_usd), 0) AS gcp_cost_usd,
                COALESCE(SUM(ju.cost_usd), 0) AS cost_usd
           FROM job_usage ju LEFT JOIN jobs j ON j.id = ju.job_id
          WHERE ju.created_at >= datetime('now', '-7 days')
          GROUP BY ju.model, ju.model_config_id
          ORDER BY cost_usd DESC`
      )
      .all<UsageAgg>(),
    c.env.DB
      .prepare(
        `SELECT COUNT(*) AS jobs,
                COALESCE(SUM(CASE WHEN j.status = 'succeeded' THEN 1 ELSE 0 END), 0) AS succeeded,
                COALESCE(SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
                COALESCE(SUM(ju.cost_usd), 0) AS cost_usd,
                COALESCE(SUM(ju.llm_cost_usd), 0) AS llm_cost_usd,
                COALESCE(SUM(ju.gcp_cost_usd), 0) AS gcp_cost_usd,
                COALESCE(AVG(ju.run_ms), 0) AS avg_run_ms
           FROM job_usage ju LEFT JOIN jobs j ON j.id = ju.job_id
          WHERE ju.created_at >= datetime('now', '-7 days')`
      )
      .first<Record<string, number>>(),
    c.env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM jobs
          WHERE created_at >= datetime('now', '-7 days')
            AND status IN ('succeeded', 'failed', 'cancelled')
            AND NOT EXISTS (SELECT 1 FROM job_usage ju WHERE ju.job_id = jobs.id)`
      )
      .first<{ n: number }>(),
  ])

  const statsByConfig = new Map(byConfigRes.results.map((r) => [r.config_id ?? '', withUnitCost(r)]))
  const configRows = configsRes.results as unknown as ModelConfigRow[]
  const configs: (ModelConfigRow & { priced: boolean; stats: UsageAgg | null })[] = configRows.map((row) => {
    const price = {
      input: Number(row.input_price ?? 0),
      output: Number(row.output_price ?? 0),
      cacheRead: Number(row.cache_read_price ?? 0),
      cacheWrite: Number(row.cache_write_price ?? 0),
    }
    return {
      ...row,
      priced: hasPrice(String(row.model_id ?? ''), price),
      stats: statsByConfig.get(String(row.id)) ?? null,
    }
  })
  // 每个通道各自最多一条生效配置:后台按通道展示,避免「只有一个生效项」的旧假设
  const activeByChannel: Record<string, string | null> = {}
  for (const channel of ['vip', 'free', 'default']) {
    const row = configs.find((r) => r.channel === channel && Number(r.enabled) === 1)
    activeByChannel[channel] = row ? String(row.id) : null
  }
  return c.json({
    configs,
    active_by_channel: activeByChannel,
    totals: withUnitCost((totalsRow ?? {}) as unknown as UsageAgg),
    by_model: byModelRes.results.map(withUnitCost),
    jobs_without_usage: noUsageRow?.n ?? 0,
  })
})

/** 新增模型配置;enabled = true 时同事务内把旧配置停用(部分唯一索引保证每通道只有一条生效) */
app.post('/models', async (c) => {
  const parsed = parseModelConfigInput(await c.req.json().catch(() => ({})))
  if (parsed.error || !parsed.value) return c.json({ error: parsed.error ?? '参数错误' }, 400)
  const v = parsed.value
  const id = crypto.randomUUID()
  const insert = c.env.DB
    .prepare(
      `INSERT INTO model_configs (id, name, channel, provider_id, base_url, api_dialect, model_id, thinking_level,
                                  thinking_format, max_tokens,
                                  reasoning, image_input, design_review, max_run_ms, polish_max_ms, queue_concurrency,
                                  input_price, output_price, cache_read_price, cache_write_price, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, v.name, v.channel, v.provider_id, v.base_url, v.api_dialect, v.model_id, v.thinking_level,
      v.thinking_format, v.max_tokens,
      v.reasoning, v.image_input, v.design_review, v.max_run_ms, v.polish_max_ms, v.queue_concurrency,
      v.input_price, v.output_price, v.cache_read_price, v.cache_write_price, v.enabled
    )
  if (v.enabled) {
    await c.env.DB.batch([
      c.env.DB
        .prepare("UPDATE model_configs SET enabled = 0, updated_at = datetime('now') WHERE channel = ? AND enabled = 1")
        .bind(v.channel),
      insert,
    ])
  } else {
    await insert.run()
  }
  return c.json({ ok: true, id })
})

/**
 * 编辑已有配置(原地更新)。历史成本不会重算:job_usage 在用量回调时已经把
 * 单价换算结果落库,改配置只影响之后派发的任务。
 * enabled = true 时同事务内停用同通道的其它生效行(部分唯一索引要求每通道最多一条)。
 */
app.put('/models/:id', async (c) => {
  const id = c.req.param('id')
  const exists = await c.env.DB
    .prepare('SELECT id FROM model_configs WHERE id = ?')
    .bind(id)
    .first<{ id: string }>()
  if (!exists) return c.json({ error: '配置不存在' }, 404)

  const parsed = parseModelConfigInput(await c.req.json().catch(() => ({})))
  if (parsed.error || !parsed.value) return c.json({ error: parsed.error ?? '参数错误' }, 400)
  const v = parsed.value
  const update = c.env.DB
    .prepare(
      `UPDATE model_configs SET
         name = ?, channel = ?, provider_id = ?, base_url = ?, api_dialect = ?, model_id = ?,
         thinking_level = ?, thinking_format = ?, max_tokens = ?, reasoning = ?, image_input = ?,
         design_review = ?, max_run_ms = ?, polish_max_ms = ?, queue_concurrency = ?,
         input_price = ?, output_price = ?, cache_read_price = ?, cache_write_price = ?,
         enabled = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(
      v.name, v.channel, v.provider_id, v.base_url, v.api_dialect, v.model_id,
      v.thinking_level, v.thinking_format, v.max_tokens, v.reasoning, v.image_input,
      v.design_review, v.max_run_ms, v.polish_max_ms, v.queue_concurrency,
      v.input_price, v.output_price, v.cache_read_price, v.cache_write_price,
      v.enabled, id
    )

  if (v.enabled) {
    await c.env.DB.batch([
      c.env.DB
        .prepare(
          "UPDATE model_configs SET enabled = 0, updated_at = datetime('now') WHERE channel = ? AND enabled = 1 AND id <> ?"
        )
        .bind(v.channel, id),
      update,
    ])
  } else {
    await update.run()
  }
  return c.json({ ok: true, id })
})

/** 启用某条配置(同通道旧配置自动停用) */
app.post('/models/:id/enable', async (c) => {
  const id = c.req.param('id')
  const target = await c.env.DB
    .prepare('SELECT id, channel FROM model_configs WHERE id = ?')
    .bind(id)
    .first<{ id: string; channel: string }>()
  if (!target) return c.json({ error: '配置不存在' }, 404)
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        "UPDATE model_configs SET enabled = 0, updated_at = datetime('now') WHERE channel = ? AND enabled = 1 AND id <> ?"
      )
      .bind(target.channel, id),
    c.env.DB.prepare("UPDATE model_configs SET enabled = 1, updated_at = datetime('now') WHERE id = ?").bind(id),
  ])
  return c.json({ ok: true })
})

/** 停用某条配置;停用后如果同通道没有生效行,任务回落 Cloud Run env 默认模型 */
app.post('/models/:id/disable', async (c) => {
  const res = await c.env.DB
    .prepare("UPDATE model_configs SET enabled = 0, updated_at = datetime('now') WHERE id = ?")
    .bind(c.req.param('id'))
    .run()
  if (!res.meta.changes) return c.json({ error: '配置不存在' }, 404)
  return c.json({ ok: true })
})

/**
 * 只改任务并发(0 = 不限)。这是列表里的快捷旋钮,不涉及模型/价格快照;
 * 下一次派发即生效(值随请求下发给执行体)。
 */
app.post('/models/:id/concurrency', async (c) => {
  const body = await c.req.json<{ queue_concurrency?: unknown }>().catch(() => ({}) as { queue_concurrency?: unknown })
  const n = Number(body.queue_concurrency)
  if (!Number.isFinite(n)) return c.json({ error: '并发数不合法' }, 400)
  const value = Math.min(32, Math.max(0, Math.round(n)))
  const res = await c.env.DB
    .prepare("UPDATE model_configs SET queue_concurrency = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(value, c.req.param('id'))
    .run()
  if (!res.meta.changes) return c.json({ error: '配置不存在' }, 404)
  return c.json({ ok: true, queue_concurrency: value })
})

interface UsageAgg {
  config_id?: string
  model?: string
  jobs: number
  succeeded: number
  failed: number
  cancelled: number
  avg_run_ms: number
  input_tokens: number
  output_tokens: number
  llm_cost_usd: number
  gcp_cost_usd: number
  cost_usd: number
}

/** 单次成功成本 = 区间总成本 / 成功任务数(失败任务不退上游的钱,必须摊进去) */
function withUnitCost<T extends Partial<UsageAgg>>(row: T): T & { cost_per_success: number | null } {
  const succeeded = Number(row.succeeded ?? 0)
  const cost = Number(row.cost_usd ?? 0)
  return { ...row, cost_per_success: succeeded > 0 ? cost / succeeded : null }
}

/** 产物列表:跨用户,带属主/版本数/消息数/数据条数,支持关键字与分页 */
app.get('/projects', async (c) => {
  const q = (c.req.query('q') ?? '').trim()
  const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1)
  // 每行都要按环境读一次 Durable Object 统计行数,页大小限制在 20 以内以控制子请求数
  const limit = Math.min(20, Math.max(1, Number(c.req.query('limit') ?? 20) || 20))
  const offset = (page - 1) * limit
  const like = `%${q}%`
  const where = q ? 'WHERE p.name LIKE ? OR p.slug LIKE ? OR u.email LIKE ?' : ''
  const filterBinds = q ? [like, like, like] : []

  const { results } = await c.env.DB
    .prepare(
      `SELECT p.id, p.slug, p.name, p.description, p.status, p.current_version, p.published_version,
              p.featured, p.featured_tags, p.created_at, p.updated_at,
              u.id AS user_id, u.email AS owner_email,
              (SELECT COUNT(*) FROM versions v WHERE v.project_id = p.id AND v.version_no > 0) AS versions_count,
              (SELECT COUNT(*) FROM messages m WHERE m.project_id = p.id) AS messages_count
       FROM projects p JOIN users u ON u.id = p.user_id
       ${where}
       ORDER BY p.updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...filterBinds, limit, offset)
    .all()

  // 数据条数与草稿:文档存储已迁到「项目 × 环境」的独立 SQLite(旧 D1 site_data 已停写);
  // 草稿(version_no = 0)不进 versions_count,单独带上,列表页可直接预览未确认的工作副本
  const rows = results as unknown as Record<string, unknown>[]
  await Promise.all(
    rows.map(async (p) => {
      const projectId = String(p.id)
      const [dataCount, draftRow] = await Promise.all([
        countProjectData(c.env, projectId),
        c.env.DB.prepare(DRAFT_SELECT).bind(projectId).first<DraftRow>(),
      ])
      p.data_count = dataCount
      p.draft = await draftMeta(c.env, projectId, draftRow)
    })
  )

  const total = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM projects p JOIN users u ON u.id = p.user_id ${where}`)
    .bind(...filterBinds)
    .first<{ n: number }>()

  return c.json({ projects: results, total: total?.n ?? 0, page, limit })
})

/**
 * 首页展示(唯一改动产物的后台写接口,与「模型配置」并列):
 *   - featured=true 只允许已发布且 published_version >= 1 的项目,否则首页卡片会打开 404;
 *   - 标签按逗号拆分归一化(最多 5 个、每个 20 字),空串 = 清空;
 *   - 上首页时记录 featured_at(首页按它倒序),下首页时清空;
 *   - 不触碰 updated_at:打标签是运营动作,不该把项目挤到用户列表最前面。
 */
app.post('/projects/:id/featured', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB
    .prepare('SELECT id, status, published_version, featured, featured_tags FROM projects WHERE id = ?')
    .bind(id)
    .first<{ id: string; status: string; published_version: number; featured: number; featured_tags: string }>()
  if (!row) return c.json({ error: '项目不存在' }, 404)

  const body = await c.req
    .json<{ featured?: unknown; tags?: unknown }>()
    .catch(() => ({}) as { featured?: unknown; tags?: unknown })
  const featured =
    body.featured === undefined
      ? Number(row.featured) === 1
        ? 1
        : 0
      : body.featured === true || body.featured === 1 || body.featured === '1'
        ? 1
        : 0
  if (featured && (row.status !== 'published' || row.published_version < 1)) {
    return c.json({ error: '请先发布该版本再上首页' }, 400)
  }

  const tags = body.tags === undefined ? row.featured_tags : showcaseTagsText(normalizeShowcaseTags(body.tags))
  await c.env.DB
    .prepare(
      `UPDATE projects
          SET featured = ?, featured_tags = ?,
              featured_at = CASE WHEN ? = 1 THEN COALESCE(featured_at, datetime('now')) ELSE NULL END
        WHERE id = ?`
    )
    .bind(featured, tags, featured, id)
    .run()
  return c.json({ ok: true, featured, featured_tags: tags })
})

/** 后台人工加积分:单次上限与批量人数上限(防止误输入把余额写成天文数字 / 一次打爆 D1 语句配额) */
const MAX_ADMIN_GRANT = 100_000
const MAX_ADMIN_GRANT_USERS = 100

/** 校验「加积分」请求体;note 可选,超长截断而不是报错 */
function parseAdminGrant(body: { amount?: unknown; note?: unknown }): { amount: number; note: string } | { error: string } {
  const amount = Number(body.amount)
  if (!Number.isInteger(amount) || amount <= 0) return { error: '积分数必须是正整数' }
  if (amount > MAX_ADMIN_GRANT) return { error: `单次最多加 ${MAX_ADMIN_GRANT} 积分` }
  return { amount, note: typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '' }
}

/** 用户使用情况(跨用户列表):每行一个注册用户 + 其用量聚合,支持邮箱搜索与分页 */
app.get('/users', async (c) => {
  const q = (c.req.query('q') ?? '').trim()
  const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1)
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? 20) || 20))
  const offset = (page - 1) * limit
  const like = `%${q}%`
  const where = q ? 'WHERE u.email LIKE ?' : ''
  const binds = q ? [like] : []

  const { results } = await c.env.DB
    .prepare(
      `SELECT u.id, u.email, u.credits, u.created_at, ${USER_USAGE_COLUMNS}
       FROM users u
       ${where}
       ORDER BY last_active_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, limit, offset)
    .all()

  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`).bind(...binds).first<{ n: number }>()
  return c.json({ users: results, total: total?.n ?? 0, page, limit })
})

/** 单个用户详情:用量聚合 + 该用户的项目(含产物字节/数据行数)+ 最近任务时间线 */
app.get('/users/:id', async (c) => {
  const id = c.req.param('id')
  const user = await c.env.DB
    .prepare(`SELECT u.id, u.email, u.credits, u.created_at, ${USER_USAGE_COLUMNS} FROM users u WHERE u.id = ?`)
    .bind(id)
    .first()
  if (!user) return c.json({ error: '用户不存在' }, 404)

  const [projectsRes, jobsRes, ledgerRes] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT p.id, p.slug, p.name, p.status, p.current_version, p.published_version, p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM versions v WHERE v.project_id = p.id AND v.version_no > 0) AS versions_count,
                (SELECT COUNT(*) FROM messages m WHERE m.project_id = p.id) AS messages_count,
                (SELECT COALESCE(SUM(v.bytes),0) FROM versions v WHERE v.project_id = p.id AND v.version_no > 0) AS bytes
         FROM projects p WHERE p.user_id = ? ORDER BY p.updated_at DESC`
      )
      .bind(id)
      .all(),
    c.env.DB
      .prepare(
        `SELECT j.id, j.type, j.status, j.stage, j.progress, j.error, j.result_version,
                substr(COALESCE(j.agent_log, ''), -8000) AS agent_log, j.created_at, j.updated_at,
                p.slug AS project_slug, p.name AS project_name
         FROM jobs j JOIN projects p ON p.id = j.project_id
         WHERE j.user_id = ? ORDER BY j.created_at DESC LIMIT 100`
      )
      .bind(id)
      .all(),
    // 积分流水:后台加积分后运营要能直接看到扣/加记录(最近 30 条,同秒按 rowid 倒序)
    c.env.DB
      .prepare(
        `SELECT id, delta, reason, ref_type, ref_id, balance_after, note, created_at
         FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 30`
      )
      .bind(id)
      .all(),
  ])

  // 数据行数与草稿需逐项目读(前者读 Durable Object,后者读 versions),仅在该用户的项目集上计算
  const projects = projectsRes.results as unknown as Record<string, unknown>[]
  await Promise.all(
    projects.map(async (p) => {
      const projectId = String(p.id)
      const [dataCount, draftRow] = await Promise.all([
        countProjectData(c.env, projectId),
        c.env.DB.prepare(DRAFT_SELECT).bind(projectId).first<DraftRow>(),
      ])
      p.data_count = dataCount
      p.draft = await draftMeta(c.env, projectId, draftRow)
    })
  )

  return c.json({ user, projects, jobs: jobsRes.results, credits_log: ledgerRes.results })
})

/**
 * 给单个用户加积分。审计流水走 credit_ledger(reason = admin_grant),与充值 / 注册赠送同一本账。
 * 只加不减:扣分属于风控动作,不在这里顺手做,避免一个接口既能加又能扣。
 */
app.post('/users/:id/credits', async (c) => {
  const id = c.req.param('id')
  const body = await c.req
    .json<{ amount?: unknown; note?: unknown }>()
    .catch(() => ({}) as { amount?: unknown; note?: unknown })
  const parsed = parseAdminGrant(body)
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)

  const [grant] = await grantAdminCredits(c.env.DB, [id], parsed.amount, parsed.note || '后台加积分')
  if (!grant) return c.json({ error: '用户不存在' }, 404)
  return c.json({ ok: true, granted: parsed.amount, credits: grant.credits })
})

/**
 * 批量给多个用户加**同一额度**的积分(后台用户列表勾选后调用)。
 * 先确认所有 id 都存在再写,避免部分成功让运营回头猜谁没加上;重复 id 自动去重。
 */
app.post('/users/credits', async (c) => {
  const body = await c.req
    .json<{ userIds?: unknown; amount?: unknown; note?: unknown }>()
    .catch(() => ({}) as { userIds?: unknown; amount?: unknown; note?: unknown })
  const parsed = parseAdminGrant(body)
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)

  const rawIds = Array.isArray(body.userIds) ? body.userIds : []
  const userIds = [...new Set(rawIds.filter((v): v is string => typeof v === 'string' && v.length > 0))]
  if (userIds.length === 0) return c.json({ error: '请选择用户' }, 400)
  if (userIds.length > MAX_ADMIN_GRANT_USERS) {
    return c.json({ error: `单次最多给 ${MAX_ADMIN_GRANT_USERS} 个用户加积分` }, 400)
  }

  const placeholders = userIds.map(() => '?').join(',')
  const { results } = await c.env.DB
    .prepare(`SELECT id FROM users WHERE id IN (${placeholders})`)
    .bind(...userIds)
    .all<{ id: string }>()
  const found = new Set(results.map((r) => r.id))
  const missing = userIds.filter((id) => !found.has(id))
  if (missing.length > 0) {
    const shown = missing.slice(0, 5).join(', ')
    return c.json({ error: `部分用户不存在:${shown}${missing.length > 5 ? ' 等' : ''}`, missing }, 400)
  }

  const grants = await grantAdminCredits(c.env.DB, userIds, parsed.amount, parsed.note || '后台加积分')
  return c.json({
    ok: true,
    granted: parsed.amount,
    updated: grants.length,
    users: grants.map((g) => ({ id: g.userId, credits: g.credits })),
  })
})

/** 单个产物详情:项目 + 属主 + 版本元信息 + 草稿 + 对话 + 任务(含 agent 日志尾部)+ 站点数据计数 */
app.get('/projects/:id', async (c) => {
  const id = c.req.param('id')
  const project = await c.env.DB
    .prepare(
      `SELECT p.*, u.email AS owner_email FROM projects p JOIN users u ON u.id = p.user_id WHERE p.id = ?`
    )
    .bind(id)
    .first()
  if (!project) return c.json({ error: '项目不存在' }, 404)

  const [versions, messages, jobs, collections, draftRow] = await Promise.all([
    c.env.DB
      .prepare('SELECT version_no, bytes, prompt, created_at FROM versions WHERE project_id = ? AND version_no > 0 ORDER BY version_no DESC')
      .bind(id)
      .all(),
    c.env.DB.prepare('SELECT id, role, content, created_at FROM messages WHERE project_id = ? ORDER BY rowid').bind(id).all(),
    c.env.DB
      .prepare(
        `SELECT id, type, status, stage, progress, error, result_version,
                substr(COALESCE(agent_log, ''), -8000) AS agent_log, created_at, updated_at
         FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50`
      )
      .bind(id)
      .all(),
    // 文档数据现已落在「项目 × 环境」的独立 SQLite 里,从各环境的库实时取集合与行数
    (async () => {
      const out: { env: string; collection: string; count: number }[] = []
      for (const env of ['draft', 'live'] as const) {
        const objects = await projectSchema(c.env, id, env)
        for (const o of objects) if (o.type === 'table') out.push({ env, collection: o.name, count: o.count ?? 0 })
      }
      return out
    })(),
    // 草稿(工作副本):不进版本列表,作为独立字段返回,后台可直接预览用户当下的工作副本
    c.env.DB.prepare(DRAFT_SELECT).bind(id).first<DraftRow>(),
  ])

  return c.json({
    project,
    versions: versions.results,
    draft: await draftMeta(c.env, id, draftRow),
    messages: messages.results,
    jobs: jobs.results,
    collections,
  })
})

/** 某个版本的完整源码树与产物清单(只读);version_no = 0 即草稿(工作副本) */
app.get('/projects/:id/versions/:no', async (c) => {
  const id = c.req.param('id')
  const no = Number(c.req.param('no'))
  if (!Number.isInteger(no) || no < 0) return c.json({ error: '版本号不合法' }, 400)
  const row = await c.env.DB
    .prepare('SELECT version_no, src_json, manifest_json, bytes, prompt, created_at FROM versions WHERE project_id = ? AND version_no = ?')
    .bind(id, no)
    .first<{ version_no: number; src_json: string; manifest_json: string; bytes: number; prompt: string; created_at: string }>()
  if (!row) return c.json({ error: '版本不存在' }, 404)
  let src: Record<string, string> = {}
  let manifest: ArtifactManifest | null = null
  try {
    src = JSON.parse(row.src_json) as Record<string, string>
  } catch {
    src = {}
  }
  try {
    manifest = JSON.parse(row.manifest_json) as ArtifactManifest
  } catch {
    manifest = null
  }
  // 无构建产物时下发 null:前端据此显示空状态,而不是打开一个必然 404 的 iframe
  const previewToken = hasArtifactsOf(manifest) ? await signPreviewToken(c.env, id, row.version_no) : null
  return c.json({ version: { version_no: row.version_no, bytes: row.bytes, prompt: row.prompt, created_at: row.created_at, src, manifest, previewToken } })
})

/** 某表在某环境下的数据行(只读,取自该项目的独立 SQLite 库) */
app.get('/projects/:id/data/:env/:collection', async (c) => {
  const env = c.req.param('env')
  if (!/^(draft|live)$/.test(env)) return c.json({ error: '参数不合法' }, 400)
  const collection = c.req.param('collection')
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(collection)) return c.json({ error: '集合名不合法' }, 400)
  try {
    const { rows } = await runProjectSql(
      c.env,
      c.req.param('id'),
      env as 'draft' | 'live',
      `SELECT id, data, created_at FROM "${collection}" ORDER BY rowid DESC LIMIT 200`
    )
    return c.json({
      items: rows.map((r) => {
        let data: unknown = {}
        try {
          data = JSON.parse(String(r.data))
        } catch {
          // 兜底空对象
        }
        return { id: r.id, data, created_at: r.created_at }
      }),
    })
  } catch (err) {
    return c.json({ items: [], error: (err as Error).message })
  }
})

/**
 * 一次性迁移:把旧 D1 site_data 的行回填进各项目对应环境的独立 SQLite(幂等,INSERT OR IGNORE)。
 * 文档接口已切到 SQLite,存量数据靠这个补进去;?projectId=xxx 只迁一个项目。
 */
app.post('/migrate-doc-data', requireAdmin, async (c) => {
  const only = c.req.query('projectId')
  const base = 'SELECT project_id, env, collection, id, data, created_at, client_ip FROM site_data'
  const { results } = await (only
    ? c.env.DB.prepare(`${base} WHERE project_id = ? ORDER BY rowid`).bind(only)
    : c.env.DB.prepare(`${base} ORDER BY project_id, env, rowid`)
  ).all<{ project_id: string; env: string; collection: string; id: string; data: string; created_at: string; client_ip: string }>()

  const groups = new Map<string, { projectId: string; env: 'draft' | 'live'; rows: SeedRow[] }>()
  for (const r of results) {
    if (r.env !== 'draft' && r.env !== 'live') continue
    const key = `${r.project_id}:${r.env}`
    let g = groups.get(key)
    if (!g) {
      g = { projectId: r.project_id, env: r.env, rows: [] }
      groups.set(key, g)
    }
    g.rows.push({ collection: r.collection, id: r.id, data: r.data, created_at: r.created_at, client_ip: r.client_ip })
  }

  let total = 0
  const errors: string[] = []
  for (const g of groups.values()) {
    try {
      total += await seedProjectDocs(c.env, g.projectId, g.env, g.rows)
    } catch (err) {
      errors.push(`${g.projectId}/${g.env}: ${(err as Error).message}`)
    }
  }
  return c.json({ groups: groups.size, rows: total, errors })
})

export const adminRoutes = app