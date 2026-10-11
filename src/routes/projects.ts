import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv, ArtifactManifest, ProjectRow } from '../types'
import { requireUser } from '../lib/auth'
import { clearArtifacts, copyArtifacts, deleteProjectArtifacts, DRAFT_VERSION_NO, signPreviewToken } from '../lib/artifacts'
import { BLOB_KEY_RE, blobKey, blobPrefix, deleteProjectAppData, KV_KEY_RE, kvKey, kvPrefix, type DataEnv } from '../lib/appdata'
import { projectSchema, runProjectSql } from '../lib/projectDb'
import { ACTIVE_STATUS_SQL } from '../lib/jobHelpers'
import { createZip } from '../lib/zip'

const app = new Hono<AppEnv>()
app.use('*', requireUser)

function randomSlug(len = 8): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

async function newUniqueSlug(db: D1Database): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = randomSlug()
    const hit = await db.prepare('SELECT id FROM projects WHERE slug = ?').bind(slug).first()
    if (!hit) return slug
  }
  return randomSlug(12)
}

async function ownedProject(c: Context<AppEnv>, id: string): Promise<ProjectRow | null> {
  return c.env.DB
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .bind(id, c.get('user').id)
    .first<ProjectRow>()
}

/** 项目列表 */
app.get('/', async (c) => {
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, slug, name, description, status, current_version, published_version, created_at, updated_at,
              EXISTS(SELECT 1 FROM versions v WHERE v.project_id = projects.id AND v.version_no = 0) AS has_draft
       FROM projects WHERE user_id = ? ORDER BY updated_at DESC`
    )
    .bind(c.get('user').id)
    .all()
  return c.json({ projects: results })
})

/** 创建项目(带初始想法) */
app.post('/', async (c) => {
  const body = await c.req.json<{ idea?: string }>().catch(() => ({}) as { idea?: string })
  const idea = String(body.idea ?? '').trim()
  if (!idea) return c.json({ error: '想法不能为空' }, 400)

  const id = crypto.randomUUID()
  const slug = await newUniqueSlug(c.env.DB)
  await c.env.DB
    .prepare("INSERT INTO projects (id, user_id, slug, name) VALUES (?, ?, ?, ?)")
    .bind(id, c.get('user').id, slug, idea.slice(0, 30))
    .run()
  return c.json({ id })
})

/** 项目详情:项目 + 消息历史 + 正式版本列表 + 草稿信息 + 当前展示内容(源码树/产物清单/预览令牌) */
app.get('/:id', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)

  const [messages, versions, draftRow] = await Promise.all([
    c.env.DB
      .prepare('SELECT id, role, content, created_at FROM messages WHERE project_id = ? ORDER BY rowid')
      .bind(project.id)
      .all(),
    c.env.DB
      .prepare('SELECT version_no, bytes, prompt, created_at FROM versions WHERE project_id = ? AND version_no > 0 ORDER BY version_no DESC')
      .bind(project.id)
      .all(),
    // 草稿(工作副本):version_no = 0,存在即表示有未确认的修改
    c.env.DB
      .prepare('SELECT bytes, prompt, created_at FROM versions WHERE project_id = ? AND version_no = ?')
      .bind(project.id, DRAFT_VERSION_NO)
      .first<{ bytes: number; prompt: string; created_at: string }>(),
  ])

  const draft = draftRow ? { bytes: draftRow.bytes, prompt: draftRow.prompt, created_at: draftRow.created_at } : null
  // 展示基线:有草稿看草稿,否则看当前生效正式版本
  const baseline = draft ? DRAFT_VERSION_NO : project.current_version

  let manifest: ArtifactManifest | null = null
  let src: Record<string, string> | null = null
  let previewToken: string | null = null
  if (draft || project.current_version > 0) {
    const v = await c.env.DB
      .prepare('SELECT src_json, manifest_json FROM versions WHERE project_id = ? AND version_no = ?')
      .bind(project.id, baseline)
      .first<{ src_json: string; manifest_json: string }>()
    if (v) {
      try {
        manifest = JSON.parse(v.manifest_json) as ArtifactManifest
      } catch {
        manifest = null
      }
      try {
        src = JSON.parse(v.src_json) as Record<string, string>
      } catch {
        src = null
      }
    }
    previewToken = await signPreviewToken(c.env, project.id, baseline)
  }
  return c.json({ project, messages: messages.results, versions: versions.results, manifest, src, previewToken, draft })
})

/** 任意历史版本:源码树 + 产物清单 + 预览令牌(版本切换时查看用,不影响当前版本) */
app.get('/:id/versions/:no', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const no = Number(c.req.param('no'))
  if (!Number.isInteger(no) || no < 1) return c.json({ error: '版本号不合法' }, 400)
  const row = await c.env.DB
    .prepare('SELECT version_no, bytes, prompt, created_at, src_json, manifest_json FROM versions WHERE project_id = ? AND version_no = ?')
    .bind(project.id, no)
    .first<{ version_no: number; bytes: number; prompt: string; created_at: string; src_json: string; manifest_json: string }>()
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
  const previewToken = await signPreviewToken(c.env, project.id, no)
  return c.json({
    version: { version_no: row.version_no, bytes: row.bytes, prompt: row.prompt, created_at: row.created_at, manifest, src, previewToken },
  })
})

/**
 * 生成新版本(人工确认):把当前草稿(version_no = 0)快照为一个正式版本,并把 current_version 推进到它。
 * 之前的生成/对话都只改草稿、不产生正式版本;这里才真正「生成版本」,是版本的人工确认动作。
 * 发布(published_version)与生成版本完全独立:生成版本不会自动上线,仍需在发布接口确认。
 */
app.post('/:id/commit', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const active = await c.env.DB
    .prepare(`SELECT 1 FROM jobs WHERE project_id = ? AND ${ACTIVE_STATUS_SQL} LIMIT 1`)
    .bind(project.id)
    .first()
  if (active) return c.json({ error: '生成进行中,请等待完成后再生成版本' }, 409)
  const draft = await c.env.DB
    .prepare('SELECT src_json, manifest_json, bytes, prompt FROM versions WHERE project_id = ? AND version_no = ?')
    .bind(project.id, DRAFT_VERSION_NO)
    .first<{ src_json: string; manifest_json: string; bytes: number; prompt: string }>()
  if (!draft) return c.json({ error: '当前没有可生成版本的草稿' }, 400)
  const maxRow = await c.env.DB
    .prepare('SELECT COALESCE(MAX(version_no), 0) AS max_no FROM versions WHERE project_id = ? AND version_no > 0')
    .bind(project.id)
    .first<{ max_no: number }>()
  const next = (maxRow?.max_no ?? 0) + 1
  // 制品整树从草稿目录复制到新版本目录(内容一致,独立留存,后续草稿覆盖不影响已生成版本)
  const bytes = await copyArtifacts(c.env, project.id, DRAFT_VERSION_NO, next)
  await c.env.DB.batch([
    c.env.DB
      .prepare('INSERT INTO versions (id, project_id, version_no, src_json, manifest_json, bytes, prompt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), project.id, next, draft.src_json, draft.manifest_json, bytes || draft.bytes, draft.prompt),
    c.env.DB.prepare('DELETE FROM versions WHERE project_id = ? AND version_no = ?').bind(project.id, DRAFT_VERSION_NO),
    // current_version 直接取「实际最大正式版本号」而不是计算出的 next:即使历史数据曾漂移(如线上版本落后于最新版本),下一次生成版本时也会被自动纠正
    c.env.DB
      .prepare(
        "UPDATE projects SET current_version = (SELECT COALESCE(MAX(version_no), 0) FROM versions WHERE project_id = ? AND version_no > 0), updated_at = datetime('now') WHERE id = ?"
      )
      .bind(project.id, project.id),
  ])
  await clearArtifacts(c.env, project.id, DRAFT_VERSION_NO)
  return c.json({ ok: true, version: next })
})

/** 导出某版本的完整源码为 zip(交付/本地运行:npm install && npm run build) */
app.get('/:id/versions/:no/export', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const no = Number(c.req.param('no'))
  if (!Number.isInteger(no) || no < 1) return c.json({ error: '版本号不合法' }, 400)
  const row = await c.env.DB
    .prepare('SELECT src_json FROM versions WHERE project_id = ? AND version_no = ?')
    .bind(project.id, no)
    .first<{ src_json: string }>()
  if (!row) return c.json({ error: '版本不存在' }, 404)
  let src: Record<string, string> = {}
  try {
    src = JSON.parse(row.src_json) as Record<string, string>
  } catch {
    src = {}
  }
  const zip = createZip(src)
  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${project.slug}-v${no}.zip"`,
      'Content-Length': String(zip.byteLength),
      'Cache-Control': 'no-store',
    },
  })
})

