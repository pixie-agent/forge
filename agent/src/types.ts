/** Cloudflare Worker ↔ Cloud Run agent 之间的请求/回传协议(Worker 侧 src/lib/agent.ts 有对应副本) */

import type { UiLang } from './i18n.js'

export interface PlanItem {
  title: string
  summary: string
}

export interface Plan {
  name: string
  tagline: string
  palette: string[]
  sections: PlanItem[]
}

/** 路径 → 文件内容 */
export interface FileMap {
  [path: string]: string
}

/** 用户随需求一起上传的附件(Worker 侧 src/lib/attachments.ts 有对应副本) */
export interface RunAttachment {
  /** 原始文件名(已去掉路径与非法字符) */
  name: string
  /** 由扩展名判定的 MIME,如 image/png、text/markdown */
  mimeType: string
  /** base64(不含 data: 前缀) */
  data: string
}

/**
 * 生成过程中用户追加的要求(见 docs/FORGE2.md §5.2):
 * Worker 把 /api/projects/:id/steer 提交的内容放进 job_messages,
 * agent 每 5s 巡检 /internal/jobs/:id/state 取走后交给 pi 的 session.steer()。
 */
export interface SteerMessage {
  id: string
  content: string
  attachments: RunAttachment[]
}

/**
 * 本轮生成可用的外部连接器(Worker 侧 src/types.ts 有对应副本,见 docs/CONNECTORS.md §6b)。
 * 凭证只活在这一条 dispatch 请求里:agent 落到工作目录 `.forge/connectors.json`(进 SKIP_DIRS,
 * 不进源码树、不进产物),随容器销毁,不落 D1/R2/versions。
 */
export interface ConnectorGrant {
  provider: string
  accountLabel: string
  scopes: string[]
  /** true = 本次含可写能力(agent 触发写操作前应先取得用户确认) */
  writable?: boolean
  credentials?: Record<string, string>
  config?: Record<string, string>
  /** 生成期用法说明(来自 provider 定义的 agentHint) */
  hint?: string
}

export interface ArtifactManifest {
  /** 入口 HTML(默认 index.html) */
  entry: string
  buildHash: string
  files: { path: string; size: number }[]
}

/**
 * 一次 job 的真实用量(pi 会话累计的 token + 轮次),收尾时上报给 Worker 的 /internal/jobs/:id/usage
 * (见 src/lib/pricing.ts 的成本换算)。成功、失败、用户停止三种终态都要报 —— 它们同样烧 token 与实例时间,
 * 漏记就算不出真实毛利。runMs 由调用方(agent/src/index.ts)按整个请求的耗时补上。
 */
export interface RunUsage {
  model: string
  /** 未命中缓存的输入 token */
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** assistant 消息条数,≈ 轮次 */
  turns: number
}

/**
 * 后台下发的模型覆盖(Worker 侧 src/lib/agent.ts 有对应副本)。
 * 只含配置,不含密钥值:密钥仍来自 Cloud Run 的 Secret,这里只选择用哪个变量(apiKeyEnv)。
 */
export interface ModelOverride {
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
   * 只传变量名,不传密钥值;命名必须匹配 /^LLM_API_KEY(_[A-Z0-9]+)*$/。
   */
  apiKeyEnv?: string
  reasoning?: boolean
  imageInput?: boolean
  designReview?: 'off' | 'generate' | 'always'
  maxRunMs?: number
  polishMaxMs?: number
}

/**
 * 命名/内联 agent 定义(agent/src/pipeline.ts 与 Worker src/lib/agent.ts 有对应副本)。
 * 同一个形状同时用于「agents/ 里的命名 agent」和「流水线步骤里内联的 agent 对象」:
 * 内联时 systemPrompt 就是本体,命名时它是默认值,缺省仍按名字去 prompts/system/<name>.md 找。
 */
export interface AgentDef {
  /** 内联 system prompt;缺省时按 agent 名回落 prompts/system/<name>.md */
  systemPrompt?: string
  /** 工具集白名单(⊆ pipeline.KNOWN_TOOLS);缺省 = 内置 coder 默认工具集 */
  tools?: string[]
  /** 本 agent 启用的 skills id(⊆ 后台 skillset 里的技能名);缺省 = 不注入技能 */
  skills?: string[]
  /** 本 agent 可用的 mcp 服务 id(⊆ body.mcp.servers 的服务名);缺省 = 不注入 MCP */
  mcp?: string[]
  /** 预留:per-agent 模型覆盖,当前校验但不生效 */
  model?: { name?: string; effort?: string }
}

/**
 * 单个 MCP 服务配置(pi 的 mcpServers 形状子集;Worker src/lib/agent.ts 有对应副本)。
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
  /** http:服务地址 */
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
 * HITL 恢复上下文(见 docs/FORGE2.md §17.14):人门(approve/choose)节点暂停时由 agent 落盘
 * (经 /internal/jobs/:id/wait 存 R2),用户作答后 Worker 原样作为 body.resume 下发,新实例据此
 * 跳过已完成步骤、从门后继续 DAG。baseline/sourceBefore/outputs 是把内存态序列化,否则新实例
 * 拿不到「最近一次成功构建的源码」「空转检测基线」「前序步骤的 output」。
 */
