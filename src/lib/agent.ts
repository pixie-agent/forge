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

/** POST {AGENT_URL}/run 请求体(与 agent/src/types.ts 的 RunRequest 对齐) */
export interface AgentRunRequest {
  jobId: string
  projectId: string
  type: 'generate' | 'chat'
  idea?: string
  message?: string
  note?: string
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

/** 派发到 Cloud Run。请求在 Cloud Run 侧一直持有到 agent 跑完(请求级计费,用完即缩容) */
export async function dispatchAgent(env: Env, input: Omit<AgentRunRequest, 'callbackBase'>): Promise<AgentRunResult> {
  const body: AgentRunRequest = { ...input, callbackBase: env.PUBLIC_BASE_URL }
  const timeoutMs = Number(env.AGENT_DISPATCH_TIMEOUT_MS ?? 0)
  const res = await fetch(`${env.AGENT_URL.replace(/\/+$/, '')}/run`, {
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