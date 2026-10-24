/**
 * 生成应用的对外服务:
 *   /s/:slug/*    发布页(env=live):服务线上版本(published_version)的构建产物,并挂载后端数据 API
 *   /p/:token/*   草稿预览(env=draft):用签发的 HMAC 令牌定位项目+版本,无需 cookie
 * 产物本体在 R2;入口 HTML 注入 window.__FORGE_API_BASE__ 指向同源 /api 子路径。
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { ArtifactManifest, Env } from '../types'
import { CORS_HEADERS, handleAppApi } from '../lib/appdata'
import { artifactPrefix, contentTypeFor, injectRuntime, normalizeAssetPath, verifyPreviewToken } from '../lib/artifacts'
import { publicConfig } from '../lib/connectors/store'

const app = new Hono<{ Bindings: Env }>()

const SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-popups-to-escape-sandbox'

// 入口以 CSP sandbox 下发(无 allow-same-origin → opaque origin),页面自身发起的资源请求都是跨域:
// Vite 产物用 <script type="module" crossorigin> / <link crossorigin>,必须带 ACAO 才能加载,否则白屏。
const ASSET_CORS: Record<string, string> = { 'Access-Control-Allow-Origin': '*' }

async function manifestOf(env: Env, projectId: string, versionNo: number): Promise<ArtifactManifest | null> {
  const row = await env.DB
    .prepare('SELECT manifest_json FROM versions WHERE project_id = ? AND version_no = ?')
    .bind(projectId, versionNo)
    .first<{ manifest_json: string }>()
  if (!row) return null
  try {
    return JSON.parse(row.manifest_json) as ArtifactManifest
  } catch {
    return null
  }
}

/** 服务某个版本:subpath 为空或含扩展名 → 静态产物;以 api/ 开头 → 后端数据 API */
async function serve(c: Context<{ Bindings: Env }>, projectId: string, versionNo: number, dataEnv: 'draft' | 'live', apiBase: string, subpath: string, title?: string | null, lang: 'zh' | 'en' = 'zh'): Promise<Response> {
  const env = c.env
  if (subpath.startsWith('api/') || subpath === 'api') {
    if (c.req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
    return handleAppApi(env, projectId, dataEnv, subpath.slice(4), c.req.raw)
  }

  const manifest = await manifestOf(env, projectId, versionNo)
  if (!manifest) return c.text('404 Not Found', 404)
  const prefix = artifactPrefix(projectId, versionNo)
  const entry = manifest.entry || 'index.html'

  const clean = normalizeAssetPath(subpath)
  if (clean === null) return c.text('404 Not Found', 404)

  // 连接器的 public 配置(仅非密值)按「项目 × 环境」取;同一请求内只查一次,只在渲染 HTML 时用得上
  let connectorsPromise: Promise<Record<string, Record<string, string>>> | null = null
  const connectors = () => (connectorsPromise ??= publicConfig(env, projectId, dataEnv))

  const renderEntry = async (): Promise<Response | null> => {
    const obj = await env.ARTIFACTS.get(prefix + entry)
    if (!obj) return null
    const html = injectRuntime(await obj.text(), apiBase, dataEnv, title, await connectors(), lang)
    return new Response(html, {
      headers: {
        ...ASSET_CORS,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': SANDBOX_CSP,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    })
  }

  if (clean === '' || clean === entry) return (await renderEntry()) ?? c.text('404 Not Found', 404)

  const obj = await env.ARTIFACTS.get(prefix + clean)
  if (obj) {
    const isHtml = contentTypeFor(clean).startsWith('text/html')
    const body = isHtml ? injectRuntime(await obj.text(), apiBase, dataEnv, title, await connectors(), lang) : obj.body
    return new Response(body, {
      headers: {
        ...ASSET_CORS,
        'Content-Type': contentTypeFor(clean),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': clean.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
      },
    })
  }
  // SPA 兜底:未命中的路径回退到入口(生成应用用 hash 路由时通常用不到)
  return (await renderEntry()) ?? c.text('404 Not Found', 404)
}

/** 发布页:slug → 项目(仅 published)→ 当前版本。用 all:同一路径既服务静态产物(GET),
 *  又承载生成应用的后端数据 API(POST/PUT/DELETE/OPTIONS,见 api/ 子路径)。 */
app.get('/s/:slug', (c) => c.redirect(`${c.req.path}/`, 301))
app.all('/s/:slug/*', async (c) => {
  const slug = c.req.param('slug')
  const row = await c.env.DB
    .prepare("SELECT id, published_version, name FROM projects WHERE slug = ? AND status = 'published'")
    .bind(slug)
    .first<{ id: string; published_version: number; name: string }>()
  if (!row || row.published_version < 1) return c.text('404 Not Found', 404)
  const subpath = c.req.path.slice(`/s/${slug}/`.length)
  return serve(c, row.id, row.published_version, 'live', `/s/${slug}/api`, subpath, row.name)
})

/** 草稿预览:HMAC 令牌 → 项目+版本(同样 all,支持预览环境里的数据写入) */
app.get('/p/:token', (c) => c.redirect(`${c.req.path}/`, 301))
app.all('/p/:token/*', async (c) => {
  const token = c.req.param('token')
  const loc = await verifyPreviewToken(c.env, token)
  if (!loc) return c.text('404 Not Found', 404)
  const name = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(loc.projectId).first<{ name: string }>()
  const subpath = c.req.path.slice(`/p/${token}/`.length)
  // 预览页的平台角标按预览者的界面语言渲染(前端在 iframe 的 URL 上带 ?lang=)
  const lang = c.req.query('lang') === 'en' ? 'en' : 'zh'
  return serve(c, loc.projectId, loc.versionNo, 'draft', `/p/${token}/api`, subpath, name?.name, lang)
})

export const serveRoutes = app