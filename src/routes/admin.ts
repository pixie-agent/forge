/**
 * 管理后台(只读):跨用户查看全部产物 —— 项目列表、每个项目的全部版本 HTML、对话记录、
 * 任务(含 agent 流式日志)、站点数据,以及公开链接。并可按用户聚合查看使用情况
 * (项目/版本/对话/任务数、积分、活跃度、产物体量)。
 * 鉴权与普通用户体系隔离,见 lib/admin.ts(`ADMIN_PASSWORD` 口令 + 派生 cookie)。
 */

import { Hono } from 'hono'
import type { Env } from '../types'
import { adminCookie, clearAdminCookie, isAdmin, requireAdmin, verifyAdminPassword } from '../lib/admin'
import { isSecureRequest } from '../lib/auth'
import { signPreviewToken } from '../lib/artifacts'
import { callProjectDb, projectSchema, runProjectSql, seedProjectDocs, type SeedRow } from '../lib/projectDb'

const app = new Hono<{ Bindings: Env }>()

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
  COALESCE((SELECT MAX(j.created_at) FROM jobs j WHERE j.user_id = u.id), u.created_at) AS last_active_at`

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
      `SELECT p.id, p.slug, p.name, p.description, p.status, p.current_version, p.created_at, p.updated_at,
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

  // 数据条数:文档存储已迁到「项目 × 环境」的独立 SQLite,逐项目实时统计(旧 D1 site_data 已停写)
  const rows = results as unknown as Record<string, unknown>[]
  await Promise.all(
    rows.map(async (p) => {
      p.data_count = await countProjectData(c.env, String(p.id))
    })
  )

  const total = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM projects p JOIN users u ON u.id = p.user_id ${where}`)
    .bind(...filterBinds)
    .first<{ n: number }>()

  return c.json({ projects: results, total: total?.n ?? 0, page, limit })
})

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

  const [projectsRes, jobsRes] = await Promise.all([
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
  ])

  // 数据行数需逐项目读 Durable Object,仅在该用户的项目集上计算(按用户维度,量可控)
  const projects = projectsRes.results as unknown as Record<string, unknown>[]
  await Promise.all(
    projects.map(async (p) => {
      p.data_count = await countProjectData(c.env, String(p.id))
    })
  )

  return c.json({ user, projects, jobs: jobsRes.results })
})

/** 单个产物详情:项目 + 属主 + 版本元信息 + 对话 + 任务(含 agent 日志尾部)+ 站点数据计数 */
app.get('/projects/:id', async (c) => {
  const id = c.req.param('id')
  const project = await c.env.DB
    .prepare(
      `SELECT p.*, u.email AS owner_email FROM projects p JOIN users u ON u.id = p.user_id WHERE p.id = ?`
    )
    .bind(id)
    .first()
  if (!project) return c.json({ error: '项目不存在' }, 404)

  const [versions, messages, jobs, collections] = await Promise.all([
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
  ])

  return c.json({
    project,
    versions: versions.results,
    messages: messages.results,
    jobs: jobs.results,
    collections,
  })
})

/** 某个版本的完整源码树与产物清单(只读) */
app.get('/projects/:id/versions/:no', async (c) => {
  const row = await c.env.DB
    .prepare('SELECT version_no, src_json, manifest_json, bytes, prompt, created_at FROM versions WHERE project_id = ? AND version_no = ?')
    .bind(c.req.param('id'), Number(c.req.param('no')))
    .first<{ version_no: number; src_json: string; manifest_json: string; bytes: number; prompt: string; created_at: string }>()
  if (!row) return c.json({ error: '版本不存在' }, 404)
  let src: Record<string, string> = {}
  let manifest: unknown = null
  try {
    src = JSON.parse(row.src_json) as Record<string, string>
  } catch {
    src = {}
  }
  try {
    manifest = JSON.parse(row.manifest_json)
  } catch {
    manifest = null
  }
  const previewToken = await signPreviewToken(c.env, c.req.param('id'), row.version_no)
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