app.delete('/:id', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  await Promise.all([deleteProjectArtifacts(c.env, project.id), deleteProjectAppData(c.env, project.id)])
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM messages WHERE project_id = ?').bind(project.id),
    c.env.DB.prepare('DELETE FROM versions WHERE project_id = ?').bind(project.id),
    c.env.DB.prepare('DELETE FROM site_data WHERE project_id = ?').bind(project.id),
    c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(project.id),
  ])
  return c.json({ ok: true })
})

/**
 * 发布上线:把指定正式版本设为线上版本(published_version)。默认当前生效版本。
 * 与「生成版本」完全独立——生成版本不会自动上线;且只能发布已确认的正式版本(草稿 version_no=0 不可发布)。
 */
app.post('/:id/publish', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const body = await c.req.json<{ version?: number }>().catch(() => ({}) as { version?: number })
  const version = Number.isInteger(body.version) && (body.version as number) > 0 ? (body.version as number) : project.current_version
  if (version < 1) return c.json({ error: '请先生成版本再发布' }, 400)
  const exists = await c.env.DB
    .prepare('SELECT version_no FROM versions WHERE project_id = ? AND version_no = ?')
    .bind(project.id, version)
    .first()
  if (!exists) return c.json({ error: '要发布的版本不存在' }, 404)
  await c.env.DB
    .prepare("UPDATE projects SET status = 'published', published_version = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(version, project.id)
    .run()
  const url = new URL(`/s/${project.slug}`, c.req.url).toString()
  return c.json({ slug: project.slug, url, published_version: version })
})

