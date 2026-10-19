/**
 * 连接器 · 账号级接口(见 docs/CONNECTORS.md §7/§8)。
 *
 *   GET    /api/connections                         可用 provider + 我已授权的连接
 *   GET    /api/connections/:provider/start         跳转外部授权页(带 state 防 CSRF)
 *   GET    /api/connections/:provider/callback      授权回调:换令牌、加密落库、绑定到项目
 *   POST   /api/connections/:provider/secret        自带密钥形态:粘贴密钥 → 加密落库 → 绑定到项目
 *   POST   /api/connections/:id/revoke              撤销(只改状态,项目绑定仍指向它)
 *
 * 项目级绑定与 A 类配置在 /api/projects/:id/connectors(见 routes/projectConnectors.ts)。
 * OAuth 的 state 处理与「登录」完全同一套路(state 随机数存 HttpOnly cookie,回调比对),
 * 所以回调的顶层跳转会带上会话 cookie(SameSite=Lax 允许顶层 GET 导航)。
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv, ProjectRow } from '../types'
import { isSecureRequest, newToken, requireUser } from '../lib/auth'
import { connectorRedirectUri, getProvider, oauthClient, providerProfile, listProviders, type ConnectorProvider } from '../lib/connectors/registry'
import {
  connectorsEnabled,
  listBindings,
  listConnections,
  parseConfig,
  requireKek,
  revokeConnection,
  saveConnection,
  setBinding,
} from '../lib/connectors/store'

const app = new Hono<AppEnv>()
app.use('*', requireUser)

const STATE_COOKIE = 'connector_state'
/** 授权跳转的往返窗口(秒):够用户登录并点「允许」 */
const STATE_TTL_SEC = 900

function readCookie(header: string | undefined, name: string): string | null {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(header ?? '')
  return m ? m[1] : null
}

function stateCookie(value: string, secure: boolean): string {
  const base = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
  return value
    ? `${STATE_COOKIE}=${value}; ${base}; Max-Age=${STATE_TTL_SEC}`
    : `${STATE_COOKIE}=; ${base}; Max-Age=0`
}

/** 回调地址:优先 PUBLIC_BASE_URL(必须与外部控制台登记的完全一致,见 registry 的说明) */
const redirectUri = connectorRedirectUri

async function ownedProject(c: Context<AppEnv>, id: string): Promise<ProjectRow | null> {
  return c.env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .bind(id, c.get('user').id)
    .first<ProjectRow>()
}

function dataEnvOf(raw: string | undefined): 'draft' | 'live' {
  return raw === 'draft' ? 'draft' : 'live'
}

/**
 * 授权跳转时把用户在卡片里填的**非密配置**一并带过去(base64url(JSON),塞进 state)。
 *
 * 为什么要带:OAuth 形态下用户会在卡片里同时填 `propertyId` 这类必填配置,然后才点「前往授权」。
 * 配置不跟着走的话,回调只能绑 `connectionId` —— 用户回来还是"缺必填配置",仍要被支使去面板。
 * 只收 provider 声明过的键(与 PUT /connectors 同一套白名单),值一律转字符串;
 * 解不开 / 超长 / 格式不对一律当空,绝不因为一个坏参数打断授权流程。
 */
function decodeConfigParam(raw: string, provider: ConnectorProvider): Record<string, string> {
  if (!raw || raw.length > 2048) return {}
  try {
    const bin = atob(raw.replace(/-/g, '+').replace(/_/g, '/'))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const allowed = new Set(provider.configFields.map((f) => f.key))
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!allowed.has(k) || v === undefined || v === null) continue
      out[k] = String(v).trim()
    }
    return out
  } catch {
    return {}
  }
}

/** 出问题一律回工作台带可读原因,而不是把 JSON 错误甩给用户 */
function backToWorkspace(c: Context<AppEnv>, projectId: string, key: 'connector_error' | 'connected', value: string) {
  return c.redirect(projectId ? `/workspace/${projectId}?${key}=${encodeURIComponent(value)}` : `/projects?${key}=${encodeURIComponent(value)}`)
}

