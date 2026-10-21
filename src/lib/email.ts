import type { Env } from '../types'
import { newToken } from './auth'
import { srv, type Lang } from './i18n'

const encoder = new TextEncoder()

/** 验证 token 只以 SHA-256 入库:即使 D1 泄露,也拿不到可直接使用的验证链接 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function newVerificationToken(): string {
  return newToken()
}

/**
 * 验证链接固定用 PUBLIC_BASE_URL(staging 自动指向 app-staging),避免有人用 workers.dev
 * 或自定义域名注册时把链接发到另一套环境。idea 透传,验证完可继续「登录后继续生成」。
 */
export function verificationUrl(env: Env, requestUrl: string, token: string, idea: string): string {
  const base = (env.PUBLIC_BASE_URL || new URL(requestUrl).origin).replace(/\/+$/, '')
  const u = new URL('/verify', base)
  u.searchParams.set('token', token)
  if (idea) u.searchParams.set('idea', idea)
  return u.toString()
}

/**
 * 用 Resend 的 REST API 发验证邮件(免费档 3,000 封/月、100 封/天)。
 * 未配置 key / 域名未验证 / 超配额时抛错,调用方负责降级(建号成功但提示重发)。
 * 选 Resend 而不是 Cloudflare Email Sending:后者要求 Workers Paid 订阅。
 */
export async function sendVerificationEmail(
  env: Env,
  to: string,
  link: string,
  lang: Lang
): Promise<string> {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY 未配置')
  const from = env.EMAIL_FROM || 'noreply@1forgen.site'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${env.ENVIRONMENT === 'staging' ? 'Forge Staging' : 'Forge'} <${from}>`,
      to: [to],
      subject: srv(lang, 'verify.subject'),
      text: srv(lang, 'verify.text', { link }),
      html: srv(lang, 'verify.html', { link }),
    }),
  })
  if (!res.ok) {
    // 把上游原因截断后带出,方便在 wrangler tail 里直接定位(配额/域名/权限)
    const detail = await res.text().catch(() => '')
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 300)}`)
  }
  const data = await res.json<{ id?: string }>().catch(() => ({}) as { id?: string })
  return data.id ?? ''
}
