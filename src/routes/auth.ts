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
import { grantSignupCredits, grantSignupCreditsOnVerify, SIGNUP_CREDITS } from '../lib/credits'
import { hashToken, newVerificationToken, sendVerificationEmail, verificationUrl } from '../lib/email'
import { parseLang, type Lang } from '../lib/i18n'

const app = new Hono<AppEnv>()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 验证链接有效期:24 小时 */
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000
/** 同一账号重发冷却(只统计成功投递的邮件;投递失败允许立刻重试) */
const RESEND_COOLDOWN_SEC = 60
/** 同一账号 24 小时内最多成功投递几封验证邮件 */
const RESEND_DAILY_MAX = 5
/** 同一 IP 1 小时内最多触发几次验证邮件(含注册、重发;防批量注册刷信) */
const RESEND_IP_HOURLY_MAX = 20

type AuthBody = { email?: string; password?: string }
type RegisterBody = AuthBody & { idea?: string; lang?: string }
type ResendBody = AuthBody & { lang?: string }
type VerifyBody = { token?: string }

function clientIp(c: Context<AppEnv>): string {
  return c.req.header('CF-Connecting-IP') ?? ''
}

/** 同一 IP 最近 1 小时成功投递的验证邮件数(注册与重发共用一个额度) */
async function ipHourlySends(db: D1Database, ip: string): Promise<number> {
  if (!ip) return 0
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM email_verifications
       WHERE ip = ? AND sent = 1 AND created_at > datetime('now', '-1 hour')`
    )
    .bind(ip)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/**
 * 建一条验证 token 并发送邮件。返回是否成功交给 Resend。
 * 失败也**保留这条 token**(真发出去但超时的情况仍可点链接),只是 sent=0,
 * 前端据此提示「重发」且不受 60s 冷却限制。
 */
async function issueVerification(
  c: Context<AppEnv>,
  user: { id: string; email: string },
  idea: string,
  lang: Lang
): Promise<boolean> {
  const id = crypto.randomUUID()
  const token = newVerificationToken()
  const tokenHash = await hashToken(token)
  const expiresAt = new Date(Date.now() + VERIFY_TTL_MS).toISOString()
  await c.env.DB
    .prepare(
      `INSERT INTO email_verifications (id, user_id, token_hash, ip, idea, expires_at, sent)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
    )
    .bind(id, user.id, tokenHash, clientIp(c), idea, expiresAt)
    .run()

  const link = verificationUrl(c.env, c.req.url, token, idea)
  try {
    await sendVerificationEmail(c.env, user.email, link, lang)
    // 只有真的投递成功才让旧链接失效:发送失败时保留用户手里那张仍可用的旧邮件
    await c.env.DB
      .prepare('UPDATE email_verifications SET used_at = ? WHERE user_id = ? AND id <> ? AND used_at IS NULL')
      .bind(new Date().toISOString(), user.id, id)
      .run()
    await c.env.DB.prepare('UPDATE email_verifications SET sent = 1 WHERE id = ?').bind(id).run()
    return true
  } catch (err) {
    // 发信失败不阻断建号:账号已落库,用户可以稍后重发
    console.error('验证邮件发送失败', user.id, err)
    return false
  }
}

/** 邮箱验证通过后才真正发放注册积分(注册时 credits 是 0) */
async function verifyAndGrant(db: D1Database, userId: string): Promise<{ email: string; credits: number } | null> {
  const claimed = await db
    .prepare('UPDATE users SET email_verified = 1 WHERE id = ? AND email_verified = 0 RETURNING email, credits')
    .bind(userId)
    .first<{ email: string; credits: number }>()
  // 已经是 verified(例如先用 Google 登录过):不重复发积分,直接返回当前余额
  if (!claimed) {
    return db
      .prepare('SELECT email, credits FROM users WHERE id = ?')
      .bind(userId)
      .first<{ email: string; credits: number }>()
  }
  const credits = await grantSignupCreditsOnVerify(db, userId, SIGNUP_CREDITS)
  return { email: claimed.email, credits: credits || claimed.credits }
}


