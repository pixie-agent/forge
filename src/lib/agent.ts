/** 把 job 派发给 Cloud Run 的 agent service,并接收其回传的多文件产物(源码树 + 构建产物) */

import type { Env, ConnectorGrant, Plan } from '../types'
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
 * 只传配置,不传密钥 —— agent 仍然从 Cloud Run env 读取 LLM_API_KEY。
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
  reasoning?: boolean
  imageInput?: boolean
  designReview?: 'off' | 'generate' | 'always'
  maxRunMs?: number
  polishMaxMs?: number
}

/** POST {AGENT_URL}/run 请求体(与 agent/src/types.ts 的 RunRequest 对齐) */
export interface AgentRunRequest {
  jobId: string
  projectId: string
  type: 'generate' | 'chat'
  idea?: string
  message?: string
  note?: string
  /** 后台配置的模型覆盖;缺省时 agent 使用 Cloud Run env 的默认模型 */
  model?: AgentModelOverride
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
  const timeoutMs = Number(env.AGENT_DISPATCH_TIMEOUT_MS ?? 0)
  const target = (agentUrl || env.AGENT_URL).replace(/\/+$/, '')
  const res = await fetch(`${target}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Secret': env.AGENT_SECRET },
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
    throw new Error(message || `Agent 执行失败(${res.status}),请重试(未扣除积分)`)
  }
  const data = JSON.parse(text) as AgentRunResult
  if (!data?.src || !data.dist || !data.manifest) throw new Error('Agent 未返回有效产物,请重试(未扣除积分)')
  return data
}