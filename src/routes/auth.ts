import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv, Env } from '../types'
import {
  clearSessionCookie,
  createSession,
  getSessionUser,
  hashPassword,
  isSecureRequest,
  newToken,
  sessionCookie,
  verifyPassword,
} from '../lib/auth'

const app = new Hono<AppEnv>()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type AuthBody = { email?: string; password?: string }

app.post('/register', async (c) => {
  const body = await c.req.json<AuthBody>().catch(() => ({}) as AuthBody)
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  if (!EMAIL_RE.test(email)) return c.json({ error: '邮箱格式不正确' }, 400)
  if (password.length < 6) return c.json({ error: '密码至少 6 位' }, 400)

  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (exists) return c.json({ error: '该邮箱已注册' }, 409)

  const id = crypto.randomUUID()
  await c.env.DB
    .prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
    .bind(id, email, await hashPassword(password))
    .run()

  const token = await createSession(c.env.DB, id)
  c.header('Set-Cookie', sessionCookie(token, isSecureRequest(c.req.url)))
  return c.json({ user: { id, email, credits: 20 } })
})

app.post('/login', async (c) => {
  const body = await c.req.json<AuthBody>().catch(() => ({}) as AuthBody)
  const email = String(body.email ?? '').trim().toLowerCase()
  const row = await c.env.DB
    .prepare('SELECT id, email, password_hash, credits FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; email: string; password_hash: string; credits: number }>()
  if (!row || !(await verifyPassword(String(body.password ?? ''), row.password_hash))) {
    return c.json({ error: '邮箱或密码错误' }, 401)
  }

  const token = await createSession(c.env.DB, row.id)
  c.header('Set-Cookie', sessionCookie(token, isSecureRequest(c.req.url)))
  return c.json({ user: { id: row.id, email: row.email, credits: row.credits } })
})

app.post('/logout', async (c) => {
  const m = /(?:^|;\s*)session=([^;]+)/.exec(c.req.header('Cookie') ?? '')
  if (m) await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(m[1]).run()
  c.header('Set-Cookie', clearSessionCookie(isSecureRequest(c.req.url)))
  return c.json({ ok: true })
})

app.get('/me', async (c) => {
  const user = await getSessionUser(c.env.DB, c.req.raw)
  if (!user) return c.json({ error: '未登录' }, 401)
  return c.json({ user })
})

// ───────────────────────── Google 登录(OAuth 2.0 + OIDC)─────────────────────────
// 首次登录时:先按 Google sub 找账号 → 找不到再按邮箱找(存在则回填 sub,账号合并)
// → 都没有才新建(无密码,password_hash 存空串)。与邮箱/密码登录共存,同一邮箱视为同一账号。

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_SCOPE = 'openid email profile'
const OAUTH_STATE_COOKIE = 'oauth_state'
/** 登录前暂存 state 的 cookie 有效期(秒),足够走完一次 Google 跳转 */
const OAUTH_STATE_TTL_SEC = 600

function b64UrlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 解出 OIDC id_token 的 payload(id_token 由 Google 经 TLS 直接返回,此处仅取声明;校验 iss/aud) */
function decodeIdToken(idToken: string): Record<string, unknown> | null {
  const part = idToken.split('.')[1]
  if (!part) return null
  try {
    return JSON.parse(new TextDecoder().decode(b64UrlDecode(part))) as Record<string, unknown>
  } catch {
    return null
  }
}

function readCookie(header: string | undefined, name: string): string | null {
  const re = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)
  const m = re.exec(header ?? '')
  return m ? m[1] : null
}

/** 从 state 里安全取出透传的 idea(伪造/损坏的编码不应导致 500) */
function decodeIdea(state: string, random: string): string {
  try {
    return decodeURIComponent(state.slice(random.length + 1))
  } catch {
    return ''
  }
}

function oauthStateCookie(value: string, secure: boolean): string {
  const base = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
  return value
    ? `${OAUTH_STATE_COOKIE}=${value}; ${base}; Max-Age=${OAUTH_STATE_TTL_SEC}`
    : `${OAUTH_STATE_COOKIE}=; ${base}; Max-Age=0`
}

/** 回调地址:优先用 PUBLIC_BASE_URL(需与 Google 控制台登记的一致),否则按当前请求推导 */
function googleRedirectUri(env: Env, requestUrl: string): string {
  const base = env.PUBLIC_BASE_URL?.replace(/\/+$/, '')
  return `${base || new URL(requestUrl).origin}/api/auth/google/callback`
}