export interface ResumeContext {
  /** 人门节点之前已完成(或条件跳过)的步骤 id;续跑时跳过 */
  doneStepIds: string[]
  /** 暂停在哪个门节点(续跑时连同它一起跳过,下游从门后开始) */
  gateStepId: string
  kind: 'approve' | 'choose'
  question: string
  options?: string[]
  /** 已累积的交付说明 / 最后一个 agent 的收尾正文 */
  deliverSummary: string
  lastAgentSummary: string
  /** 最近一次成功构建的源码(供下游 rollback:true 构建回滚);从未构建成功为 null */
  baseline: FileMap | null
  built: boolean
  /** 暂停时剩余预算(ms);续跑按它钳住,不拿新实例的 3600s 全新预算 */
  remainingMs: number
  /** 空转检测基线(generate 的初始源码树);chat 为 null */
  sourceBefore: FileMap | null
  /** 前序步骤的 output(step id → field → 值),续跑时还原供下游 {{ steps.x.outputs.y }} 引用 */
  outputs: Record<string, Record<string, string>>
  /**
   * 暂停时实际执行的编排节点快照(JSON.stringify(steps))。续跑用它固定版本:后台在等待期间改了
   * 编排的话,旧的 doneStepIds / gateStepId 仍与这份快照一致,不会出现「门 id 失配」或回退循环。
   */
  stepsJson: string
  /** 用户随需求上传的附件(续跑时重放,否则下游图片/文本附件会丢) */
  attachments?: RunAttachment[]
  /** 本轮已授权的连接器(续跑时重放) */
  connectors?: ConnectorGrant[]
}

/** POST /run 请求体 */
export interface RunRequest {
  jobId: string
  projectId: string
  type: 'generate' | 'chat'
  /** generate:用户想法 */
  idea?: string
  /** chat:修改要求 */
  message?: string
  /** 补充要求(generate/chat 通用) */
  note?: string
  /**
   * 平台界面语言(Worker 传来的 body.lang):决定**平台自身**的文案(任务进度、错误提示),
   * 不决定产物语言 —— 产物语言由需求正文自动检测(见 lang.ts)。
   */
  lang?: UiLang
  /** 后台配置的模型覆盖;缺省时使用 Cloud Run env 的默认配置 */
  model?: ModelOverride
  /**
   * 全局编排流水线(JSON 字符串,teamai workflow 子集,见 docs/FORGE2.md §17.9)。
   * 空/非法时 agent 用内置默认编排。与模型配置解耦,作为顶层字段独立下发。
   */
  pipeline?: string
  /**
   * 提示词文件树(路径 → 模板文本),来自后台上传的提示词压缩包(Worker 解包后下发)。
   * 缺省时用镜像内置默认提示词树;带上的文件按路径覆盖默认(部分覆盖 = 部分回落默认)。
   */
  promptFiles?: FileMap
  /**
   * 命名 agent 注册表(name → 定义),来自后台上传的 agents 配置(R2 agentset.json)。
   * 缺省时只有内置 planner/coder/reviewer;带上的名字可被流水线 `"agent": "<name>"` 引用。
   */
  agents?: Record<string, AgentDef>
  /**
   * 技能文件树(skills/<name>/<file> → 内容),来自后台 skillset.zip。
   * 缺省 = 不启用技能;agent 解包到 .skills/ 后按 agent 声明的 skills 子集注入 system prompt。
   */
  skillFiles?: FileMap
  /** 全量 MCP 服务配置(来自后台 mcpset.json);缺省 = 不启用 MCP */
  mcp?: McpConfig
  /** HITL 恢复上下文:人门节点暂停后用户作答,新实例带着它从门后继续 */
  resume?: ResumeContext
  /** 用户对人门节点的作答(choose = 选中的选项;approve = 确认/补充反馈文本) */
  answer?: string
  /** choose 门:选中的选项(与 answer 同值,给下游模板更语义化的变量) */
  answerChoice?: string
  /**
   * 该通道同时执行的任务数(0 = 不限制);缺省时用 env 的 AGENT_QUEUE_CONCURRENCY。
   * 只限制「任务并发」,不改变 Cloud Run --concurrency(单实例能接多少请求)。
   */
  queueConcurrency?: number
  /** chat:当前最新版本的源码树(Worker 从 D1 取出后带上),agent 在其上修改 */
  currentFiles?: FileMap
  /** chat:此前的对话历史(用户/助手交替),供 agent 理解上下文,实现连续对话 */
  history?: { role: 'user' | 'assistant'; content: string }[]
  /** 用户随消息上传的图片/文本附件(generate 与 chat 通用) */
  attachments?: RunAttachment[]
  /** 本轮已授权的外部连接器(见 docs/CONNECTORS.md);无则 undefined,行为与从前完全一致 */
  connectors?: ConnectorGrant[]
  /**
   * 完整过程日志(逐 token 正文 / 思考 / 工具调用)是否回传 Worker 进 agent_log。
   * 只在本地开发(Worker 侧 ENVIRONMENT=local)时开启;线上该字段缺省,
   * 完整日志仍只写 Cloud Run stdout,避免把 D1 当消息总线写爆。
   */
  streamLog?: boolean
  /** Cloudflare 回调基址,如 https://forge-v2.xxx.workers.dev */
  callbackBase: string
}

/** POST /run 响应体(成功时) */
export interface RunResult {
  /** 源码树(交付/续聊用,写 D1) */
  src: FileMap
  /** 构建产物 dist(写 R2) */
  dist: FileMap
  manifest: ArtifactManifest
  plan?: Plan
  /** agent 收尾的交付说明(Markdown),作为对话里 assistant 的回复持久化 */
  summary?: string
}