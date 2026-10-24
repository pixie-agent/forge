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
 * 用 Resend 的 REST API 发信(免费档 3,000 封/月、100 封/天)。
 * 未配置 key / 域名未验证 / 超配额时抛错,调用方负责降级(建号成功但提示重发)。
 * 选 Resend 而不是 Cloudflare Email Sending:后者要求 Workers Paid 订阅。
 */
async function sendEmail(env: Env, to: string, subject: string, text: string, html: string): Promise<string> {
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
      subject,
      text,
      html,
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

/** 注册验证邮件:链接固定用 PUBLIC_BASE_URL,语言由注册/重发请求的界面语言决定 */
export async function sendVerificationEmail(
  env: Env,
  to: string,
  link: string,
  lang: Lang
): Promise<string> {
  return sendEmail(
    env,
    to,
    srv(lang, 'verify.subject'),
    srv(lang, 'verify.text', { link }),
    srv(lang, 'verify.html', { link })
  )
}

/**
 * 后台加积分的到账通知。
 * 后台操作不带收件人的界面语言,所以正文**中英双语**——不猜用户语言,也不给运营加一个语言选项。
 * 邮件只是通知,失败绝不影响加积分本身(调用方只统计成功/失败数)。
 */
export async function sendCreditGrantEmail(env: Env, to: string, amount: number, balance: number): Promise<string> {
  const base = (env.PUBLIC_BASE_URL || 'https://app.1forgen.site').replace(/\/+$/, '')
  const link = new URL('/', base).toString()
  const vars = { amount, balance, link }
  const subject = `${srv('zh', 'grant.subject')} · ${srv('en', 'grant.subject')}`
  const text = `${srv('zh', 'grant.text', vars)}\n\n---\n\n${srv('en', 'grant.text', vars)}`
  const html = `${srv('zh', 'grant.html', vars)}${srv('en', 'grant.html', vars)}`
  return sendEmail(env, to, subject, text, html)
}

export interface CreditGrantNotice {
  to: string
  amount: number
  balance: number
}

/**
 * 批量发送到账通知:并发 8,单个失败只计数不影响其它人。
 * 批量人数上限由接口层控制(≤100),这里不再放大;Resend 免费档 100 封/天,超限会体现在 failed 里。
 */
export async function sendCreditGrantEmails(
  env: Env,
  notices: CreditGrantNotice[]
): Promise<{ sent: number; failed: number }> {
  const CONCURRENCY = 8
  let sent = 0
  let failed = 0
  for (let i = 0; i < notices.length; i += CONCURRENCY) {
    const chunk = notices.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      chunk.map((n) => sendCreditGrantEmail(env, n.to, n.amount, n.balance))
    )
    for (const result of results) {
      if (result.status === 'fulfilled') sent += 1
      else {
        failed += 1
        console.error('[email] credit grant notice failed', result.reason)
      }
    }
  }
  return { sent, failed }
}