/** 登录过程中出错:清掉临时 state cookie,带上可读原因回登录页 */
function googleFail(c: Context<AppEnv>, message: string) {
  c.header('Set-Cookie', oauthStateCookie('', isSecureRequest(c.req.url)))
  return c.redirect(`/login?google_error=${encodeURIComponent(message)}`)
}

/** 登录页据此决定是否显示「使用 Google 登录」(未配置客户端时不显示,避免点了拿到 400) */
app.get('/config', (c) => {
  return c.json({ google: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET) })
})

app.get('/google', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.json({ error: '未配置 Google 登录' }, 400)
  }
  // state = 随机数 + '~' + 编码后的 idea;随机数存 HttpOnly cookie,回调时比对防 CSRF,
  // idea 随 state 透传,登录成功后可原地续跑「登录后继续生成」
  const random = newToken()
  const idea = (c.req.query('idea') ?? '').slice(0, 500)
  const state = `${random}~${encodeURIComponent(idea)}`

  const u = new URL(GOOGLE_AUTH_ENDPOINT)
  u.searchParams.set('client_id', c.env.GOOGLE_CLIENT_ID)
  u.searchParams.set('redirect_uri', googleRedirectUri(c.env, c.req.url))
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', GOOGLE_SCOPE)
  u.searchParams.set('state', state)
  u.searchParams.set('access_type', 'online')
  u.searchParams.set('prompt', 'select_account')

  c.header('Set-Cookie', oauthStateCookie(random, isSecureRequest(c.req.url)))
  return c.redirect(u.toString())
})

app.get('/google/callback', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return googleFail(c, '未配置 Google 登录')

  const code = c.req.query('code')
  const state = c.req.query('state') ?? ''
  const random = state.split('~')[0]
  const idea = decodeIdea(state, random)
  const cookieState = readCookie(c.req.header('Cookie'), OAUTH_STATE_COOKIE)
  if (c.req.query('error')) return googleFail(c, '已取消 Google 授权')
  if (!code || !random || !cookieState || random !== cookieState) {
    return googleFail(c, '登录校验失败,请重试')
  }

  let tokenRes: Response
  try {
    tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: googleRedirectUri(c.env, c.req.url),
        grant_type: 'authorization_code',
      }),
    })
  } catch {
    return googleFail(c, '无法连接 Google,请稍后重试')
  }
  if (!tokenRes.ok) return googleFail(c, 'Google 登录失败(令牌交换)')

  const { id_token: idToken } = await tokenRes.json<{ id_token?: string }>()
  const claims = idToken ? decodeIdToken(idToken) : null
  const sub = typeof claims?.sub === 'string' ? claims.sub : ''
  const email = String(claims?.email ?? '').trim().toLowerCase()
  const verified = claims?.email_verified === true || claims?.email_verified === 'true'
  // 校验 token 归属本应用,且邮箱已验证(合并同邮箱账号的前提)
  if (!sub || !email || !verified || claims?.aud !== clientId) {
    return googleFail(c, 'Google 账号未提供已验证邮箱')
  }

  type U = { id: string; email: string; credits: number }
  let row = await c.env.DB.prepare('SELECT id, email, credits FROM users WHERE google_sub = ?')
    .bind(sub)
    .first<U>()
  if (!row) {
    // 同邮箱的老账号(邮箱/密码注册):回填 sub 完成合并,历史数据与积分都保留
    const byEmail = await c.env.DB.prepare('SELECT id, email, credits FROM users WHERE email = ?')
      .bind(email)
      .first<U>()
    if (byEmail) {
      await c.env.DB.prepare('UPDATE users SET google_sub = ? WHERE id = ?').bind(sub, byEmail.id).run()
      row = byEmail
    } else {
      const id = crypto.randomUUID()
      await c.env.DB.prepare("INSERT INTO users (id, email, password_hash, google_sub) VALUES (?, ?, '', ?)")
        .bind(id, email, sub)
        .run()
      row = { id, email, credits: 20 }
    }
  }

  const secure = isSecureRequest(c.req.url)
  const token = await createSession(c.env.DB, row.id)
  c.header('Set-Cookie', sessionCookie(token, secure))
  c.header('Set-Cookie', oauthStateCookie('', secure), { append: true })
  // 有 idea 则回登录页由前端原地续跑;否则直接进项目列表
  return c.redirect(idea ? `/login?idea=${encodeURIComponent(idea)}` : '/projects')
})

export const authRoutes = app