/** 可用 provider + 我的连接(凭证永不出库,响应里只有元信息) */
app.get('/', async (c) => {
  const profiles = listProviders().map((p) => providerProfile(p, c.env, connectorRedirectUri(c.env, p.id, c.req.url)))
  if (!connectorsEnabled(c.env)) {
    return c.json({ enabled: false, reason: '未配置 CONNECTOR_KEK', providers: profiles, connections: [] })
  }
  const rows = await listConnections(c.env.DB, c.get('user').id)
  return c.json({
    enabled: true,
    providers: profiles,
    connections: rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      accountLabel: r.account_label,
      scopes: r.scopes.split(' ').filter(Boolean),
      status: r.status,
      createdAt: r.created_at,
    })),
  })
})

/** 开始授权:校验项目归属 → 生成 state(随机数进 cookie,projectId/env 走 state 透传)→ 跳外部授权页 */
app.get('/:provider/start', async (c) => {
  const provider = getProvider(c.req.param('provider'))
  if (!provider) return c.json({ error: '未知的连接器' }, 404)
  if (!provider.oauth) return c.json({ error: '该连接器不需要授权,直接填配置即可' }, 400)
  if (!connectorsEnabled(c.env)) return c.json({ error: '未配置 CONNECTOR_KEK,连接器不可用' }, 400)
  const client = oauthClient(c.env, provider)
  if (!client) return c.json({ error: `未配置 ${provider.name} 的 OAuth 客户端` }, 400)

  const projectId = c.req.query('projectId') ?? ''
  const project = projectId ? await ownedProject(c, projectId) : null
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const dataEnv = dataEnvOf(c.req.query('env'))

  const random = newToken()
  const url = new URL(provider.oauth.authorizeUrl)
  url.searchParams.set('client_id', client.clientId)
  url.searchParams.set('redirect_uri', redirectUri(c.env, provider.id, c.req.url))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', provider.scopes.join(' '))
  // state = 随机数 ~ projectId ~ env ~ 非密配置(base64url);随机数存 cookie,回调时比对
  url.searchParams.set('state', `${random}~${project.id}~${dataEnv}~${c.req.query('config') ?? ''}`)
  for (const [k, v] of Object.entries(provider.oauth.authParams ?? {})) url.searchParams.set(k, v)

  c.header('Set-Cookie', stateCookie(random, isSecureRequest(c.req.url)))
  return c.redirect(url.toString())
})

/** 授权回调:换令牌 → 取账号标识 → 加密落库 → 把该 provider 绑到项目(该环境) */
app.get('/:provider/callback', async (c) => {
  const provider = getProvider(c.req.param('provider'))
  const secure = isSecureRequest(c.req.url)
  const state = c.req.query('state') ?? ''
  const [random, projectId = '', envRaw = 'live', configB64 = ''] = state.split('~')
  const dataEnv = dataEnvOf(envRaw)

  const fail = (msg: string) => {
    c.header('Set-Cookie', stateCookie('', secure))
    return backToWorkspace(c, projectId, 'connector_error', msg)
  }

  if (!provider?.oauth) return fail('未知的连接器')
  const client = oauthClient(c.env, provider)
  if (!client) return fail(`未配置 ${provider.name} 的 OAuth 客户端`)
  if (c.req.query('error')) return fail('已取消授权')
  const code = c.req.query('code')
  const cookieState = readCookie(c.req.header('Cookie'), STATE_COOKIE)
  if (!code || !random || !cookieState || random !== cookieState) return fail('授权校验失败,请重试')

  const user = c.get('user')
  const project = projectId ? await ownedProject(c, projectId) : null
  if (!project) return fail('项目不存在')

  const tokenRes = await fetch(provider.oauth.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirectUri(c.env, provider.id, c.req.url),
      grant_type: 'authorization_code',
    }),
  }).catch(() => null)
  if (!tokenRes) return fail('无法连接上游服务,请稍后重试')
  if (!tokenRes.ok) return fail('令牌交换失败,请重试')

  const token = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }
  if (!token.access_token) return fail('上游未返回访问令牌')

  const credentials: Record<string, string> = { accessToken: token.access_token }
  if (token.refresh_token) credentials.refreshToken = token.refresh_token
  if (token.expires_in) credentials.expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString()

  const accountLabel = (await provider.oauth.fetchAccountLabel(token.access_token).catch(() => null)) ?? user.email
  const scopes = (token.scope ?? provider.scopes.join(' ')).split(' ').filter(Boolean)

  try {
    requireKek(c.env)
    const row = await saveConnection(c.env, user.id, provider.id, credentials, accountLabel, scopes)
    // 授权完直接绑到刚才那个项目的那个环境 —— 用户点「连接」的语义就是"这个项目要用它"。
    // 配置与已有绑定合并(而不是整体覆盖):换账号重授权不该把之前填好的 propertyId 抹掉。
    const existing = await listBindings(c.env.DB, project.id, dataEnv)
    const prev = parseConfig(existing.find((b) => b.provider === provider.id)?.config_json)
    await setBinding(c.env.DB, project.id, provider.id, dataEnv, {
      ...prev,
      ...decodeConfigParam(configB64, provider),
      connectionId: row.id,
    })
  } catch (err) {
    return fail((err as Error).message || '保存连接失败')
  }

  c.header('Set-Cookie', stateCookie('', secure))
  return backToWorkspace(c, project.id, 'connected', provider.id)
})

