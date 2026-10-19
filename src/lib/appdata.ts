/**
 * 生成应用的后端数据 API(平台通用能力,非每项目手写):同一套端点同时覆盖
 *   - 文档集合: {base}/db/:collection          (留言板、表单、评论…;支持 limit/offset/order/q 分页搜索与 total 计数)
 *   - KV 键值:  {base}/kv/:key                 (配置、设置项…)
 *   - 原子计数: {base}/kv/:key/incr            (访问量、点赞…;落该项目的 SQLite,单条 UPDATE 保证并发不丢)
 *   - R2 对象:  {base}/blob/:key               (上传文件、图片…;GET {base}/blob?prefix= 列举)
 *
 * base 由页面注入的 window.__FORGE_API_BASE__ 决定:
 *   - 发布页:/s/{slug}/api      → env = live
 *   - 预览页:/p/{token}/api     → env = draft(与线上数据隔离)
 * 页面运行在 CSP sandbox 的 opaque origin(Origin: null),故所有响应带 ACAO:*;
 * 不读 session cookie。滥用靠大小 / 行数 / 频率上限约束。
 */

import type { Env } from '../types'
import { callProjectDb, destroyProjectDb } from './projectDb'

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export type DataEnv = 'draft' | 'live'

export const COLLECTION_RE = /^[a-z][a-z0-9_-]{0,31}$/
export const KV_KEY_RE = /^[A-Za-z0-9._-]{1,64}$/
export const BLOB_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/

const DB_MAX_BODY = 8 * 1024
const DB_MAX_ROWS = 500
const DB_RATE_LIMIT_WRITES = 20
const KV_MAX_VALUE = 25 * 1024
const BLOB_MAX_BODY = 2 * 1024 * 1024
/** 列举对象的单页上限(与 /db 的分页口径一致,防止一次拉爆 R2 Class A 操作) */
const BLOB_MAX_LIST = 500

/** 原子计数子资源后缀:GET|POST {base}/kv/:key/incr */
const INCR_SUFFIX = '/incr'

function cors(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS })
}

/**
 * 解析列表类接口的分页/搜索参数(limit / offset / order / q)。
 * 只回传「合法且非默认」的字段;非法值直接忽略,由 DO 侧再用同一套上限钳制一次。
 */
function listParams(url: URL): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const limit = Number(url.searchParams.get('limit'))
  if (Number.isFinite(limit) && limit > 0) out.limit = Math.trunc(limit)
  const offset = Number(url.searchParams.get('offset'))
  if (Number.isFinite(offset) && offset > 0) out.offset = Math.trunc(offset)
  if (url.searchParams.get('order') === 'asc') out.order = 'asc'
  const q = url.searchParams.get('q')?.trim()
  if (q) out.q = q.slice(0, 64)
  return out
}

/** 项目级 KV 存储键(owner 管理端与生成应用接口共用同一套,保证读到同一份数据) */
export function kvKey(projectId: string, env: DataEnv, key: string): string {
  return `p:${projectId}:${env}:${key}`
}

/** 项目级 R2 对象键(同上,owner 管理端与生成应用接口共用) */
export function blobKey(projectId: string, env: DataEnv, key: string): string {
  return `appdata/${projectId}/${env}/${key}`
}

/** 项目级 KV 前缀(列某环境下全部键用) */
export function kvPrefix(projectId: string, env: DataEnv): string {
  return `p:${projectId}:${env}:`
}

/** 项目级 R2 前缀(列某环境下全部对象用) */
export function blobPrefix(projectId: string, env: DataEnv): string {
  return `appdata/${projectId}/${env}/`
}

async function readJsonObject(request: Request): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: Response }> {
  const raw = await request.text()
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, response: cors({ error: '请求体必须是 JSON' }, 400) }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, response: cors({ error: '请求体必须是 JSON 对象' }, 400) }
  }
  return { ok: true, value: value as Record<string, unknown> }
}

/**
 * 生成应用的「文档」接口:list / create / update / delete。
 * HTTP 契约与旧版完全一致(集合 + JSON 文档行),但存储已从共享 D1 的 site_data
 * 迁到「每项目 × 每环境」的独立 SQLite(见 projectDb.ts),每个集合对应一张表。
 */
