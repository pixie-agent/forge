/** 把 job 派发给 Cloud Run 的 agent service,并接收其回传的多文件产物(源码树 + 构建产物) */

import type { Env, ConnectorGrant, Plan } from '../types'
import { parseLang, srv, type Lang } from './i18n'
import type { AgentAttachment } from './attachments'

/** 路径 → 文件内容 */
export type FileMap = Record<string, string>

export interface ArtifactManifestPayload {
  entry: string
  buildHash: string
  files: { path: string; size: number }[]
}

/**
 * 本次任务的模型覆盖(来自后台 model_configs 的生效行,见 src/lib/modelConfig.ts)。
 * 只传配置与凭证变量名(apiKeyEnv),不传密钥值 —— 密钥仍来自 Cloud Run 的 Secret。
 */
export interface AgentModelOverride {
  providerId?: string
  modelId: string
  baseUrl: string
  api: 'openai-completions' | 'anthropic-messages'
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  /** pi compat.thinkingFormat;缺省时沿用 env / pi 的 baseUrl 自动推断 */
  thinkingFormat?: 'openai' | 'openrouter' | 'zai' | 'qwen' | 'qwen-chat-template'
  /** pi Model.maxTokens */
  maxTokens?: number
  /**
   * 该配置使用的密钥环境变量名(执行体启动时绑定的 Secret),缺省 LLM_API_KEY。
   * 只传变量名,不传密钥本身 —— 同一个执行体可以绑定多把 key,后台配置按行选择用哪把。
   * 命名必须匹配 /^LLM_API_KEY(_[A-Z0-9_]+)?$/,防止把非模型密钥(如 AGENT_SECRET)发给上游。
   */
  apiKeyEnv?: string
  reasoning?: boolean
  imageInput?: boolean
  designReview?: 'off' | 'generate' | 'always'
  maxRunMs?: number
  polishMaxMs?: number
}

/**
 * 命名/内联 agent 定义(与 agent/src/types.ts 的 AgentDef 对齐)。
 * 命名 agent 注册表(agentset.json)与流水线步骤内联的 agent 对象共用这个形状。
 */
export interface AgentDef {
  /** 内联 system prompt;缺省时按 agent 名回落 prompts/system/<name>.md */
  systemPrompt?: string
  /** 工具集白名单(⊆ {read,bash,edit,write,grep,find,ls});缺省 = 内置 coder 默认工具集 */
  tools?: string[]
  /** 本 agent 启用的 skills id(⊆ 后台 skillset 里的技能名);缺省 = 不注入技能 */
  skills?: string[]
  /** 本 agent 可用的 mcp 服务 id(⊆ mcpset.json 里的服务名);缺省 = 不注入 MCP */
  mcp?: string[]
  /** 预留:per-agent 模型覆盖 */
  model?: { name?: string; effort?: string }
}

/**
 * 单个 MCP 服务配置(与 agent/src/types.ts 的 McpServerDef 对齐)。
 * stdio 服务 command/args 是任意命令,属任意代码执行;http 服务 url/headers 是外部信任面 ——
 * 凭证走环境变量引用 ${NAME}(绑在 Cloud Run 上的 Secret),绝不把明文写进配置。
 */
export interface McpServerDef {
  type?: 'stdio' | 'http'
  /** stdio:启动命令 */
  command?: string
  args?: string[]
  /** stdio 环境变量,值可引用 ${NAME}(Cloud Run env = 绑定的 Secret) */
  env?: Record<string, string>
  /** stdio 工作目录(相对会话工作目录解析) */
  cwd?: string
  /** http:服务地址(外部必须 https) */
  url?: string
  /** http 请求头,值可引用 ${NAME} */
  headers?: Record<string, string>
  /**
   * 工具暴露方式(pi 的 McpExposure)。codemode = 只供 codemode 脚本(Forge 无 codemode,基本不可用);
   * deferred = tool_search 加载后才声明给模型;direct = 直接声明给模型;hidden = 不可达。
   * Forge 强制缺省 direct(否则工具对模型不可见)。
   */
  exposure?: 'codemode' | 'deferred' | 'direct' | 'hidden'
  /** 单工具暴露白名单/覆盖(工具名或 * 通配),可只暴露部分工具 */
  toolExposure?: Record<string, 'codemode' | 'deferred' | 'direct' | 'hidden'>
  description?: string
  enabled?: boolean
  /** 单请求超时(秒),缺省 60 */
  timeout?: number
}

/** 全量 MCP 配置(name → 服务定义),派发时作为 body.mcp 下发 */
export interface McpConfig {
  servers: Record<string, McpServerDef>
  autoEnableCodemode?: boolean
}

/**
 * HITL 恢复上下文(与 agent/src/types.ts 的 ResumeContext 对齐)。人门节点暂停时由 agent 落盘
 * (经 /internal/jobs/:id/wait 存 R2),用户作答后 Worker 原样作为 body.resume 下发。
 */
export interface ResumeContext {
  doneStepIds: string[]
  gateStepId: string
  kind: 'approve' | 'choose'
  question: string
  options?: string[]
  deliverSummary: string
  lastAgentSummary: string
  baseline: FileMap | null
  built: boolean
  remainingMs: number
  sourceBefore: FileMap | null
  outputs: Record<string, Record<string, string>>
  /** 暂停时实际执行的编排节点快照(JSON);续跑用它固定版本,见 agent/src/types.ts 同名注释 */
  stepsJson: string
  attachments?: AgentAttachment[]
  connectors?: ConnectorGrant[]
}

