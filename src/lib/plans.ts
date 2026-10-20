/**
 * 计费目录:一次性充值包(prepaid credits)与按月订阅档位。
 *
 * **这里是价格与积分数量的唯一来源。**前端不复制一份 —— 它从 `GET /api/billing/plans` 拉,
 * 所以调价、加减档位只改本文件(与顶层 `wrangler.jsonc` 的「绑定各写一遍」不同,那是配置,
 * 这是业务数据,单点即可)。
 *
 * ⚠️ 价格是**占位值**,阶段四接入 MoR 时以对方后台创建的商品为准(两边必须对齐,否则
 * webhook 里的金额对不上本地目录)。届时把 `priceMinor` 换成 MoR 商品 ID 更稳妥 —— 见 docs/FORGE2.md §20。
 *
 * 只放**结构化数字**,不放任何自然语言文案(名称、卖点)。文案在前端 i18n 词典里按 id 组装,
 * 否则一张价目表会把中英文案钉死在服务端。
 */

/** 结算货币(ISO 4217)。MoR 一般按 USD 结算,海外预付统一用美元 */
export const CURRENCY = 'USD'

/** 一次性充值包:买断,积分长期有效(不设过期,避免用户觉得在催单) */
export interface CreditPack {
  id: string
  credits: number
  /** 最小货币单位(美分)。$9.00 → 900 */
  priceMinor: number
  /** 营销角标:popular / bestValue / ''(空则不打) */
  badge: 'popular' | 'bestValue' | ''
}

/** 订阅档位:按月自动续费,每月自动到账 `creditsPerPeriod` 分,可随时取消 */
export interface SubscriptionPlan {
  id: string
  /** 档位名(品牌词,如 Plus / Pro;不进 i18n 词典,直接展示) */
  name: string
  creditsPerPeriod: number
  priceMinor: number
  period: 'month'
  /** 营销角标,同 CreditPack.badge */
  badge: 'popular' | 'bestValue' | ''
}

/**
 * 充值包。**1 积分 = 1 次生成/修改**(`JOB_COST` 全为 1),所以这里的 `credits` 就是「能做多少次」。
 * 单价随档位递减(0.450 → 0.417 → 0.395 美元/次),给大额包一点性价比梯度。
 *
 * 定价依据(2026-10-20):单次生成的边际成本 ≈ $0.06~0.15(LLM token + Cloud Run 实例时间,
 * 见 src/lib/pricing.ts 的换算),另加 MoR 手续费(Creem 3.9% + $0.40/笔)。
 * 所以单价必须落在 $0.4 附近才能留出毛利;早期按 $0.09/次(100 积分 $9)定过价,
 * 那个档位是纯亏的(一次生成的成本就把整个包的利润吃光)。真实成本以 `job_usage.cost_usd` 实测为准。
 */
export const CREDIT_PACKS: CreditPack[] = [
  { id: 'pack_20', credits: 20, priceMinor: 900, badge: '' },
  { id: 'pack_60', credits: 60, priceMinor: 2500, badge: 'popular' },
  { id: 'pack_200', credits: 200, priceMinor: 7900, badge: 'bestValue' },
]

/** 订阅档位:月付,每月到账。取消后当月已发积分保留,次月不再续(单价略低于充值包,换留存) */
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  { id: 'plan_plus', name: 'Plus', creditsPerPeriod: 50, priceMinor: 1900, period: 'month', badge: '' },
  { id: 'plan_pro', name: 'Pro', creditsPerPeriod: 150, priceMinor: 4900, period: 'month', badge: 'popular' },
]

export function findPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id)
}

export function findPlan(id: string): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((p) => p.id === id)
}
