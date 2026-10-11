/**
 * 管理后台鉴权:与普通用户体系完全隔离,口令来自 `ADMIN_PASSWORD` secret。
 * 通过口令派生一个确定性令牌写进 HttpOnly cookie(改口令即全体失效),无需额外的会话表。
 * 仅管理员可访问 `/api/admin/*` 下的只读接口。
 */

import type { Context, Next } from 'hono'
import type { Env } from '../types'

const ADMIN_COOKIE = 'admin'
const ADMIN_TTL_S = 7 * 24 * 60 * 60 // 7 天
const encoder = new TextEncoder()

/** 由口令派生令牌(SHA-256);不含明文,改口令即失效 */
async function adminToken(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`forge-admin-v1:${password}`))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function readCookie(request: Request, name: string): string | null {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(request.headers.get('Cookie') ?? '')
  return m ? m[1] : null
}

export async function verifyAdminPassword(env: Env, password: string): Promise<boolean> {
  return !!env.ADMIN_PASSWORD && !!password && password === env.ADMIN_PASSWORD
}

export async function adminCookie(env: Env, secure: boolean): Promise<string> {
  const token = await adminToken(env.ADMIN_PASSWORD)
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ADMIN_TTL_S}${secure ? '; Secure' : ''}`
}

export function clearAdminCookie(secure: boolean): string {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}

export async function isAdmin(env: Env, request: Request): Promise<boolean> {
  if (!env.ADMIN_PASSWORD) return false
  const token = readCookie(request, ADMIN_COOKIE)
  if (!token) return false
  return token === (await adminToken(env.ADMIN_PASSWORD))
}

export async function requireAdmin(c: Context<{ Bindings: Env }>, next: Next) {
  if (!(await isAdmin(c.env, c.req.raw))) return c.json({ error: '未授权' }, 401)
  await next()
}