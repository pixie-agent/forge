import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireUser } from '../lib/auth'
import { JOB_COST } from '../lib/credits'
import { logEvent } from '../lib/events'
import { CREDIT_PACKS, SUBSCRIPTION_PLANS, CURRENCY, findPack, findPlan } from '../lib/plans'
import {
  creemCheckoutReady,
  creemCreateCheckout,
  creemProductId,
  handleCreemEvent,
  parseProductMap,
  verifyCreemSignature,
  type CreemWebhookEvent,
} from '../lib/creem'

/**
 * 计费:价目表、账户摘要(余额 + 流水 + 订单)、发起结账、MoR webhook。
 *
 * 阶段四已接 **Creem**(MoR):`POST /checkout` 创建结账会话并返回 `{ url }`,前端直接跳转;
 * `POST /webhook` 是**公开**端点(不挂用户鉴权,靠 `creem-signature` 签名校验),落 `orders` 与
 * `credit_ledger`(`purchase`)并加积分。见 docs/FORGE2.md §20 与 src/lib/creem.ts。
 */
const app = new Hono<AppEnv>()

/**
 * 价目表(**公开**):登录页、首页都可能展示价格,所以不挂鉴权。
 * 只回结构化数字,文案由前端 i18n 组装(见 src/lib/plans.ts 文件头)。
 */
app.get('/plans', (c) => {
  return c.json({
    currency: CURRENCY,
    /** 每个任务的积分价,前端据此算「这个包能生成多少次」 */
    jobCost: JOB_COST,
    packs: CREDIT_PACKS,
    plans: SUBSCRIPTION_PLANS,
    /** 支付通道是否已开通(密钥与商品映射就绪)。未开通时前端禁用结账按钮并显示说明 */
    checkoutReady: creemCheckoutReady(c.env),
  })
})

/** 账户摘要:登录后可见,只回本人数据 */
app.use('/summary', requireUser)
app.get('/summary', async (c) => {
  const userId = c.get('user').id

  // 余额以 users.credits 为准 —— 账本是审计流水,极端情况下可能缺一条(见 src/lib/credits.ts 文件头)
  const user = await c.env.DB.prepare('SELECT credits FROM users WHERE id = ?')
    .bind(userId)
    .first<{ credits: number }>()

  const { results: ledger } = await c.env.DB
    .prepare(
      `SELECT id, delta, reason, ref_type, ref_id, balance_after, note, created_at
       FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100`
    )
    .bind(userId)
    .all<{ id: string; delta: number; reason: string; ref_type: string; ref_id: string; balance_after: number; note: string; created_at: string }>()

  const { results: orders } = await c.env.DB
    .prepare(
      `SELECT id, provider, amount_minor, currency, credits, status, created_at, paid_at
       FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`
    )
    .bind(userId)
    .all<{ id: string; provider: string; amount_minor: number; currency: string; credits: number; status: string; created_at: string; paid_at: string | null }>()

  return c.json({
    credits: user?.credits ?? 0,
    ledger: ledger.map((r) => ({
      id: r.id,
      delta: r.delta,
      reason: r.reason,
      refType: r.ref_type,
      refId: r.ref_id,
      balanceAfter: r.balance_after,
      note: r.note,
      createdAt: r.created_at,
    })),
    orders: orders.map((r) => ({
      id: r.id,
      provider: r.provider,
      amountMinor: r.amount_minor,
      currency: r.currency,
      credits: r.credits,
      status: r.status,
      createdAt: r.created_at,
      paidAt: r.paid_at,
    })),
  })
})

/**
 * 发起结账:校验商品 → 调 Creem 建结账会话 → 返回 `{ url }` 让前端跳转。
 * 这里**不落 pending 订单** —— Creem 结账会话会过期,而 `checkout.completed` 才带得回 Creem 订单 id;
 * 预落一条 pending 行只会在用户放弃支付后留下永远不结的脏数据。订单一律在 webhook 结算时落。
 */
app.use('/checkout', requireUser)
app.post('/checkout', async (c) => {
  const body = await c.req.json<{ kind?: unknown; id?: unknown }>().catch(() => ({} as { kind?: unknown; id?: unknown }))
  const kind = body.kind
  const id = typeof body.id === 'string' ? body.id : ''

  const item = kind === 'pack' ? findPack(id) : kind === 'plan' ? findPlan(id) : undefined
  if (!item) return c.json({ error: '参数不合法' }, 400)

  if (!c.env.CREEM_API_KEY) return c.json({ error: '计费未配置' }, 503)
  const productId = creemProductId(c.env, id)
  if (!productId) {
    console.warn(`creem 商品未配置:${id}(已有映射 ${Object.keys(parseProductMap(c.env)).join(',') || '无'})`)
    return c.json({ error: '商品未配置' }, 503)
  }

  const user = c.get('user')
  const base = (c.env.PUBLIC_BASE_URL || new URL(c.req.url).origin).replace(/\/+$/, '')
  try {
    const { checkoutUrl } = await creemCreateCheckout(c.env, {
      productId,
      requestId: crypto.randomUUID(),
      userId: user.id,
      email: user.email,
      successUrl: `${base}/billing?checkout=success`,
    })
    await logEvent(c.env.DB, user.id, 'checkout_start', { kind, id })
    return c.json({ url: checkoutUrl })
  } catch (err) {
    console.error('创建 Creem 结账失败', err)
    return c.json({ error: err instanceof Error ? err.message : '创建结账失败' }, 502)
  }
})

/**
 * Creem webhook(**公开**,不挂 requireUser):签名校验通过才处理。
 *
 * 之所以公开:调用方是 Creem 的服务器,没有浏览器 cookie;鉴权靠 `creem-signature`
 * (HMAC-SHA256(原始请求体, CREEM_WEBHOOK_SECRET))。注意必须用**未解析的原始 body** 计算。
 *
 * 返回 5xx 时 Creem 会按退避重试(5 次 / 24h 内),所以「暂时处理不了」就抛出去让它重试;
 * 已处理过的重放由 `orders` 唯一索引挡掉(见 src/lib/creem.ts 文件头)。
 */
app.post('/webhook', async (c) => {
  if (!c.env.CREEM_WEBHOOK_SECRET) return c.json({ error: '计费未配置' }, 503)

  const raw = await c.req.text()
  const ok = await verifyCreemSignature(raw, c.req.header('creem-signature') ?? null, c.env.CREEM_WEBHOOK_SECRET)
  if (!ok) {
    console.warn('creem webhook 签名校验失败')
    return c.json({ error: '签名校验失败' }, 401)
  }

  let event: CreemWebhookEvent
  try {
    event = JSON.parse(raw) as CreemWebhookEvent
  } catch {
    return c.json({ error: '非法请求体' }, 400)
  }

  try {
    const result = await handleCreemEvent(c.env, event)
    if (!result.handled) console.warn(`creem webhook 未处理:${event.eventType} — ${result.reason ?? ''}`)
    // 一律 200:已能判定的「不处理」(未知商品 / 重放 / 非目标事件)不该让 Creem 反复重试
    return c.json({ ok: true, handled: result.handled })
  } catch (err) {
    console.error(`creem webhook 处理失败:${event.eventType}`, err)
    return c.json({ error: '处理失败' }, 500)
  }
})

export const billingRoutes = app
