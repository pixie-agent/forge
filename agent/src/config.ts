/** 运行期配置:全部来自环境变量(Cloud Run 上以 --set-env-vars / Secret Manager 注入) */

import type { ModelOverride } from './types.js'

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`缺少必需的环境变量 ${name}`)
  return v
}

export interface AgentConfig {
  port: number
  /** 与 Cloudflare Worker 共享的内部密钥(双向校验:X-Agent-Secret) */
  agentSecret: string
  /** 每次生成的硬性上限,超时放弃(需小于 Cloud Run --timeout) */
  maxRunMs: number
  workspaceRoot: string
  /** 预装的 Vite+React 脚手架目录(含 node_modules),每个 job 从这里拷贝出工作目录 */
  templateDir: string
  /** pi 自定义 provider 标识与模型 id */
  providerId: string
  modelId: string
  llm: {
    baseUrl: string
    apiKey: string
  }
  /** LLM 网关的 API 方言:openai-completions(OpenAI 兼容)| anthropic-messages(Anthropic 兼容) */
  llmApi: 'openai-completions' | 'anthropic-messages' | 'openai-responses'
  /** pi 的思考级别:off | minimal | low | medium | high | xhigh(非推理模型会被 pi 自动降级) */
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  /** 模型是否声明支持推理(影响 pi 是否发送 reasoning 参数) */
  modelReasoning: boolean
  /** 思考参数的网关方言:openai | openrouter | zai | qwen | qwen-chat-template(pi compat.thinkingFormat) */
  thinkingFormat?: 'openai' | 'openrouter' | 'zai' | 'qwen' | 'qwen-chat-template'
  /** pi Model.maxTokens(单次回复上限;思考预算也从这里划走) */
  maxTokens: number
  /** 部分 OpenAI 兼容网关不认 developer 角色,置 false 走 system */
  supportsDeveloperRole: boolean
  supportsReasoningEffort: boolean
  /**
   * 模型是否支持图片输入:置 true 才会在 models.json 里声明 `input: ['text','image']`,
   * 并把用户上传的图片作为多模态输入交给模型。默认关闭——上游网关方言不一定认 image 块,
   * 声明了却发不出去会直接 400。
   */
  supportsImageInput: boolean
  /**
   * 第二轮「设计总监复查与打磨」的开关:
   *   'generate' 只在从零生成时跑(默认) | 'always' generate 与 chat 都跑 | 'off' 关闭
   * 复查轮失败不判 job 失败;复查产物构建失败会回滚到第一轮源码。
   */
  designReview: 'off' | 'generate' | 'always'
  /** 复查轮单独的时长上限(ms),防止把总预算吃满 */
  polishMaxMs: number
  /**
   * 进程内任务并发上限:0 = 不排队(VIP 执行体,行为与从前完全一致)。
   * 实际值由 Worker 按后台 model_configs.queue_concurrency 随每次请求下发;
   * 这里的 env 只是回落值(配置行缺失/迁移未执行时用)。
   * Cloud Run 自带的请求队列只等约 10s 就返回 429,所以排队只能放在这里。
   */
  queueConcurrency: number
}