/** 下线:撤回公开发布页;版本、源码、数据全部保留,随时可再次发布(status 回到 draft 后 /s/:slug 返回 404) */
app.post('/:id/unpublish', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  if (project.status === 'published') {
    await c.env.DB
      .prepare("UPDATE projects SET status = 'draft', updated_at = datetime('now') WHERE id = ?")
      .bind(project.id)
      .run()
  }
  return c.json({ ok: true, status: 'draft', slug: project.slug })
})

// ---------- 项目级键值(KV)与对象存储(R2):owner 在「数据」里查看/管理,按项目 + 环境隔离 ----------

/** 从查询串解析数据环境(缺省 live);非法返回 null */
function dataEnvOf(c: Context<AppEnv>): DataEnv | null {
  const env = c.req.query('env') ?? 'live'
  return env === 'draft' || env === 'live' ? env : null
}

/** 列出某环境下项目 KV 的全部键(owner 视角,键名去掉内部前缀) */
app.get('/:id/kv', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const env = dataEnvOf(c)
  if (!env) return c.json({ error: '参数不合法' }, 400)
  const prefix = kvPrefix(project.id, env)
  const listed = await c.env.APPDATA.list({ prefix, cursor: c.req.query('cursor') || undefined, limit: 1000 })
  return c.json({
    keys: listed.keys.map((k) => ({ key: k.name.slice(prefix.length), expiration: k.expiration ?? null })),
    cursor: listed.list_complete ? null : listed.cursor ?? null,
  })
})

/** 读取某个 KV 键的值(值以 JSON 解析,失败则原样返回文本) */
app.get('/:id/kv/:key', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const env = dataEnvOf(c)
  if (!env) return c.json({ error: '参数不合法' }, 400)
  const key = c.req.param('key')
  if (!KV_KEY_RE.test(key)) return c.json({ error: '键名不合法' }, 400)
  const raw = await c.env.APPDATA.get(kvKey(project.id, env, key))
  if (raw === null) return c.json({ key, exists: false, value: null })
  let value: unknown = raw
  try {
    value = JSON.parse(raw)
  } catch {
    // 非 JSON 值原样返回
  }
  return c.json({ key, exists: true, value })
})

/** 写入/覆盖某个 KV 键(值必须是 JSON) */
app.put('/:id/kv/:key', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const env = dataEnvOf(c)
  if (!env) return c.json({ error: '参数不合法' }, 400)
  const key = c.req.param('key')
  if (!KV_KEY_RE.test(key)) return c.json({ error: '键名不合法' }, 400)
  const body = await c.req.json<{ value?: unknown }>().catch(() => null)
  if (!body || !('value' in body)) return c.json({ error: '缺少 value' }, 400)
  await c.env.APPDATA.put(kvKey(project.id, env, key), JSON.stringify(body.value))
  return c.json({ ok: true })
})

/** 删除某个 KV 键 */
app.delete('/:id/kv/:key', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const env = dataEnvOf(c)
  if (!env) return c.json({ error: '参数不合法' }, 400)
  const key = c.req.param('key')
  if (!KV_KEY_RE.test(key)) return c.json({ error: '键名不合法' }, 400)
  await c.env.APPDATA.delete(kvKey(project.id, env, key))
  return c.json({ ok: true })
})

