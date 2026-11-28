/** 装配 pi AgentSession:自定义 OpenAI 兼容 provider + 隔离工作目录 + 内置编码工具 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  createAgentSession,
  createMcpExtension,
  formatSkillsForPrompt,
  loadSkillsFromDir,
  type AgentSession,
  type LoadedMcpConfig,
  type McpServerConfig,
} from '@earendil-works/pi-coding-agent'
import type { AgentConfig } from './config.js'
import type { McpConfig } from './types.js'
import { t, type UiLang } from './i18n.js'

/**
 * 一次 job 内共享的模型上下文:models.json 只解析一次,各子 agent 复用同一份 provider/model。
 * (免费执行体允许同时跑多个任务,所以 agentDir 仍必须落在本次 job 的 workspace 内,
 * 避免并发任务改写同一个 models.json;`.pi` 已在 runner 的 SKIP_DIRS 里,不会被当作源码交付。)
 */
export type ForgeModelContext = Awaited<ReturnType<typeof createModelContext>>

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
    // ZAI(GLM) 的 effort 只认 low/high/max:把 pi 的档位映射过去。
    // 新版 pi 把 compat.reasoningEffortMap 换成了模型级 thinkingLevelMap(旧字段被静默忽略,
    // 'medium' 会原样发给网关 → GLM 400「该模型始终思考,不支持关闭思考」)。
    // off 映射到 'low':GLM 始终思考,不支持关闭(其余档位无映射 → 按 pi 默认回落)。
    ...(config.thinkingFormat === 'zai'
      ? {
          thinkingLevelMap: {
            off: 'low',
            minimal: 'low',
            low: 'low',
            medium: 'high',
            high: 'high',
            xhigh: 'max',
            max: 'max',
          },
        }
      : {}),
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
    provider.compat = compat
  }
  return JSON.stringify({
    providers: {
      [config.providerId]: provider,
    },
  })
}

/** 为一次 job 创建共享模型上下文(models.json + ModelRuntime + 已选 model),只调一次 */
export async function createModelContext(config: AgentConfig, workspace: string, uiLang: UiLang) {
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
  if (loadError) throw new Error(t(uiLang, 'error.modelsLoad', { msg: String(loadError) }))

  const model = modelRuntime.getModel(config.providerId, config.modelId)
  if (!model) throw new Error(t(uiLang, 'error.modelMissing', { provider: config.providerId, model: config.modelId }))

  return { agentDir, modelRuntime, model }
}

/** body.mcp(McpConfig)→ pi 的 LoadedMcpConfig;mcpNames 只保留该 agent 声明的服务子集 */
function toLoadedMcpConfig(mcp: McpConfig, names?: string[]): LoadedMcpConfig {
  // 声明的 MCP 服务名若不在配置里,记一条告警(不打断生成,缺失服务只是不挂载)
  for (const n of names ?? []) {
    if (!(n in mcp.servers)) console.warn(`[pipeline] 声明的 MCP 服务 "${n}" 不存在,已忽略`)
  }
  const servers = Object.entries(mcp.servers)
    .filter(([name]) => !names || names.includes(name))
    .map(([name, def]) => ({
      name,
      // Forge 强制缺省 direct:pi 默认 codemode 只供 codemode 脚本,而 Forge 的无头 agent 没有 codemode,
      // 不强制 direct 的话 MCP 工具对模型完全不可见。
      config: { ...def, exposure: def.exposure ?? 'direct' } as unknown as McpServerConfig,
      source: 'forge',
    }))
  return { servers, errors: [], autoEnableCodemode: mcp.autoEnableCodemode ?? false }
}

/**
 * 为某个子 agent 节点创建全新会话:每个节点一套独立的 system prompt + 工具集,
 * 会话历史 in-memory,工具绑定到本次的隔离工作目录 → 执行完即随容器销毁。
 * skills / mcp 是该 agent 的可选能力:skills 格式化成 XML 追加进 system prompt(模型用 read 读取
 * SKILL.md),mcp 作为内联扩展注入(工具以 mcp__<server>__<tool> 暴露,凭证走 ${NAME} 环境变量)。
 */
export async function createForgeSession(
  config: AgentConfig,
  workspace: string,
  ctx: ForgeModelContext,
  opts: {
    uiLang: UiLang
    systemPrompt: string
    tools: string[]
    /** 技能目录(已解包到工作区的 .skills);缺省 = 不启用技能 */
    skillsDir?: string
    /** 该 agent 启用的技能名子集;缺省 = 全部 */
    skillNames?: string[]
    /** 全量 MCP 配置(body.mcp);缺省 = 不启用 MCP */
    mcp?: McpConfig
    /** 该 agent 可用的 MCP 服务名子集;缺省 = 全部 */
    mcpNames?: string[]
  },
): Promise<AgentSession> {
  let systemPrompt = opts.systemPrompt
  if (opts.skillsDir) {
    const { skills } = loadSkillsFromDir({ dir: opts.skillsDir, source: 'forge' })
    const names = opts.skillNames
    // 声明的技能名若在技能树里不存在,记一条告警(不打断生成,缺失技能只是不注入)
    for (const n of names ?? []) {
      if (!skills.some((s) => s.name === n)) console.warn(`[pipeline] 声明的技能 "${n}" 不存在,已忽略`)
    }
    const selected = names ? skills.filter((s) => names.includes(s.name)) : skills
    const xml = selected.length ? formatSkillsForPrompt(selected, 'read') : ''
    if (xml) systemPrompt = `${systemPrompt}\n\n${xml}`
  } else if (opts.skillNames?.length) {
    for (const n of opts.skillNames) console.warn(`[pipeline] 未启用技能树,声明的技能 "${n}" 无法注入`)
  }

  const loader = new DefaultResourceLoader({
    cwd: workspace,
    agentDir: ctx.agentDir,
    systemPrompt,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    ...(opts.mcp
      ? { extensionFactories: [createMcpExtension({ loadConfig: () => toLoadedMcpConfig(opts.mcp as McpConfig, opts.mcpNames) })] }
      : {}),
  })
  await loader.reload()

  const { session } = await createAgentSession({
    cwd: workspace,
    agentDir: ctx.agentDir,
    model: ctx.model,
    modelRuntime: ctx.modelRuntime,
    sessionManager: SessionManager.inMemory(),
    tools: opts.tools,
    resourceLoader: loader,
    thinkingLevel: config.thinkingLevel,
  })
  return session
}
