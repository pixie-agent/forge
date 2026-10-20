/**
 * Creem(MoR,Merchant of Record)适配层。
 *
 * 平台不持有海外实体、不代收代缴税,由 Creem 作为记录商户对终端用户开票、收款并承担税务合规;
 * 到账后我们在**自己这边**发积分(积分不是 Creem 的 customer credits,是 Forge 自己的账)。
 *
 * 本文件三件事:
 *  1. `creemCreateCheckout` —— 调 Creem 建结账会话,拿回跳转 URL;
 *  2. `verifyCreemSignature` —— 校验 webhook 的 `creem-signature`(HMAC-SHA256 / webhook secret);
 *  3. `handleCreemEvent` —— 把事件落成 `orders` + `credit_ledger`(`purchase`)并加积分。
 *
 * **环境差异全部走运行时配置**(AGENTS.md §2):生产 `https://api.creem.io`、staging `https://test-api.creem.io`,
 * 以及两套门店各自的商品 ID,都从 vars 读(见 wrangler.jsonc 的 CREEM_API_BASE / CREEM_PRODUCTS)。
 * 密钥 `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` 走 `wrangler secret put`(只写不可读)。
 *
 * ⚠️ 未配置时(密钥或商品映射缺)结账与 webhook 都返回明确错误,不影响其它功能 —— 与 CONNECTOR_KEK 同一套路。
 *
 * 事件语义与幂等(见 docs/FORGE2.md §20.7):
 *  - `checkout.completed`:**只处理一次性商品**(`product.billing_type === 'onetime'`),落 `orders`(provider_ref = Creem 订单 id)。
 *  - `subscription.paid`:订阅**每次成功扣款**(首期与续费)都发一次,provider_ref = 该笔交易 id(`tran_...`)。
 *    首期同时还会收到 `subscription.active` / `checkout.completed`(recurring)—— 那两个**不发积分**,
 *    否则同一笔钱会被发两次(Creem 官方也是这么建议的:用 `subscription.paid` 激活权益)。
 *  - `subscription.canceled` / `expired` / `unpaid` / `past_due` / `paused` 等:只更新 `subscriptions` 状态。
 *    **已发的积分不回收** —— 积分是预付买断的,取消只停掉后续续费。
 *  - `refund.created`:订单置 `refunded`,并在余额够时追回该单发的积分(不够就只记订单,不把余额打成负数)。
 *
 * 幂等屏障是 `orders` 的唯一索引 `idx_orders_provider_ref(provider, provider_ref)`:支付平台重放是常态,
 * 靠「插入成功才发积分」挡掉,而不是靠事件 id(Creem 的重试与手动重发语义不同)。
 */
import type { Env } from '../types'
import { CURRENCY, CREDIT_PACKS, SUBSCRIPTION_PLANS } from './plans'

export const CREEM_PROVIDER = 'creem'

/** 生产基址;staging 用 vars.CREEM_API_BASE 覆盖成 https://test-api.creem.io */
const DEFAULT_API_BASE = 'https://api.creem.io'

export function creemApiBase(env: Env): string {
  return (env.CREEM_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '')
}

/** Creem 是否已具备收款条件(结账需要 API key + 商品映射) */
export function creemCheckoutReady(env: Env): boolean {
  return Boolean(env.CREEM_API_KEY) && Object.keys(parseProductMap(env)).length > 0
}

/**
 * 本地目录 id → Creem 商品 ID 的映射。来源是 vars.CREEM_PRODUCTS 的 JSON,例如:
 *   {"pack_20":"prod_xxx","plan_plus":"prod_yyy"}
 * 之所以放配置而不是代码:测试门店与生产门店的商品 ID 不同,而两套环境共用同一份源码(AGENTS.md §2)。
 */
