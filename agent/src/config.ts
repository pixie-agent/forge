/** 运行期配置:全部来自环境变量(Cloud Run 上以 --set-env-vars / Secret Manager 注入) */

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
  /** 思考参数的网关方言:openai | zai | qwen | qwen-chat-template(pi compat.thinkingFormat) */
  thinkingFormat?: 'openai' | 'zai' | 'qwen' | 'qwen-chat-template'
  /** 部分 OpenAI 兼容网关不认 developer 角色,置 false 走 system */
  supportsDeveloperRole: boolean
  supportsReasoningEffort: boolean
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
    supportsDeveloperRole: process.env.PI_SUPPORTS_DEVELOPER_ROLE !== 'false',
    supportsReasoningEffort: process.env.PI_SUPPORTS_REASONING_EFFORT !== 'false',
  }
}