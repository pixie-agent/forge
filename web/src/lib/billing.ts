/**
 * 前端的积分口径(与后端 src/lib/credits.ts 的 JOB_COST / SIGNUP_CREDITS 对应)。
 *
 * 为什么是两份而不是一份:Worker 与 web 是两个独立构建产物,没有共享模块的通道
 * (共用的是 web/dist,不是源码)。改档位时**两处都要改**,后端才是权威(它负责真正的扣减)。
 * 前端这份只用于文案展示,数字不对不会造成扣错分。
 */
export const JOB_COST = 1
export const SIGNUP_CREDITS = 5

/**
 * 最小货币单位(美分)→ 展示价,如 `900` → `$9.00`。
 * 币种只处理 USD(海外预付统一美元);其它币种原样前缀,避免静默用错符号。
 */
export function formatPrice(minor: number, currency = 'USD'): string {
  const symbol = currency === 'USD' ? '$' : `${currency} `
  return `${symbol}${(minor / 100).toFixed(2)}`
}