app.post('/register', async (c) => {
  const body = await c.req.json<RegisterBody>().catch(() => ({}) as RegisterBody)
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const idea = String(body.idea ?? '').slice(0, 500)
  const lang = parseLang(body.lang)
  if (!EMAIL_RE.test(email)) return c.json({ error: '邮箱格式不正确' }, 400)
  if (password.length < 6) return c.json({ error: '密码至少 6 位' }, 400)

  // 注册也要受 IP 额度约束,否则可以拿不同邮箱无限触发验证邮件
  if ((await ipHourlySends(c.env.DB, clientIp(c))) >= RESEND_IP_HOURLY_MAX) {
    return c.json({ error: '验证邮件发送过于频繁,请稍后再试', code: 'verify_too_frequent' }, 429)
  }

  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (exists) return c.json({ error: '该邮箱已注册' }, 409)

  const id = crypto.randomUUID()
  // 显式写 credits=0 与 email_verified=0:
  //   - 不靠 schema 的列默认值(老库改不动列默认,见 src/lib/credits.ts)
  //   - 注册不再预发积分/建会话,验证邮箱成功后才发放(见 /verify)
  try {
    await c.env.DB
      .prepare('INSERT INTO users (id, email, password_hash, credits, email_verified) VALUES (?, ?, ?, 0, 0)')
      .bind(id, email, await hashPassword(password))
      .run()
  } catch (err) {
    // 并发注册同一邮箱:唯一索引冲突按「已注册」处理;其他错误(如漏迁移)照常 500
    const raced = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
    if (raced) return c.json({ error: '该邮箱已注册' }, 409)
    throw err
  }

  const verificationSent = await issueVerification(c, { id, email }, idea, lang)
  return c.json({ user: { id, email, credits: 0 }, verificationSent })
})

app.post('/login', async (c) => {
  const body = await c.req.json<AuthBody>().catch(() => ({}) as AuthBody)
  const email = String(body.email ?? '').trim().toLowerCase()
  const row = await c.env.DB
    .prepare('SELECT id, email, password_hash, credits, email_verified FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; email: string; password_hash: string; credits: number; email_verified: number }>()
  // 先验密码再暴露「未验证」状态,避免只凭邮箱探测账号
  if (!row || !(await verifyPassword(String(body.password ?? ''), row.password_hash))) {
    return c.json({ error: '邮箱或密码错误' }, 401)
  }
  if (!row.email_verified) {
    return c.json({ error: '邮箱未验证,请先查收验证邮件', code: 'email_unverified' }, 403)
  }

  const token = await createSession(c.env.DB, row.id)
  c.header('Set-Cookie', sessionCookie(token, isSecureRequest(c.req.url)))
  return c.json({ user: { id: row.id, email: row.email, credits: row.credits } })
})

/**
 * 消费验证 token:成功才把 email_verified 置 1、发放注册积分并建立会话。
 * token 只存哈希;UPDATE ... WHERE used_at IS NULL 保证并发点击只有一次生效。
 */
app.post('/verify', async (c) => {
  const body = await c.req.json<VerifyBody>().catch(() => ({}) as VerifyBody)
  const token = String(body.token ?? '').trim()
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return c.json({ error: '验证链接无效或已过期,请重新发送' }, 400)
  }

  const rec = await c.env.DB
    .prepare('SELECT id, user_id, idea, expires_at, used_at FROM email_verifications WHERE token_hash = ?')
    .bind(await hashToken(token))
    .first<{ id: string; user_id: string; idea: string; expires_at: string; used_at: string | null }>()
  if (!rec || rec.used_at || rec.expires_at <= new Date().toISOString()) {
    return c.json({ error: '验证链接无效或已过期,请重新发送' }, 400)
  }

  const claimed = await c.env.DB
    .prepare('UPDATE email_verifications SET used_at = ? WHERE id = ? AND used_at IS NULL RETURNING user_id')
    .bind(new Date().toISOString(), rec.id)
    .first<{ user_id: string }>()
  if (!claimed) return c.json({ error: '验证链接无效或已过期,请重新发送' }, 400)

  const user = await verifyAndGrant(c.env.DB, claimed.user_id)
  if (!user) return c.json({ error: '验证链接无效或已过期,请重新发送' }, 400)

  const session = await createSession(c.env.DB, claimed.user_id)
  c.header('Set-Cookie', sessionCookie(session, isSecureRequest(c.req.url)))
  return c.json({
    user: { id: claimed.user_id, email: user.email, credits: user.credits },
    idea: rec.idea,
  })
})

/**
 * 重发验证邮件。无论邮箱是否存在都返回 ok,避免被用来枚举账号;
 * 限流:同账号 60s 冷却(仅成功投递)、24h 5 封,同 IP 1h 20 次。
 */