async function handleDb(env: Env, projectId: string, dataEnv: DataEnv, rest: string, request: Request): Promise<Response> {
  const [collection, id] = rest.split('/')
  if (!COLLECTION_RE.test(collection ?? '')) return cors({ error: '集合名不合法' }, 400)

  if (request.method === 'GET' && !id) {
    const { body } = await callProjectDb<{ items: unknown[] }>(env, projectId, dataEnv, 'db.list', {
      collection,
      ...listParams(new URL(request.url)),
    })
    return cors(body)
  }

  if (request.method === 'POST' && !id) {
    const raw = await request.text()
    if (raw.length > DB_MAX_BODY) return cors({ error: '提交内容过大' }, 413)
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return cors({ error: '请求体必须是 JSON' }, 400)
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return cors({ error: '提交内容必须是 JSON 对象' }, 400)

    const ip = request.headers.get('CF-Connecting-IP') ?? ''
    const res = await callProjectDb(env, projectId, dataEnv, 'db.add', {
      collection,
      data: body,
      clientIp: ip,
      rateLimit: DB_RATE_LIMIT_WRITES,
      maxRows: DB_MAX_ROWS,
    })
    return cors(res.body, res.status)
  }

  if ((request.method === 'PUT' || request.method === 'PATCH') && id) {
    const raw = await request.text()
    if (raw.length > DB_MAX_BODY) return cors({ error: '提交内容过大' }, 413)
    let patch: unknown
    try {
      patch = JSON.parse(raw)
    } catch {
      return cors({ error: '请求体必须是 JSON' }, 400)
    }
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return cors({ error: '提交内容必须是 JSON 对象' }, 400)

    const res = await callProjectDb(env, projectId, dataEnv, 'db.update', { collection, id, patch })
    return cors(res.body, res.status)
  }

  if (request.method === 'DELETE' && id) {
    const res = await callProjectDb(env, projectId, dataEnv, 'db.remove', { collection, id })
    return cors(res.body, res.status)
  }

  return cors({ error: '方法不支持' }, 405)
}

/**
 * KV 键值:GET / PUT / DELETE,外加原子计数子资源 `/kv/:key/incr`。
 *
 * 计数为什么单独一套存储:Workers KV 是「最终一致 + 每键每秒 1 次写」的存储,
 * 拿它做访问量/点赞这类高频自增会丢计数甚至被限流;所以 incr 落在该项目的
 * SQLite(Durable Object)里用单条 UPDATE 保证原子性,get 在 KV 无值时回落读它。
 * 键名允许 `.`/`-`/`_` 但不允许 `/`,所以 `/incr` 后缀不会与真实键名冲突。
 */
async function handleKv(env: Env, projectId: string, dataEnv: DataEnv, rest: string, request: Request): Promise<Response> {
  const isIncr = rest.endsWith(INCR_SUFFIX)
  const key = isIncr ? rest.slice(0, -INCR_SUFFIX.length) : rest
  if (!KV_KEY_RE.test(key)) return cors({ error: '键名不合法' }, 400)

  // 原子计数器:GET 读当前值,POST 自增
  if (isIncr) {
    if (request.method === 'GET') {
      const { body } = await callProjectDb<{ value: number | null }>(env, projectId, dataEnv, 'counter.get', { key })
      return cors({ key, value: body.value ?? 0 })
    }
    if (request.method === 'PUT' || request.method === 'POST') {
      const raw = await request.text()
      let opts: { by?: unknown; start?: unknown } = {}
      if (raw) {
        try {
          opts = JSON.parse(raw) as { by?: unknown; start?: unknown }
        } catch {
          return cors({ error: '请求体必须是 JSON' }, 400)
        }
      }
      const { body } = await callProjectDb<{ value: number }>(env, projectId, dataEnv, 'counter.incr', {
        key,
        by: opts.by ?? 1,
        start: opts.start ?? 0,
      })
      return cors({ key, value: body.value ?? 0 })
    }
    return cors({ error: '方法不支持' }, 405)
  }

  const full = kvKey(projectId, dataEnv, key)

  if (request.method === 'GET') {
    const value = await env.APPDATA.get(full, 'json')
    if (value !== null && value !== undefined) return cors({ key, value })
    // KV 无值:回落到计数器(否则 kv.get 读不到刚 incr 过的键)
    const counted = await callProjectDb<{ value: number | null }>(env, projectId, dataEnv, 'counter.get', { key })
    return cors({ key, value: counted.body.value })
  }
  if (request.method === 'PUT' || request.method === 'POST') {
    const raw = await request.text()
    if (raw.length > KV_MAX_VALUE) return cors({ error: '值过大' }, 413)
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      return cors({ error: '值必须是 JSON' }, 400)
    }
    await env.APPDATA.put(full, JSON.stringify(value))
    return cors({ ok: true })
  }
  if (request.method === 'DELETE') {
    await env.APPDATA.delete(full)
    return cors({ ok: true })
  }
  return cors({ error: '方法不支持' }, 405)
}

