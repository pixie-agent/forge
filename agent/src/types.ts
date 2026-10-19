/** Cloudflare Worker ↔ Cloud Run agent 之间的请求/回传协议(Worker 侧 src/lib/agent.ts 有对应副本) */

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

export interface ArtifactManifest {
  /** 入口 HTML(默认 index.html) */
  entry: string
  buildHash: string
  files: { path: string; size: number }[]
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
  /** chat:当前最新版本的源码树(Worker 从 D1 取出后带上),agent 在其上修改 */
  currentFiles?: FileMap
  /** chat:此前的对话历史(用户/助手交替),供 agent 理解上下文,实现连续对话 */
  history?: { role: 'user' | 'assistant'; content: string }[]
  /** 用户随消息上传的图片/文本附件(generate 与 chat 通用) */
  attachments?: RunAttachment[]
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