app.post('/resend-verification', async (c) => {
  const body = await c.req.json<ResendBody>().catch(() => ({}) as ResendBody)
  const email = String(body.email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return c.json({ ok: true })

  const user = await c.env.DB
    .prepare('SELECT id, email, email_verified FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; email: string; email_verified: number }>()
  if (!user || user.email_verified) return c.json({ ok: true })

  const tooFrequent = () => c.json({ error: '验证邮件发送过于频繁,请稍后再试', code: 'verify_too_frequent' }, 429)
  const recent = await c.env.DB
    .prepare(
      `SELECT 1 AS n FROM email_verifications
       WHERE user_id = ? AND sent = 1 AND created_at > datetime('now', ?)`
    )
    .bind(user.id, `-${RESEND_COOLDOWN_SEC} seconds`)
    .first()
  if (recent) return tooFrequent()

  const daily = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM email_verifications
       WHERE user_id = ? AND sent = 1 AND created_at > datetime('now', '-1 day')`
    )
    .bind(user.id)
    .first<{ n: number }>()
  if ((daily?.n ?? 0) >= RESEND_DAILY_MAX) return tooFrequent()

  const ip = clientIp(c)
  if ((await ipHourlySends(c.env.DB, ip)) >= RESEND_IP_HOURLY_MAX) return tooFrequent()

  const sent = await issueVerification(c, user, '', parseLang(body.lang))
  if (!sent) return c.json({ error: '验证邮件发送失败,请稍后重试', code: 'verify_send_failed' }, 502)
  return c.json({ ok: true })
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
  return c.json({
    google: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    // 平台部署环境:仅 staging 设了 ENVIRONMENT,生产回落 production(前端据此决定是否显示角标)
    environment: c.env.ENVIRONMENT ?? 'production',
  })
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

type GoogleUser = { id: string; email: string; credits: number; email_verified: number }

/**
 * Google 返回的邮箱已经验证过 —— 把待验证账号转正。
 * 只在 0→1 的那一次补发注册积分(与邮箱验证等价);已验证账号不重复发。
 */
async function markGoogleVerified(db: D1Database, row: GoogleUser): Promise<GoogleUser> {
  if (row.email_verified) return row
  const claimed = await db
    .prepare('UPDATE users SET email_verified = 1 WHERE id = ? AND email_verified = 0 RETURNING id')
    .bind(row.id)
    .first()
  if (!claimed) return { ...row, email_verified: 1 }
  const credits = await grantSignupCreditsOnVerify(db, row.id, SIGNUP_CREDITS)
  return { ...row, email_verified: 1, credits: credits || row.credits }
}

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

  type U = GoogleUser
  let row = await c.env.DB.prepare('SELECT id, email, credits, email_verified FROM users WHERE google_sub = ?')
    .bind(sub)
    .first<U>()
  if (!row) {
    // 同邮箱的老账号(邮箱/密码注册):回填 sub 完成合并,历史数据与积分都保留
    const byEmail = await c.env.DB.prepare('SELECT id, email, credits, email_verified FROM users WHERE email = ?')
      .bind(email)
      .first<U>()
    if (byEmail) {
      await c.env.DB.prepare('UPDATE users SET google_sub = ? WHERE id = ?').bind(sub, byEmail.id).run()
      // 待验证的邮箱/密码账号走 Google 登录 = 邮箱已验证,补发注册积分
      row = await markGoogleVerified(c.env.DB, byEmail)
    } else {
      const id = crypto.randomUUID()
      // 同注册:显式写 credits 与 email_verified,不靠 schema DEFAULT(老库的默认值改不动)
      await c.env.DB
        .prepare("INSERT INTO users (id, email, password_hash, google_sub, credits, email_verified) VALUES (?, ?, '', ?, ?, 1)")
        .bind(id, email, sub, SIGNUP_CREDITS)
        .run()
      await grantSignupCredits(c.env.DB, id, SIGNUP_CREDITS).catch(() => {})
      row = { id, email, credits: SIGNUP_CREDITS, email_verified: 1 }
    }
  } else {
    // 老账号(可能是在本次改动之前注册、还没验证的):Google 登录直接转正
    row = await markGoogleVerified(c.env.DB, row)
  }

  const secure = isSecureRequest(c.req.url)
  const token = await createSession(c.env.DB, row.id)
  c.header('Set-Cookie', sessionCookie(token, secure))
  c.header('Set-Cookie', oauthStateCookie('', secure), { append: true })
  // 有 idea 则回登录页由前端原地续跑;否则直接进项目列表
  return c.redirect(idea ? `/login?idea=${encodeURIComponent(idea)}` : '/projects')
})

export const authRoutes = app