export function loadConfig(): AgentConfig {
  return {
    port: Number(process.env.PORT ?? 8080),
    agentSecret: required('AGENT_SECRET'),
    maxRunMs: Number(process.env.AGENT_MAX_RUN_MS ?? 1_500_000),
    workspaceRoot: process.env.WORKSPACE_ROOT ?? '/tmp/forge-agent',
    templateDir: process.env.WORKSPACE_TEMPLATE_DIR ?? '/opt/forge-template',
    providerId: process.env.PI_PROVIDER_ID ?? 'forge',
    modelId: required('LLM_MODEL'),
    llm: {
      baseUrl: required('LLM_BASE_URL'),
      apiKey: required('LLM_API_KEY'),
    },
    llmApi: (process.env.PI_LLM_API ?? 'openai-completions') as AgentConfig['llmApi'],
    thinkingLevel: (process.env.PI_THINKING_LEVEL ?? 'medium') as AgentConfig['thinkingLevel'],
    modelReasoning: process.env.PI_MODEL_REASONING === 'true',
    thinkingFormat: (process.env.PI_THINKING_FORMAT || undefined) as AgentConfig['thinkingFormat'],
    maxTokens: Number(process.env.PI_MAX_TOKENS ?? 16_384),
    supportsDeveloperRole: process.env.PI_SUPPORTS_DEVELOPER_ROLE !== 'false',
    supportsReasoningEffort: process.env.PI_SUPPORTS_REASONING_EFFORT !== 'false',
    supportsImageInput: process.env.PI_MODEL_INPUT_IMAGE === 'true',
    designReview: (process.env.AGENT_DESIGN_REVIEW ?? 'generate') as AgentConfig['designReview'],
    polishMaxMs: Number(process.env.AGENT_POLISH_MAX_MS ?? 300_000),
    queueConcurrency: clamp(process.env.AGENT_QUEUE_CONCURRENCY, 0, 0, 32),
  }
}

const API_DIALECTS = new Set(['openai-completions', 'anthropic-messages'])
const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
const THINKING_FORMATS = new Set(['openai', 'openrouter', 'zai', 'qwen', 'qwen-chat-template'])
const DESIGN_REVIEWS = new Set(['off', 'generate', 'always'])
/** Cloud Run --timeout 1800s,留 100s 余量 */
const MAX_RUN_MS = 1_700_000

function clamp(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * 把后台下发的模型覆盖合并到环境默认配置上(见 docs/FORGE2.md §21)。
 * 非法值一律回落到环境默认值,不因一条脏配置让整个任务 400;密钥/base 兼容标志仍来自 env。
 */
export function applyModelOverride(base: AgentConfig, o?: ModelOverride): AgentConfig {
  if (!o || typeof o !== 'object') return base
  const modelId = typeof o.modelId === 'string' && o.modelId.trim() ? o.modelId.trim().slice(0, 120) : base.modelId
  const baseUrl =
    typeof o.baseUrl === 'string' && /^https?:\/\//i.test(o.baseUrl) ? o.baseUrl.replace(/\/+$/, '') : base.llm.baseUrl
  const llmApi = API_DIALECTS.has(o.api) ? o.api : base.llmApi
  const thinkingLevel = o.thinkingLevel && THINKING_LEVELS.has(o.thinkingLevel) ? o.thinkingLevel : base.thinkingLevel
  // thinkingFormat 不传就沿用 env;传了非法值也回落 env,不让一条脏配置改变网关方言
  const thinkingFormat =
    typeof o.thinkingFormat === 'string' && THINKING_FORMATS.has(o.thinkingFormat) ? o.thinkingFormat : base.thinkingFormat
  const maxRunMs = clamp(o.maxRunMs, base.maxRunMs, 60_000, MAX_RUN_MS)
  const designReview =
    o.designReview && DESIGN_REVIEWS.has(o.designReview) ? o.designReview : base.designReview
  return {
    ...base,
    providerId: (typeof o.providerId === 'string' && o.providerId.trim().slice(0, 40)) || base.providerId,
    modelId,
    llm: { ...base.llm, baseUrl },
    llmApi,
    thinkingLevel,
    thinkingFormat,
    maxTokens: clamp(o.maxTokens, base.maxTokens, 1024, 200_000),
    modelReasoning: typeof o.reasoning === 'boolean' ? o.reasoning : base.modelReasoning,
    supportsImageInput: typeof o.imageInput === 'boolean' ? o.imageInput : base.supportsImageInput,
    designReview,
    maxRunMs,
    polishMaxMs: clamp(o.polishMaxMs, base.polishMaxMs, 0, maxRunMs),
  }
}