export function parseProductMap(env: Env): Record<string, string> {
  const raw = env.CREEM_PRODUCTS
  if (!raw) return {}
  try {
    const obj = JSON.parse(raw) as unknown
    if (!obj || typeof obj !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === 'string' && v) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

/** 本地目录 id → Creem 商品 ID(结账侧用);未配置返回空串 */
export function creemProductId(env: Env, catalogId: string): string {
  return parseProductMap(env)[catalogId] ?? ''
}

/** 本地目录项(Creem 只负责收款,发多少积分由本地目录说了算) */
export interface CatalogItem {
  kind: 'pack' | 'plan'
  id: string
  credits: number
  priceMinor: number
  currency: string
}

export function findCatalogItem(id: string): CatalogItem | null {
  const pack = CREDIT_PACKS.find((p) => p.id === id)
  if (pack) return { kind: 'pack', id: pack.id, credits: pack.credits, priceMinor: pack.priceMinor, currency: CURRENCY }
  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === id)
  if (plan) return { kind: 'plan', id: plan.id, credits: plan.creditsPerPeriod, priceMinor: plan.priceMinor, currency: CURRENCY }
  return null
}

/** Creem 商品 ID → 本地目录项(webhook 侧用;**积分数只认本地目录**,不认上游传来的数字) */
export function findCatalogItemByProductId(env: Env, productId: string): CatalogItem | null {
  if (!productId) return null
  for (const [catalogId, pid] of Object.entries(parseProductMap(env))) {
    if (pid === productId) return findCatalogItem(catalogId)
  }
  return null
}

// ─────────────────────────────── 创建结账会话 ───────────────────────────────

export interface CheckoutInput {
  productId: string
  /** 幂等 + 对账用的本地请求 id(随结账会话回传,出现在 webhook 的 checkout.request_id) */
  requestId: string
  /** 本地用户 id —— 写进结账会话 metadata,webhook 里据此归属(比邮箱兜底可靠) */
  userId: string
  email?: string
  successUrl: string
}

export async function creemCreateCheckout(env: Env, input: CheckoutInput): Promise<{ id: string; checkoutUrl: string }> {
  if (!env.CREEM_API_KEY) throw new Error('计费未配置')
  const res = await fetch(`${creemApiBase(env)}/v1/checkouts`, {
    method: 'POST',
    headers: { 'x-api-key': env.CREEM_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      product_id: input.productId,
      request_id: input.requestId,
      success_url: input.successUrl,
      ...(input.email ? { customer: { email: input.email } } : {}),
      // metadata 会被 Creem 带到 subscription 上,所以续费事件也能靠它归属到本人,
      // 不必依赖邮箱匹配(用户可能用另一个邮箱在门店页付款)。见 resolveUserId。
      metadata: { forgeUserId: input.userId },
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Creem 结账创建失败(${res.status}):${text.slice(0, 300)}`)
  let data: { id?: unknown; checkout_url?: unknown }
  try {
    data = JSON.parse(text) as { id?: unknown; checkout_url?: unknown }
  } catch {
    throw new Error('Creem 结账响应不是 JSON')
  }
  const id = typeof data.id === 'string' ? data.id : ''
  const url = typeof data.checkout_url === 'string' ? data.checkout_url : ''
  if (!id || !url) throw new Error('Creem 结账响应缺少 id / checkout_url')
  return { id, checkoutUrl: url }
}

// ─────────────────────────────── 签名校验 ───────────────────────────────

/**
 * webhook 签名:`creem-signature` 头 = HMAC-SHA256(**原始请求体**, webhook secret) 的 hex。
 * 必须先 `c.req.text()` 拿到未经解析的原文再算 —— 解析后重新序列化会因空格/键序变化而校验失败。
 */
export async function verifyCreemSignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !secret) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const expected = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('')
  return timingSafeEqualHex(expected, signature.trim().toLowerCase())
}

/** 定长比较,避免用 === 逐字符短路比较签名 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ─────────────────────────────── 事件处理 ───────────────────────────────

export interface CreemWebhookEvent {
  id?: string
  eventType?: string
  created_at?: number
  object?: unknown
}

/** 事件处理结果(仅用于日志/调试,不影响响应码) */
export interface CreemEventResult {
  handled: boolean
  reason?: string
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0
}

/** 从事件对象里取商品 ID:不同事件里 `product` 有时是字符串、有时是整个对象 */
function productIdOf(obj: Record<string, unknown>): string {
  const p = obj.product
  if (typeof p === 'string') return p
  return str(asRecord(p).id)
}

/** 元数据里我们塞的用户 id(创建结账时写入);Creem 会把它带到后续订阅事件上 */
function metaUserId(obj: Record<string, unknown>): string {
  return str(asRecord(obj.metadata).forgeUserId)
}

/**
 * 找到这笔钱属于哪个用户:优先用元数据里的 forgeUserId(可信,由我们写入),
 * 兜底用买家邮箱匹配本地账号(用户在 Creem 门店页直接下单、没走我们结账时只有邮箱可用)。
 */
async function resolveUserId(env: Env, metaUid: string, email: string): Promise<string> {
  if (metaUid) {
    const u = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(metaUid).first<{ id: string }>()
    if (u) return u.id
  }
  if (email) {
    const u = await env.DB.prepare('SELECT id FROM users WHERE lower(email) = lower(?)')
      .bind(email)
      .first<{ id: string }>()
    if (u) return u.id
  }
  return ''
}

interface SettleInput {
  userId: string
  providerRef: string
  credits: number
  amountMinor: number
  currency: string
  note: string
}

/**
 * 结算一笔已支付交易:落 `orders`(paid)→ 加积分 → 记一条 `purchase` 流水。
 *
 * 幂等靠 `orders` 唯一索引:插入冲突(重放)直接返回 false,绝不重复加分。
 * 顺序是「先插订单、再加积分」——若加积分前进程消失,会留下一条 paid 订单但没加分,
 * 这是**失败方向安全**的缺失(用户可凭订单找客服补),反过来(加了分没订单)才是对不上账。
 */
async function settlePayment(env: Env, s: SettleInput): Promise<boolean> {
  const orderId = crypto.randomUUID()
  const ins = await env.DB
    .prepare(
      `INSERT INTO orders (id, user_id, provider, provider_ref, amount_minor, currency, credits, status, paid_at)
       VALUES (?, ?, 'creem', ?, ?, ?, ?, 'paid', datetime('now'))
       ON CONFLICT(provider, provider_ref) DO NOTHING`
    )
    .bind(orderId, s.userId, s.providerRef, s.amountMinor, s.currency, s.credits)
    .run()
  if (!ins.meta.changes) return false // 重放:这笔已经结算过

  const row = await env.DB
    .prepare('UPDATE users SET credits = credits + ? WHERE id = ? RETURNING credits')
    .bind(s.credits, s.userId)
    .first<{ credits: number }>()
  if (!row) {
    // 用户已不存在:撤回订单行,避免留下一条无法对账的 paid 订单
    await env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(orderId).run().catch(() => {})
    return false
  }

  await env.DB
    .prepare(
      `INSERT INTO credit_ledger (id, user_id, delta, reason, ref_type, ref_id, balance_after, note)
       VALUES (?, ?, ?, 'purchase', 'order', ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), s.userId, s.credits, orderId, row.credits, s.note)
    .run()
  return true
}

/** 记录 / 更新订阅状态(不影响积分;积分只在 subscription.paid 时发) */
async function upsertSubscription(
  env: Env,
  v: { id: string; userId: string; productId: string; catalogId: string; status: string; periodEnd: string }
): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO subscriptions (id, user_id, provider, product_id, catalog_id, status, current_period_end)
       VALUES (?, ?, 'creem', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         product_id = excluded.product_id,
         catalog_id = excluded.catalog_id,
         status = excluded.status,
         current_period_end = COALESCE(excluded.current_period_end, subscriptions.current_period_end),
         updated_at = datetime('now')`
    )
    .bind(v.id, v.userId, v.productId, v.catalogId, v.status, v.periodEnd || null)
    .run()
}

/**
 * 处理一条 Creem webhook 事件。抛错 → 路由返回 5xx → Creem 会按退避重试
 * (5 次:立即 / 30s / 5min / 30min / 6h,24h 内),所以这里「处理不了」就该抛。
 */
export async function handleCreemEvent(env: Env, event: CreemWebhookEvent): Promise<CreemEventResult> {
  const type = str(event.eventType)
  const obj = asRecord(event.object)

  switch (type) {
    case 'checkout.completed': {
      // 订阅的首期由 subscription.paid 负责,这里只处理一次性商品,避免同一笔钱发两次
      const billingType = str(asRecord(obj.product).billing_type)
      if (billingType === 'recurring') return { handled: false, reason: 'recurring handled by subscription.paid' }

      const order = asRecord(obj.order)
      const providerRef = str(order.id)
      if (!providerRef) return { handled: false, reason: 'no order id' }
      if (str(order.status) !== 'paid') return { handled: false, reason: `order status ${str(order.status)}` }

      const item = findCatalogItemByProductId(env, productIdOf(obj))
      if (!item || item.kind !== 'pack') return { handled: false, reason: 'unknown product' }

      const email = str(asRecord(obj.customer).email)
      const userId = await resolveUserId(env, metaUserId(obj), email)
      if (!userId) return { handled: false, reason: 'no matching user' }

      const amountMinor = num(order.amount) || item.priceMinor
      const ok = await settlePayment(env, {
        userId,
        providerRef,
        credits: item.credits,
        amountMinor,
        currency: str(order.currency) || item.currency,
        note: `Creem 充值到账(${item.id})`,
      })
      if (ok && amountMinor !== item.priceMinor) {
        console.warn(`creem 金额与本地目录不一致:${item.id} 上游 ${amountMinor} / 本地 ${item.priceMinor}`)
      }
      return { handled: ok, reason: ok ? undefined : 'already settled' }
    }

    case 'subscription.paid': {
      // 首期与每次续费都走这里;provider_ref 用交易 id,保证一个计费周期只发一次
      const providerRef = str(obj.last_transaction_id)
      if (!providerRef) return { handled: false, reason: 'no transaction id' }

      const subId = str(obj.id)
      const productId = productIdOf(obj)
      const item = findCatalogItemByProductId(env, productId)
      const catalogId = item?.id ?? ''
      const email = str(asRecord(obj.customer).email)
      const userId = await resolveUserId(env, metaUserId(obj), email)

      if (userId && subId) {
        await upsertSubscription(env, {
          id: subId,
          userId,
          productId,
          catalogId,
          status: str(obj.status) || 'active',
          periodEnd: str(obj.current_period_end_date),
        })
      }
      if (!item || item.kind !== 'plan') return { handled: false, reason: 'unknown product' }
      if (!userId) return { handled: false, reason: 'no matching user' }

      const ok = await settlePayment(env, {
        userId,
        providerRef,
        credits: item.credits,
        amountMinor: item.priceMinor,
        currency: item.currency,
        note: `Creem 订阅到账(${item.id})`,
      })
      return { handled: ok, reason: ok ? undefined : 'already settled' }
    }

    // 订阅状态类事件:只同步状态,不发积分、不回收已发积分
    case 'subscription.active':
    case 'subscription.trialing':
    case 'subscription.paused':
    case 'subscription.canceled':
    case 'subscription.scheduled_cancel':
    case 'subscription.past_due':
    case 'subscription.unpaid':
    case 'subscription.expired':
    case 'subscription.update': {
      const subId = str(obj.id)
      if (!subId) return { handled: false, reason: 'no subscription id' }
      const email = str(asRecord(obj.customer).email)
      const userId = await resolveUserId(env, metaUserId(obj), email)
      if (!userId) return { handled: false, reason: 'no matching user' }
      await upsertSubscription(env, {
        id: subId,
        userId,
        productId: productIdOf(obj),
        catalogId: findCatalogItemByProductId(env, productIdOf(obj))?.id ?? '',
        status: type.replace('subscription.', ''),
        periodEnd: str(obj.current_period_end_date),
      })
      return { handled: true }
    }

    case 'refund.created': {
      const tx = asRecord(obj.transaction)
      const order = asRecord(obj.order)
      const keys = [str(order.id), str(tx.id)].filter(Boolean)
      if (!keys.length) return { handled: false, reason: 'no order/transaction id' }

      const row = await env.DB
        .prepare(
          `SELECT id, user_id, credits, status FROM orders
           WHERE provider = 'creem' AND provider_ref IN (${keys.map(() => '?').join(',')})`
        )
        .bind(...keys)
        .first<{ id: string; user_id: string; credits: number; status: string }>()
      if (!row || row.status === 'refunded') return { handled: false, reason: 'no order or already refunded' }

      await env.DB.prepare(`UPDATE orders SET status = 'refunded' WHERE id = ?`).bind(row.id).run()

      // 尽力追回积分:余额够才扣(用户可能已经花掉了),不够就只把订单标成已退款
      if (row.credits > 0) {
        const updated = await env.DB
          .prepare('UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ? RETURNING credits')
          .bind(row.credits, row.user_id, row.credits)
          .first<{ credits: number }>()
        if (updated) {
          await env.DB
            .prepare(
              `INSERT INTO credit_ledger (id, user_id, delta, reason, ref_type, ref_id, balance_after, note)
               VALUES (?, ?, ?, 'refund', 'order', ?, ?, ?)`
            )
            .bind(crypto.randomUUID(), row.user_id, -row.credits, row.id, updated.credits, 'Creem 退款追回积分')
            .run()
        } else {
          console.warn(`creem 退款:余额不足以追回 ${row.credits} 积分(order ${row.id}),仅标记订单`)
        }
      }
      return { handled: true }
    }

    default:
      return { handled: false, reason: 'ignored event' }
  }
}
