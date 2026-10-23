/**
 * 首页精选案例:公开只读列表 + 登录用户一键克隆。
 *
 * 只有后台勾选「上首页」且**已发布**的项目才会出现(featured = 1 且 status = 'published'
 * 且 published_version >= 1);下线/删除后列表与克隆接口都会立即失效,不需要额外清理。
 *
 * 克隆只复制「线上版本的源码树 + 构建产物」到新项目的草稿(version_no = 0):
 * 不复制站点数据、连接器、对话记录,也不扣积分(不调用模型,没有 Cloud Run 成本)。
 */

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireUser } from '../lib/auth'
import { copyArtifactsAcross, deleteProjectArtifacts, DRAFT_VERSION_NO } from '../lib/artifacts'
import { newUniqueSlug } from '../lib/slug'
import { splitShowcaseTags } from '../lib/showcase'
import { logEvent } from '../lib/events'

const app = new Hono<AppEnv>()

/** 首页一次最多展示多少个案例(卡片是静态列表,不做分页) */
const SHOWCASE_LIMIT = 12

interface ShowcaseRow {
  id: string
  slug: string
  name: string
  description: string
  featured_tags: string
  featured_at: string | null
  updated_at: string
}

/** 公开精选列表:不返回属主邮箱、对话、源码等任何非展示字段 */
app.get('/', async (c) => {
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, slug, name, description, featured_tags, featured_at, updated_at
         FROM projects
        WHERE featured = 1 AND status = 'published' AND published_version >= 1
        ORDER BY featured_at DESC, updated_at DESC
        LIMIT ${SHOWCASE_LIMIT}`
    )
    .all<ShowcaseRow>()
  return c.json({
    projects: results.map((p) => ({ ...p, tags: splitShowcaseTags(p.featured_tags) })),
  })
})

/**
 * 克隆精选案例:新建一个属于当前用户的项目,把线上版本的源码与构建产物放进它的草稿。
 * 工作区打开即有可预览的草稿,后续对话走 chat(以草稿为基线),不会重新 generate。
 * 先插项目行再复制产物:复制/写版本失败时把项目行与已写入的 R2 对象一起清掉。
 */
app.post('/:id/clone', requireUser, async (c) => {
  const source = await c.env.DB
    .prepare(
      `SELECT id, name, description, published_version
         FROM projects
        WHERE id = ? AND featured = 1 AND status = 'published' AND published_version >= 1`
    )
    .bind(c.req.param('id'))
    .first<{ id: string; name: string; description: string; published_version: number }>()
  if (!source) return c.json({ error: '项目不存在' }, 404)

  const version = await c.env.DB
    .prepare('SELECT src_json, manifest_json, bytes FROM versions WHERE project_id = ? AND version_no = ?')
    .bind(source.id, source.published_version)
    .first<{ src_json: string; manifest_json: string; bytes: number }>()
  if (!version) return c.json({ error: '版本不存在' }, 404)

  const id = crypto.randomUUID()
  const slug = await newUniqueSlug(c.env.DB)
  await c.env.DB
    .prepare('INSERT INTO projects (id, user_id, slug, name, description) VALUES (?, ?, ?, ?, ?)')
    .bind(id, c.get('user').id, slug, source.name, source.description)
    .run()

  try {
    const copied = await copyArtifactsAcross(c.env, source.id, source.published_version, id, DRAFT_VERSION_NO)
    let artifactFiles = 0
    try {
      artifactFiles = Number(JSON.parse(version.manifest_json)?.files?.length ?? 0)
    } catch {
      // 清单损坏:交给下面的产物校验兜底
    }
    if (!copied && artifactFiles > 0) throw new Error('构建产物复制失败')
    await c.env.DB
      .prepare(
        `INSERT INTO versions (id, project_id, version_no, src_json, manifest_json, bytes, prompt)
         VALUES (?, ?, ?, ?, ?, ?, '')`
      )
      .bind(crypto.randomUUID(), id, DRAFT_VERSION_NO, version.src_json, version.manifest_json, copied || version.bytes)
      .run()
  } catch (err) {
    await Promise.all([
      deleteProjectArtifacts(c.env, id).catch(() => {}),
      c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run().catch(() => {}),
    ])
    console.error(`[showcase] 克隆失败 ${source.id} -> ${id}: ${err instanceof Error ? err.message : String(err)}`)
    return c.json({ error: '克隆失败,请稍后重试' }, 500)
  }

  await logEvent(c.env.DB, c.get('user').id, 'project_create', { projectId: id, clonedFrom: source.id })
  return c.json({ id })
})

export const showcaseRoutes = app
