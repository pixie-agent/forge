/** 装配 pi AgentSession:自定义 OpenAI 兼容 provider + 隔离工作目录 + 内置编码工具 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  createCodingTools,
  type AgentSession,
} from '@mariozechner/pi-coding-agent'
import type { AgentConfig } from './config.js'
import { SYSTEM_PROMPT } from './prompt.js'

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
    maxTokens: 16_384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  const provider: Record<string, unknown> = {
    baseUrl: config.llm.baseUrl.replace(/\/+$/, ''),
    api: config.llmApi,
    apiKey: 'LLM_API_KEY',
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
 */
export async function createForgeSession(config: AgentConfig, workspace: string): Promise<AgentSession> {
  const agentDir = join(config.workspaceRoot, '.pi')
  await mkdir(agentDir, { recursive: true })
  const modelsPath = join(agentDir, 'models.json')
  await writeFile(modelsPath, modelsJson(config), 'utf8')

  const authStorage = AuthStorage.create(join(agentDir, 'auth.json'))
  const modelRegistry = ModelRegistry.create(authStorage, modelsPath)
  const loadError = modelRegistry.getError()
  if (loadError) throw new Error(`models.json 加载失败:${loadError}`)

  const model = modelRegistry.find(config.providerId, config.modelId)
  if (!model) throw new Error(`模型未找到:${config.providerId}/${config.modelId}`)

  const loader = new DefaultResourceLoader({
    cwd: workspace,
    agentDir,
    systemPrompt: SYSTEM_PROMPT,
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
    modelRegistry,
    authStorage,
    sessionManager: SessionManager.inMemory(),
    tools: createCodingTools(workspace),
    resourceLoader: loader,
    thinkingLevel: config.thinkingLevel,
  })
  return session
}