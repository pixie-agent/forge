/**
 * 成本核算:把 agent 上报的 token 用量与运行时长换算成美元。
 *
 * 价格是「快照」,不会自动跟随上游变化 —— 改这里必须注明来源与日期。已经落库的历史成本不重算;
 * 需要重算时以 job_usage 里的原始 token 为准(用量才是真相,成本只是当时的换算结果)。
 */

/** 每 100 万 token 的美元单价 */
export interface ModelPrice {
  /** 未命中缓存的输入 */
  input: number
  output: number
  /** 命中缓存(DeepSeek 的自动磁盘缓存) */
  cacheRead: number
  /** 写入缓存;DeepSeek 不额外收费,故为 0 */
  cacheWrite: number
}

const MODEL_PRICES: Record<string, ModelPrice> = {
  // DeepSeek V4.1-Flash。2026-09-10 起的官方价,取 off-peak 档(hit $0.007 / miss $0.22 / out $0.66);
  // peak 时段(工作日 01:00-04:00、06:00-10:00 UTC,即北京 09-12、14-18 点)单价翻倍,
  // 所以这里算出来的是成本**下界**。以 https://api-docs.deepseek.com 的价格页为准。
  'deepseek-flash': { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0 },
  // staging 用的智谱 GLM-5.3-Flash:单价未逐项核对,先按 0 记(只影响 staging 后台的成本展示)
  'glm-5.3-flash': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
}

/** Cloud Run 单价(us-central1 / tier 1 / 按请求计费) */
const VCPU_USD_PER_SECOND = 0.000024
const GIB_USD_PER_SECOND = 0.0000025
/** forge-agent 的规格,与 package.json 里 agent:deploy:* 的 --cpu / --memory 对齐 */
const AGENT_VCPU = 1
const AGENT_GIB = 1

export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/**
 * 取单价:后台 model_configs 里配了价就用配置(允许非 DeepSeek 模型也能算成本),
 * 否则回落到内置快照。两者都没有 → null(后台标记「未计价」,成本按 0 记)。
 */
export function priceOf(model: string, override?: ModelPrice | null): ModelPrice | null {
  if (override && (override.input > 0 || override.output > 0 || override.cacheRead > 0 || override.cacheWrite > 0)) {
    return override
  }
  return MODEL_PRICES[model] ?? null
}

/**
 * LLM 成本。未知模型按 0 记 —— 宁可少算也不要编一个数出来:
 * 后台会按模型名把「未知价格」的行标出来,发现新模型就补进 MODEL_PRICES 或在后台配置价格。
 */
export function llmCostUsd(model: string, usage: TokenUsage, override?: ModelPrice | null): number {
  const p = priceOf(model, override)
  if (!p) return 0
  const t = usage.input * p.input + usage.output * p.output + usage.cacheRead * p.cacheRead + usage.cacheWrite * p.cacheWrite
  return t / 1_000_000
}

/** 是否已登记该模型的单价(后台据此提示"成本下界"或"未计价") */
export function hasPrice(model: string, override?: ModelPrice | null): boolean {
  const p = priceOf(model, override)
  return !!p && (p.input > 0 || p.output > 0)
}

/**
 * 一次任务占用的 Cloud Run 实例时间成本。`--concurrency 1`,所以实例时间 ≈ 任务时长;
 * 冷启动与启动加速也在这段时间里,一并计入(略高估,比少算好)。
 */
export function gcpCostUsd(runMs: number): number {
  const seconds = Math.max(0, runMs) / 1000
  return seconds * (AGENT_VCPU * VCPU_USD_PER_SECOND + AGENT_GIB * GIB_USD_PER_SECOND)
}