/** POST {AGENT_URL}/run 请求体(与 agent/src/types.ts 的 RunRequest 对齐) */
export interface AgentRunRequest {
  jobId: string
  projectId: string
  type: 'generate' | 'chat'
  idea?: string
  message?: string
  note?: string
  /**
   * 平台界面语言(zh|en|ja|ko|ru|es|fr|de|it|pt|nl)。agent 用它决定**平台自身**的文案
   * (任务进度、错误提示);产物语言由 agent 从需求正文自动检测,不经过这里。
   */
  lang?: Lang
  /** 后台配置的模型覆盖;缺省时 agent 使用 Cloud Run env 的默认模型 */
  model?: AgentModelOverride
  /**
   * 全局编排流水线(JSON 字符串,teamai workflow 子集,见 docs/FORGE2.md §17.9)。
   * 与模型配置解耦、全平台一份;空/非法时 agent 用内置默认编排。
   */
  pipeline?: string
  /**
   * 提示词文件树(路径 → 模板文本),来自后台上传的提示词压缩包(见 docs/FORGE2.md §17.10)。
   * 缺省时 agent 用镜像内置的默认提示词树;带上的文件会按路径覆盖默认(部分覆盖 = 部分回落默认)。
   */
  promptFiles?: FileMap
  /** 命名 agent 注册表(name → 定义,来自 R2 agentset.json);缺省时 agent 只用内置 planner/coder/reviewer */
  agents?: Record<string, AgentDef>
  /** 技能文件树(skills/<name>/<file> → 内容,来自 R2 skillset.zip);缺省 = 不启用技能 */
  skillFiles?: FileMap
  /** 全量 MCP 服务配置(来自 R2 mcpset.json);缺省 = 不启用 MCP */
  mcp?: McpConfig
  /** HITL 恢复上下文:人门节点暂停后用户作答,新实例带着它从门后继续 */
  resume?: ResumeContext
  /** 用户对人门节点的作答(choose = 选中的选项;approve = 确认/补充反馈文本) */
  answer?: string
  /** choose 门:选中的选项(与 answer 同值) */
  answerChoice?: string
  /**
   * 该通道同时执行的任务数(0 = 不限制);缺省时 agent 用 Cloud Run env 的 AGENT_QUEUE_CONCURRENCY。
   * 这是「任务并发」,不是 Cloud Run 的 --concurrency(那只是单实例能接多少请求)。
   */
  queueConcurrency?: number
  /** chat:当前最新版本的源码树(Worker 从 versions.src_json 取出带上) */
  currentFiles?: FileMap
  /** chat:此前的对话历史(用户/助手交替),供 agent 理解上下文,实现连续对话 */
  history?: { role: 'user' | 'assistant'; content: string }[]
  /** 用户随消息上传的图片/文本附件(generate 与 chat 通用);图片会作为多模态输入直接交给模型 */
  attachments?: AgentAttachment[]
  /**
   * 本次生成可用的外部系统能力(连接器,见 docs/CONNECTORS.md §6b)。
   * 只读默认带上、可写要用户显式点亮;里面的凭证明文只活在这一条请求里,随 Cloud Run 容器销毁。
   */
  connectors?: ConnectorGrant[]
  /**
   * 完整过程日志是否回传进 agent_log(本地开发 ENVIRONMENT=local 时置 true;线上不带)。
   * 与 agent/src/types.ts 的 RunRequest.streamLog 对应。
   */
  streamLog?: boolean
  /** 进度回调基址 */
  callbackBase: string
}

/** 成功时 Cloud Run 返回的产物 */
export interface AgentRunResult {
  /** 源码树(交付/续聊用) */
  src: FileMap
  /** 构建产物(dist,写 R2) */
  dist: FileMap
  manifest: ArtifactManifestPayload
  plan?: Plan
  /** agent 收尾的交付说明(Markdown),作为对话里 assistant 的回复持久化 */
  summary?: string
}

/** Agent 已明确返回失败或无效响应:该请求已经结束,不会再有迟到的成功结果。 */
export class AgentDispatchError extends Error {
  override name = 'AgentDispatchError'
}

/**
 * 派发到 Cloud Run。请求在 Cloud Run 侧一直持有到 agent 跑完(请求级计费,用完即缩容)。
 * `agentUrl` 用来把免费通道送到独立执行体(便宜模型 + 进程内排队);不传则用默认 AGENT_URL。
 */
export async function dispatchAgent(
  env: Env,
  input: Omit<AgentRunRequest, 'callbackBase'>,
  agentUrl?: string
): Promise<AgentRunResult> {
  const body: AgentRunRequest = { ...input, callbackBase: env.PUBLIC_BASE_URL }
  const lang: Lang = parseLang(body.lang)
  const timeoutMs = Number(env.AGENT_DISPATCH_TIMEOUT_MS ?? 0)
  const target = (agentUrl || env.AGENT_URL).replace(/\/+$/, '')
  const res = await fetch(`${target}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Secret': env.AGENT_SECRET,
      // 请求体之前就失败(404/401/400)时 agent 也要知道用哪种语言回话
      'X-Forge-Lang': lang,
    },
    body: JSON.stringify(body),
    ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    // 尽量把 agent 侧的错误信息透出给用户;解析失败则给通用文案
    let message = ''
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? ''
    } catch {
      message = text.slice(0, 200)
    }
    throw new AgentDispatchError(message || srv(lang, 'agent.failed', { status: res.status }))
  }
  let data: AgentRunResult
  try {
    data = JSON.parse(text) as AgentRunResult
  } catch {
    throw new AgentDispatchError(srv(lang, 'agent.noArtifact'))
  }
  if (!data?.src || !data.dist || !data.manifest) throw new AgentDispatchError(srv(lang, 'agent.noArtifact'))
  return data
}