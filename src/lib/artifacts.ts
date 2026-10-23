/**
 * 多文件产物:构建产物(dist)存 R2,按项目/版本隔离;负责读写、按路径服务、以及预览令牌签发。
 * 源码树存在 D1 的 versions.src_json(体量小、chat 复用方便),本模块只管构建产物。
 */

import type { Env } from '../types'

const encoder = new TextEncoder()

/**
 * 草稿(工作副本)在 versions 表中固定使用的版本号:始终为 0。
 * 生成/对话都写这一行,可被反复覆盖,不产生正式版本;用户「生成新版本」时才快照为 version_no >= 1 的正式版本。
 */
export const DRAFT_VERSION_NO = 0

export function artifactPrefix(projectId: string, versionNo: number): string {
  return `p/${projectId}/v/${versionNo}/`
}

/** 构建产物的总前缀(项目级,删除时按此前缀清理) */
export function projectArtifactPrefix(projectId: string): string {
  return `p/${projectId}/`
}

/** 归一化产物路径:去掉前导斜杠,拒绝向上越级 */
export function normalizeAssetPath(path: string): string | null {
  const p = path.replace(/^\/+/, '')
  if (p.includes('..')) return null
  return p
}

/** 写入一次构建的全部产物,返回总字节数 */
export async function putArtifacts(env: Env, projectId: string, versionNo: number, dist: Record<string, string>): Promise<number> {
  const prefix = artifactPrefix(projectId, versionNo)
  let bytes = 0
  await Promise.all(
    Object.entries(dist).map(async ([path, content]) => {
      const p = normalizeAssetPath(path)
      if (!p) return
      const body = encoder.encode(content)
      bytes += body.byteLength
      await env.ARTIFACTS.put(prefix + p, body, { httpMetadata: { contentType: contentTypeFor(p) } })
    }),
  )
  return bytes
}

export async function deleteProjectArtifacts(env: Env, projectId: string): Promise<void> {
  const prefix = projectArtifactPrefix(projectId)
  let cursor: string | undefined
  for (;;) {
    const listed = await env.ARTIFACTS.list({ prefix, cursor })
    if (listed.objects.length) await env.ARTIFACTS.delete(listed.objects.map((o) => o.key))
    if (!listed.truncated) break
    cursor = listed.cursor
  }
}

/** 清空某版本的全部产物:草稿(version_no=0)每次覆盖前调用,避免上一轮删掉的文件残留在预览里 */
export async function clearArtifacts(env: Env, projectId: string, versionNo: number): Promise<void> {
  const prefix = artifactPrefix(projectId, versionNo)
  let cursor: string | undefined
  for (;;) {
    const listed = await env.ARTIFACTS.list({ prefix, cursor })
    if (listed.objects.length) await env.ARTIFACTS.delete(listed.objects.map((o) => o.key))
    if (!listed.truncated) break
    cursor = listed.cursor
  }
}

/** 整树复制某版本的产物到另一版本(草稿 → 正式版本时用),返回复制的总字节数;不改动源 */
export async function copyArtifacts(env: Env, projectId: string, fromNo: number, toNo: number): Promise<number> {
  return copyArtifactsAcross(env, projectId, fromNo, projectId, toNo)
}

/**
 * 跨项目整树复制构建产物(精选案例 → 用户克隆出的新项目)。
 * R2 的 Worker 绑定没有服务端 copy,只能逐个 get + put;返回实际复制的总字节数。
 */
export async function copyArtifactsAcross(
  env: Env,
  fromProjectId: string,
  fromNo: number,
  toProjectId: string,
  toNo: number,
): Promise<number> {
  const from = artifactPrefix(fromProjectId, fromNo)
  const to = artifactPrefix(toProjectId, toNo)
  let bytes = 0
  let cursor: string | undefined
  for (;;) {
    const listed = await env.ARTIFACTS.list({ prefix: from, cursor })
    for (const o of listed.objects) {
      const obj = await env.ARTIFACTS.get(o.key)
      if (!obj) continue
      const body = await obj.arrayBuffer()
      bytes += body.byteLength
      await env.ARTIFACTS.put(to + o.key.slice(from.length), body, { httpMetadata: obj.httpMetadata })
    }
    if (!listed.truncated) break
    cursor = listed.cursor
  }
  return bytes
}

export function contentTypeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const map: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    ico: 'image/x-icon',
    woff2: 'font/woff2',
    woff: 'font/woff',
    txt: 'text/plain; charset=utf-8',
    map: 'application/json; charset=utf-8',
  }
  return map[ext] ?? 'application/octet-stream'
}