/**
 * 对象存储:R2 对象 GET / PUT / DELETE;`GET /blob?prefix=&limit=&cursor=` 列举。
 * 列举只返回该「项目 × 环境」前缀下的对象(键名去掉前缀,便于 `blob.url(key)` 直接回填)。
 */
async function handleBlob(env: Env, projectId: string, dataEnv: DataEnv, rest: string, request: Request): Promise<Response> {
  const root = blobPrefix(projectId, dataEnv)

  // 列举:路径为 /blob(无 key),仅支持 GET
  if (rest === '') {
    if (request.method !== 'GET') return cors({ error: '方法不支持' }, 405)
    const url = new URL(request.url)
    const prefix = (url.searchParams.get('prefix') ?? '').replace(/^\/+/, '')
    if (prefix.includes('..')) return cors({ error: '路径不合法' }, 400)
    const rawLimit = Number(url.searchParams.get('limit'))
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(BLOB_MAX_LIST, Math.trunc(rawLimit)) : 100
    const listed = await env.ARTIFACTS.list({
      prefix: root + prefix,
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit,
    })
    return cors({
      items: listed.objects.map((o) => ({
        key: o.key.slice(root.length),
        size: o.size,
        uploaded: o.uploaded instanceof Date ? o.uploaded.toISOString() : String(o.uploaded),
      })),
      cursor: listed.truncated ? listed.cursor : null,
      truncated: listed.truncated,
    })
  }

  const key = rest
  if (!BLOB_KEY_RE.test(key) || key.includes('..')) return cors({ error: '路径不合法' }, 400)
  const full = root + key

  if (request.method === 'GET') {
    const obj = await env.ARTIFACTS.get(full)
    if (!obj) return cors({ error: '对象不存在' }, 404)
    return new Response(obj.body, {
      headers: { ...CORS_HEADERS, 'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream' },
    })
  }
  if (request.method === 'PUT' || request.method === 'POST') {
    const buf = await request.arrayBuffer()
    if (buf.byteLength > BLOB_MAX_BODY) return cors({ error: '对象过大(上限 2MB)' }, 413)
    await env.ARTIFACTS.put(full, buf, {
      httpMetadata: { contentType: request.headers.get('Content-Type') ?? 'application/octet-stream' },
    })
    return cors({ ok: true, size: buf.byteLength })
  }
  if (request.method === 'DELETE') {
    await env.ARTIFACTS.delete(full)
    return cors({ ok: true })
  }
  return cors({ error: '方法不支持' }, 405)
}

/**
 * 分发:subpath 形如 `db/guestbook`、`kv/visits`、`blob/uploads/a.png`。
 * projectId 由调用方解析(slug 或预览 token),不信任客户端。
 */
export async function handleAppApi(env: Env, projectId: string, dataEnv: DataEnv, subpath: string, request: Request): Promise<Response> {
  const [kind, ...restParts] = subpath.split('/')
  const rest = restParts.join('/')
  switch (kind) {
    case 'db':
      return handleDb(env, projectId, dataEnv, rest, request)
    case 'kv':
      return handleKv(env, projectId, dataEnv, rest, request)
    case 'blob':
      return handleBlob(env, projectId, dataEnv, rest, request)
    default:
      return cors({ error: '接口不存在' }, 404)
  }
}

/**
 * 删除某项目在生成应用后端里的全部数据(KV 键 + R2 对象 + 两个环境的 SQLite 库);
 * 项目删除时调用,避免残留孤儿数据。
 */
export async function deleteProjectAppData(env: Env, projectId: string): Promise<void> {
  for (const dataEnv of ['draft', 'live'] as const) {
    const prefix = `p:${projectId}:${dataEnv}:`
    let cursor: string | undefined
    for (;;) {
      const listed = await env.APPDATA.list({ prefix, cursor })
      if (listed.keys.length) await Promise.all(listed.keys.map((k) => env.APPDATA.delete(k.name)))
      if (listed.list_complete) break
      cursor = listed.cursor
    }
  }
  let cursor: string | undefined
  const prefix = `appdata/${projectId}/`
  for (;;) {
    const listed = await env.ARTIFACTS.list({ prefix, cursor })
    if (listed.objects.length) await env.ARTIFACTS.delete(listed.objects.map((o) => o.key))
    if (!listed.truncated) break
    cursor = listed.cursor
  }
  await destroyProjectDb(env, projectId)
}