/** 列出某环境下项目 R2 的全部对象(owner 视角,键名去掉内部前缀) */
app.get('/:id/blob', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const env = dataEnvOf(c)
  if (!env) return c.json({ error: '参数不合法' }, 400)
  const prefix = blobPrefix(project.id, env)
  const listed = await c.env.ARTIFACTS.list({ prefix, cursor: c.req.query('cursor') || undefined, limit: 1000 })
  return c.json({
    objects: listed.objects.map((o) => ({ key: o.key.slice(prefix.length), size: o.size, uploaded: o.uploaded.toISOString() })),
    cursor: listed.truncated ? listed.cursor ?? null : null,
  })
})

/** 读取某对象内容(图片等可直接内联预览;download=1 时作为附件下载) */
app.get('/:id/blob/content', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const env = dataEnvOf(c)
  if (!env) return c.json({ error: '参数不合法' }, 400)
  const key = c.req.query('key') ?? ''
  if (!BLOB_KEY_RE.test(key) || key.includes('..')) return c.json({ error: '路径不合法' }, 400)
  const obj = await c.env.ARTIFACTS.get(blobKey(project.id, env, key))
  if (!obj) return c.json({ error: '对象不存在' }, 404)
  const filename = key.split('/').pop() ?? 'download'
  const headers: Record<string, string> = {
    'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  }
  if (c.req.query('download') === '1') headers['Content-Disposition'] = `attachment; filename="${filename.replace(/"/g, '')}"`
  return new Response(obj.body, { headers })
})

/** 上传/覆盖某对象(owner 在控制台上传文件;上限 2MB,与生成应用接口一致) */
app.put('/:id/blob/content', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const env = dataEnvOf(c)
  if (!env) return c.json({ error: '参数不合法' }, 400)
  const key = c.req.query('key') ?? ''
  if (!BLOB_KEY_RE.test(key) || key.includes('..')) return c.json({ error: '路径不合法' }, 400)
  const buf = await c.req.arrayBuffer()
  if (buf.byteLength > 2 * 1024 * 1024) return c.json({ error: '对象过大(上限 2MB)' }, 413)
  await c.env.ARTIFACTS.put(blobKey(project.id, env, key), buf, {
    httpMetadata: { contentType: c.req.header('Content-Type') ?? 'application/octet-stream' },
  })
  return c.json({ ok: true, size: buf.byteLength })
})

/** 删除某个对象 */
app.delete('/:id/blob/content', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const env = dataEnvOf(c)
  if (!env) return c.json({ error: '参数不合法' }, 400)
  const key = c.req.query('key') ?? ''
  if (!BLOB_KEY_RE.test(key) || key.includes('..')) return c.json({ error: '路径不合法' }, 400)
  await c.env.ARTIFACTS.delete(blobKey(project.id, env, key))
  return c.json({ ok: true })
})

// ---------- owner SQL 控制台:在项目该环境的独立 SQLite 上执行任意 SQL(建表/建索引/查询) ----------

/**
 * 执行任意 SQL(仅 owner)。库按「项目 × 环境」物理隔离(每项目每环境一个 Durable Object),
 * 所以这里不做语句白名单——用户能动的只有自己项目、自己环境的库,碰不到别的项目/别的环境。
 */
app.post('/:id/sql', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const env = dataEnvOf(c)
  if (!env) return c.json({ error: '参数不合法' }, 400)
  const body = await c.req.json<{ sql?: string; params?: SqlStorageValue[] }>().catch(() => null)
  const sql = String(body?.sql ?? '').trim()
  if (!sql) return c.json({ error: 'SQL 不能为空' }, 400)
  if (sql.length > 100_000) return c.json({ error: 'SQL 过长' }, 413)
  const started = Date.now()
  try {
    const result = await runProjectSql(c.env, project.id, env, sql, body?.params ?? [])
    return c.json({ ...result, durationMs: Date.now() - started })
  } catch (err) {
    return c.json({ error: (err as Error).message || 'SQL 执行失败' }, 400)
  }
})

/** 列出该环境 SQLite 里的表/索引/视图(含表行数),供控制台侧栏 */
app.get('/:id/schema', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const env = dataEnvOf(c)
  if (!env) return c.json({ error: '参数不合法' }, 400)
  const objects = await projectSchema(c.env, project.id, env)
  return c.json({ objects })
})

export const projectRoutes = app