/** 草稿预览角标:固定在左下角的高 z-index 胶囊,pointer-events:none 不挡交互。
 *  跟随页面本体下发,因此无论内嵌 iframe、新标签打开还是分享出去的测试链接,都能一眼看出「这是测试环境」。 */
const ENV_BADGE =
  '<div aria-hidden="true" style="position:fixed;left:12px;bottom:12px;z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;background:rgba(217,119,6,.95);color:#fff;font:600 12px/1 -apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;letter-spacing:.02em;box-shadow:0 2px 10px rgba(0,0,0,.35)">' +
  '<span style="width:6px;height:6px;border-radius:999px;background:#fff;opacity:.9"></span>测试环境 · 草稿预览</div>'

/** 把角标插到 </body> 前;无 body 时追加到结尾 */
function injectEnvBadge(html: string): string {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${ENV_BADGE}</body>`)
  return html + ENV_BADGE
}

/** 转义 HTML 文本节点,避免应用名里的 & < > 破坏文档 */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 用应用名（projects.name，由 plan.name 落库）替换 index.html 的 <title>。模板 index.html 是平台文件、
 *  模型不可改，所以浏览器标签标题统一由平台在下发时注入；没有名字时保持模板原样。 */
function injectTitle(html: string, title: string): string {
  const tag = `<title>${escapeText(title)}</title>`
  if (/<title>[\s\S]*?<\/title>/i.test(html)) return html.replace(/<title>[\s\S]*?<\/title>/i, tag)
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tag}</head>`)
  return tag + html
}

/** JSON 序列化后转义 '<',避免值里的 </script> 提前闭合脚本标签(连接器的 public 值来自用户输入) */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/**
 * 给入口 HTML 注入运行时数据接口基址与数据环境:
 *   <script>window.__FORGE_API_BASE__="…/api";window.__FORGE_ENV__="draft"|"live"
 *     [;window.__FORGE_CONNECTORS__={ ga4:{measurementId:"G-XXXX"} }]</script>
 * 生成页里的 forge SDK 读该全局变量调用平台后端,无需在构建期替换占位符。
 * 连接器只下发 provider 定义里标了 public 的非密值(见 src/lib/connectors/store.ts 的 publicConfig);
 * 凭证永不下发。没有可用连接器时不注入该全局,产物逐字节与从前一致。
 * 草稿(draft)预览额外注入「测试环境」角标,与线上公开页(live)明确区分。
 * 传入 title 时同时替换浏览器标签标题(生成应用共用同一份平台 index.html)。
 */
export function injectRuntime(
  html: string,
  apiBase: string,
  dataEnv: 'draft' | 'live',
  title?: string | null,
  connectors?: Record<string, Record<string, string>> | null
): string {
  let script = `window.__FORGE_API_BASE__=${JSON.stringify(apiBase)};window.__FORGE_ENV__=${JSON.stringify(dataEnv)}`
  if (connectors && Object.keys(connectors).length) {
    script += `;window.__FORGE_CONNECTORS__=${safeJson(connectors)}`
  }
  const tag = `<script>${script}</script>`
  let out = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${tag}`) : tag + html
  if (title && title.trim()) out = injectTitle(out, title.trim().slice(0, 60))
  return dataEnv === 'draft' ? injectEnvBadge(out) : out
}

// ---------- 预览令牌(无状态 HMAC,绑定 projectId + versionNo) ----------

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`forge-preview-v1:${data}`))
  return toHex(new Uint8Array(sig))
}

export async function signPreviewToken(env: Env, projectId: string, versionNo: number): Promise<string> {
  return `${projectId}.${versionNo}.${await hmac(env.AGENT_SECRET, `${projectId}:${versionNo}`)}`
}

/** 校验预览令牌,返回定位信息;失败返回 null */
export async function verifyPreviewToken(env: Env, token: string): Promise<{ projectId: string; versionNo: number } | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [projectId, noStr, sig] = parts
  const versionNo = Number(noStr)
  // versionNo = 0 表示草稿(工作副本),允许签发与校验
  if (!projectId || !Number.isInteger(versionNo) || versionNo < 0) return null
  const expect = await hmac(env.AGENT_SECRET, `${projectId}:${versionNo}`)
  // 常量时间比较,避免时序侧信道
  if (expect.length !== sig.length) return null
  let diff = 0
  for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ sig.charCodeAt(i)
  return diff === 0 ? { projectId, versionNo } : null
}