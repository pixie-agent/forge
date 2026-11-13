/** 装配 pi AgentSession:自定义 OpenAI 兼容 provider + 隔离工作目录 + 内置编码工具 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  createAgentSession,
  type AgentSession,
} from '@earendil-works/pi-coding-agent'
import type { AgentConfig } from './config.js'
import { systemPrompt } from './prompt.js'
import { t, type UiLang } from './i18n.js'
import type { OutputLang } from './lang.js'

/**
 * 生成 models.json:声明一个指向既有 OpenAI 兼容网关的自定义 provider。
 * apiKey 写环境变量名(而非明文),由 pi 在请求时解析 LLM_API_KEY,避免密钥落盘。
 */
function modelsJson(config: AgentConfig): string {
  const model = {
    id: config.modelId,
    name: config.modelId,
    api: config.llmApi,
    reasoning: config.modelReasoning,
    input: config.supportsImageInput ? ['text', 'image'] : ['text'],
    contextWindow: 200_000,
    maxTokens: config.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  const provider: Record<string, unknown> = {
    baseUrl: config.llm.baseUrl.replace(/\/+$/, ''),
    api: config.llmApi,
    apiKey: `$${config.apiKeyEnv}`,
    models: [model],
  }
  // 仅 OpenAI 兼容方言需要这些 compat(Anthropic 方言不认 reasoning_effort/developer 等字段)
  if (config.llmApi === 'openai-completions') {
    const compat: Record<string, unknown> = {
      supportsDeveloperRole: config.supportsDeveloperRole,
      supportsReasoningEffort: config.supportsReasoningEffort,
    }
    if (config.thinkingFormat) compat.thinkingFormat = config.thinkingFormat
    // ZAI(GLM)的 effort 只认 low/high/max,把 pi 的档位映射过去(见 v1 代码注释:disabled 会 400)
    if (config.thinkingFormat === 'zai') {
      compat.reasoningEffortMap = { minimal: 'low', low: 'low', medium: 'high', high: 'high', xhigh: 'max' }
    }
    provider.compat = compat
  }
  return JSON.stringify({
    providers: {
      [config.providerId]: provider,
    },
  })
}

/**
 * 为一次 job 创建全新会话:agentDir 用临时目录(不读机器上 ~/.pi 的配置/技能/扩展),
 * 会话历史 in-memory,工具绑定到本次的隔离工作目录 → 执行完即随容器销毁。
 *
 * agentDir 必须放在**本次 job 的 workspace 内**:免费执行体允许同时跑多个任务,
 * 若共用 `${WORKSPACE_ROOT}/.pi`,并发任务会同时改写同一个 models.json,
 * 另一个任务读到的可能是写了一半的文件(线上踩过:Unexpected end of JSON input)。
 * `.pi` 已在 runner 的 SKIP_DIRS 里,不会被当作源码交付。
 */
export async function createForgeSession(
  config: AgentConfig,
  workspace: string,
  /** 产物语言决定 prompt 的语言约束;界面语言决定面向用户的报错文案 */
  opts: { outLang: OutputLang; uiLang: UiLang; mode: 'generate' | 'chat' },
): Promise<AgentSession> {
  const agentDir = join(workspace, '.pi')
  await mkdir(agentDir, { recursive: true })
  const modelsPath = join(agentDir, 'models.json')
  await writeFile(modelsPath, modelsJson(config), 'utf8')

  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  const loadError = modelRuntime.getError()
  if (loadError) throw new Error(t(opts.uiLang, 'error.modelsLoad', { msg: String(loadError) }))

  const model = modelRuntime.getModel(config.providerId, config.modelId)
  if (!model) throw new Error(t(opts.uiLang, 'error.modelMissing', { provider: config.providerId, model: config.modelId }))

  const loader = new DefaultResourceLoader({
    cwd: workspace,
    agentDir,
    systemPrompt: systemPrompt(opts.outLang, opts.mode),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  })
  await loader.reload()

  const { session } = await createAgentSession({
    cwd: workspace,
    agentDir,
    model,
    modelRuntime,
    sessionManager: SessionManager.inMemory(),
    tools: ['read', 'bash', 'edit', 'write'],
    resourceLoader: loader,
    thinkingLevel: config.thinkingLevel,
  })
  return session
}
