/**
 * 模型配置:后台可增删启停的数据化配置(见 schema.migrate-model-config.sql)。
 *
 * 设计要点:
 *  - 同一 channel 只有一条 enabled = 1 的配置生效;表为空/查询失败时**回落 Cloud Run env**,
 *    所以后台故障或忘记执行迁移不会让生成直接不可用。
 *  - 配置行可在后台原地编辑(不再要求「新增一行再启用」)。job_usage 在用量上报时
 *    已经把成本落库,所以改价/改预算不会重算历史;只影响之后派发的任务。
 *  - 密钥值永远不在这张表里,只存**变量名**(api_key_env,如 LLM_API_KEY_GLM)。
 *    执行体可以同时绑定多把 key(Cloud Run --set-secrets),后台按行选择用哪把;
 *    新增供应商仍需给执行体加 Secret 绑定,但切换模型不再需要重部署。
 */

import type { AgentModelOverride } from './agent'

export type ApiDialect = 'openai-completions' | 'anthropic-messages'
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export type DesignReview = 'off' | 'generate' | 'always'
/** pi compat.thinkingFormat;空串表示让 pi 按 baseUrl 自动推断 */
export type ThinkingFormat = '' | 'openai' | 'openrouter' | 'zai' | 'qwen' | 'qwen-chat-template'

export const API_DIALECTS: ApiDialect[] = ['openai-completions', 'anthropic-messages']
export const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
export const DESIGN_REVIEWS: DesignReview[] = ['off', 'generate', 'always']
export const THINKING_FORMATS: ThinkingFormat[] = ['', 'openai', 'openrouter', 'zai', 'qwen', 'qwen-chat-template']

/**
 * 通道:同一套代码按用户付费状态走两套模型/执行体。
 *  - free:没付过钱的用户,走便宜模型 + 串行排队(见 docs/FORGE2.md §21.5)
 *  - vip :有过已支付订单的用户,走原模型 / 原执行体
 *  - default:两个通道都没配时的回落(兼容只配了一行配置的老数据)
 */
export type ModelChannel = 'default' | 'free' | 'vip'
export const MODEL_CHANNELS: ModelChannel[] = ['default', 'free', 'vip']

/**
 * Cloud Run --timeout 是 3600s;留 200s 给构建/收尾,避免 agent 还在跑就被平台强杀。
 * 注意 max_run_ms 只约束模型主循环,构建与复查轮在其后发生,所以不能贴着 3600s 配。
 */
const MAX_RUN_MS = 3_400_000
const MIN_RUN_MS = 60_000

export interface ModelConfigRow {
  id: string
  name: string
  channel: string
  provider_id: string
  base_url: string
  api_dialect: ApiDialect
  model_id: string
  thinking_level: ThinkingLevel
  thinking_format: ThinkingFormat
  /** 该配置使用哪个密钥环境变量(执行体绑定的 Secret 名),如 LLM_API_KEY_MINIMAX */
  api_key_env: string
  /** pi Model.maxTokens;思考预算从这里划走,太小会把输出挤没 */
  max_tokens: number
  reasoning: number
  image_input: number
  design_review: DesignReview
  max_run_ms: number
  polish_max_ms: number
  /** 该通道同时执行的任务数;0 = 不限制(仅 free 通道下发,与 Cloud Run --concurrency 无关) */
  queue_concurrency: number
  input_price: number
  output_price: number
  cache_read_price: number
  cache_write_price: number
  enabled: number
  created_at: string
  updated_at: string
}

/**
 * 取当前生效配置。查询失败(未执行迁移/列缺失)只告警并返回 null,调用方按 env 默认值继续,
 * 保证「后台配置」永远不是生成链路上的单点故障。
 */