/**
 * 自带密钥形态:用户在面板里粘贴第三方控制台生成的密钥。
 *
 * 这是长尾 provider **唯一可扩展**的路径:平台不去外部登记 OAuth 客户端/回调地址、不走审批,
 * 只负责「加密存储 + 生成期下发 + 用完即弃」。与 OAuth 回调用同一张表、同一套 crypto,
 * 区别只是凭证从「上游换来的 token」变成「用户贴进来的 key」,所以**不改 schema**。
 *
 * 语义与回调一致:上传即绑定到(project, env)。同一 (user, provider, name) 再传 = 覆盖轮换。
 */
app.post('/:provider/secret', async (c) => {
  const provider = getProvider(c.req.param('provider'))
  if (!provider) return c.json({ error: '未知的连接器' }, 404)
  if (provider.auth !== 'apikey') return c.json({ error: '该连接器不接受密钥上传' }, 400)
  if (!connectorsEnabled(c.env)) return c.json({ error: '未配置 CONNECTOR_KEK,连接器不可用' }, 400)
  const fields = provider.secretInputs ?? []
  if (!fields.length) return c.json({ error: '该连接器未定义密钥项' }, 400)

  const body = await c.req
    .json<{ projectId?: string; env?: string; name?: string; secrets?: Record<string, unknown>; config?: Record<string, unknown> }>()
    .catch(() => null)
  const project = body?.projectId ? await ownedProject(c, body.projectId) : null
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const dataEnv = dataEnvOf(body?.env)

  // 只接受 provider 声明过的密钥键;缺必填项直接拒绝(不落半截凭证)
  const secrets: Record<string, string> = {}
  for (const field of fields) {
    const raw = body?.secrets?.[field.key]
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (!value) {
      if (field.required) return c.json({ error: `请填写「${field.label}」` }, 400)
      continue
    }
    secrets[field.key] = value
  }
  if (!Object.keys(secrets).length) return c.json({ error: '没有可保存的密钥' }, 400)

  // 名称用于区分同一 provider 的多套密钥(如 test / live);不填就用 provider 名 → 再传即覆盖
  const name = (body?.name ?? '').trim().slice(0, 60) || provider.name

  try {
    const row = await saveConnection(c.env, c.get('user').id, provider.id, secrets, name, [])
    // 非密配置一并写入(与项目级 PUT 同一套白名单),并把本环境绑到这个连接
    const allowed = new Set(provider.configFields.map((f) => f.key))
    const config: Record<string, string> = {}
    for (const [k, v] of Object.entries(body?.config ?? {})) {
      if (!allowed.has(k) || v === undefined || v === null) continue
      config[k] = String(v).trim()
    }
    const existing = await listBindings(c.env.DB, project.id, dataEnv)
    const prev = parseConfig(existing.find((b) => b.provider === provider.id)?.config_json)
    await setBinding(c.env.DB, project.id, provider.id, dataEnv, { ...prev, ...config, connectionId: row.id })
    return c.json({ ok: true, connectionId: row.id, accountLabel: name, env: dataEnv })
  } catch (err) {
    return c.json({ error: (err as Error).message || '保存密钥失败' }, 400)
  }
})

/** 撤销连接:只改状态。项目绑定仍指向它,面板上显示「已撤销」并提示重新授权 */
app.post('/:id/revoke', async (c) => {
  const ok = await revokeConnection(c.env.DB, c.get('user').id, c.req.param('id'))
  if (!ok) return c.json({ error: '连接不存在' }, 404)
  return c.json({ ok: true })
})

export const connectionRoutes = app