export async function getActiveModelConfig(db: D1Database, channel = 'default'): Promise<ModelConfigRow | null> {
  try {
    return await db
      .prepare('SELECT * FROM model_configs WHERE enabled = 1 AND channel = ? ORDER BY updated_at DESC LIMIT 1')
      .bind(channel)
      .first<ModelConfigRow>()
  } catch (err) {
    console.warn(`[model-config] 读取生效配置失败,回落 env:${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/**
 * 用户通道:有过已支付订单(Creem 一次性或订阅扣款都会落 `orders.status='paid'`)即 VIP,
 * 否则 free。积分本身是可互换的,账本没有「哪一分是充值来的」这种批次概念,
 * 所以按「是否付过费」分类是当前模型下唯一稳定且可解释的口径。
 * 查询失败时按 free 处理:免费通道最坏只是慢一点,不会让付费用户误走免费队列。
 */
export async function modelChannelForUser(db: D1Database, userId: string): Promise<'free' | 'vip'> {
  try {
    const paid = await db
      .prepare("SELECT 1 AS ok FROM orders WHERE user_id = ? AND status = 'paid' LIMIT 1")
      .bind(userId)
      .first<{ ok: number }>()
    return paid ? 'vip' : 'free'
  } catch {
    return 'free'
  }
}

/** 取该用户生效的配置:先按通道找,没有再回落到 default(老数据只有一行时行为不变) */
export async function getModelConfigForUser(
  db: D1Database,
  userId: string,
  /** 已算过通道时传进来,避免同一请求里查两次 orders;两者必须一致(派发用同一个值)*/
  knownChannel?: 'free' | 'vip'
): Promise<{ channel: 'free' | 'vip'; config: ModelConfigRow | null }> {
  const channel = knownChannel ?? (await modelChannelForUser(db, userId))
  const config = (await getActiveModelConfig(db, channel)) ?? (await getActiveModelConfig(db, 'default'))
  return { channel, config }
}

/** 转成派发给 agent 的覆盖项(与 agent/src/types.ts 的 ModelOverride 对齐) */
export function modelOverrideOf(row: ModelConfigRow): AgentModelOverride {
  return {
    providerId: row.provider_id,
    modelId: row.model_id,
    baseUrl: row.base_url,
    api: row.api_dialect,
    thinkingLevel: row.thinking_level,
    // 空串不下发,agent 侧继续用 env / pi 的自动推断
    thinkingFormat: row.thinking_format || undefined,
    // 只下发变量名;密钥值始终在 Cloud Run Secret 里,不经过这张表
    apiKeyEnv: row.api_key_env || undefined,
    maxTokens: row.max_tokens,
    reasoning: row.reasoning === 1,
    imageInput: row.image_input === 1,
    designReview: row.design_review,
    maxRunMs: row.max_run_ms,
    polishMaxMs: row.polish_max_ms,
  }
}

export interface ModelConfigInput {
  name: string
  /** default | free | vip(每通道最多一条 enabled = 1) */
  channel: ModelChannel
  provider_id: string
  base_url: string
  api_dialect: ApiDialect
  model_id: string
  thinking_level: ThinkingLevel
  thinking_format: ThinkingFormat
  /** 密钥环境变量名,必须匹配 /^LLM_API_KEY(_[A-Z0-9]+)*$/ */
  api_key_env: string
  max_tokens: number
  reasoning: number
  image_input: number
  design_review: DesignReview
  max_run_ms: number
  polish_max_ms: number
  /** 0 = 不限制;>0 = 同时执行的任务数 */
  queue_concurrency: number
  input_price: number
  output_price: number
  cache_read_price: number
  cache_write_price: number
  enabled: number
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function boolInt(v: unknown, fallback = 0): number {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === 1 || v === '1' || v === 'true') return 1
  if (v === 0 || v === '0' || v === 'false') return 0
  return fallback
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 校验后台提交的配置。错误以中文返回,直接展示在后台表单上 */
export function parseModelConfigInput(raw: unknown): { value?: ModelConfigInput; error?: string } {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const name = text(src.name, 80)
  const modelId = text(src.model_id, 120)
  const baseUrl = text(src.base_url, 300)
  if (!name) return { error: '名称不能为空' }
  if (!modelId) return { error: '模型 ID 不能为空' }
  if (!baseUrl) return { error: 'Base URL 不能为空' }
  if (!/^https:\/\//i.test(baseUrl)) return { error: 'Base URL 必须是 https://' }

  const channel = (text(src.channel, 20) || 'default') as ModelChannel
  if (!MODEL_CHANNELS.includes(channel)) return { error: '通道不合法' }
  const dialect = text(src.api_dialect, 40) as ApiDialect
  if (!API_DIALECTS.includes(dialect)) return { error: 'API 方言不合法' }
  const thinking = text(src.thinking_level, 20) as ThinkingLevel
  if (!THINKING_LEVELS.includes(thinking)) return { error: '思考档位不合法' }
  const thinkingFormat = text(src.thinking_format, 40) as ThinkingFormat
  if (!THINKING_FORMATS.includes(thinkingFormat)) return { error: '思考方言不合法' }
  // 只存变量名;白名单化到 LLM_API_KEY / LLM_API_KEY_XXX,
  // 防止把 AGENT_SECRET 之类非模型密钥当成上游 key 发出去
  const apiKeyEnv = text(src.api_key_env, 40) || 'LLM_API_KEY'
  if (!/^LLM_API_KEY(?:_[A-Z0-9]+)*$/.test(apiKeyEnv)) {
    return { error: '凭证变量名不合法(只允许 LLM_API_KEY 或 LLM_API_KEY_XXX)' }
  }
  const designReview = text(src.design_review, 20) as DesignReview
  if (!DESIGN_REVIEWS.includes(designReview)) return { error: '复查轮配置不合法' }

  const rawMaxRun = src.max_run_ms
  if (rawMaxRun !== undefined && rawMaxRun !== '' && rawMaxRun !== null) {
    const n = Number(rawMaxRun)
    if (Number.isFinite(n) && (n < MIN_RUN_MS || n > MAX_RUN_MS)) {
      return { error: `运行上限必须在 ${MIN_RUN_MS / 1000}s 到 ${MAX_RUN_MS / 1000}s 之间` }
    }
  }
  const maxRunMs = Math.round(num(src.max_run_ms, 1_500_000, MIN_RUN_MS, MAX_RUN_MS))
  return {
    value: {
      name,
      channel,
      provider_id: text(src.provider_id, 40) || 'forge',
      base_url: baseUrl.replace(/\/+$/, ''),
      api_dialect: dialect,
      model_id: modelId,
      thinking_level: thinking,
      thinking_format: thinkingFormat,
      api_key_env: apiKeyEnv,
      // 1024 是 pi 给输出预留的最小值;上限取模型常见的 200k 上下文量级
      max_tokens: Math.round(num(src.max_tokens, 16_384, 1024, 200_000)),
      reasoning: boolInt(src.reasoning, 1),
      image_input: boolInt(src.image_input, 0),
      design_review: designReview,
      max_run_ms: maxRunMs,
      polish_max_ms: Math.round(num(src.polish_max_ms, 300_000, 0, maxRunMs)),
      // 任务并发:0 = 不限制;32 是 agent 侧 FifoQueue 的硬上限
      queue_concurrency: Math.round(num(src.queue_concurrency, 0, 0, 32)),
      input_price: num(src.input_price, 0, 0, 1000),
      output_price: num(src.output_price, 0, 0, 1000),
      cache_read_price: num(src.cache_read_price, 0, 0, 1000),
      cache_write_price: num(src.cache_write_price, 0, 0, 1000),
      enabled: boolInt(src.enabled, 0),
    },
  }
}
