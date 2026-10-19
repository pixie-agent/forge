/**
 * 对话附件(用户提需求时随消息上传的图片/文本文件)。
 *
 * 只做「一次性随任务派发」的透传:附件不落 D1(单条 4MB 会撑爆行/语句上限),
 * 也不进 jobs.payload(重试只重发文本)。用户消息里追加一行附件清单作为持久痕迹,
 * 真实字节只跟着这次 dispatch 走到 Cloud Run 的 agent。
 */

/** 单张图片上限:与生成应用的 blob 接口(2MB)保持一致,前端同一套提示 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
/** 单个文本文件上限 */
export const MAX_TEXT_BYTES = 256 * 1024
/** 单条消息附件个数上限 */
export const MAX_ATTACHMENTS = 3
/** 单条消息附件合计上限(解码后字节数) */
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024

/**
 * 生成过程中「追加要求」的附件上限(见 docs/FORGE2.md §5.2)。
 * 比首次提交更紧:追加走的是 D1 投递队列 + 5s 心跳轮询,附件 base64 要整行塞进
 * job_messages(D1 单行/单值上限 2MB),所以按 1.2MB 原文件(约 1.6MB base64)留出余量。
 */
export const MAX_STEER_IMAGE_BYTES = 1024 * 1024
export const MAX_STEER_TEXT_BYTES = 128 * 1024
export const MAX_STEER_TOTAL_BYTES = 1_200_000

export interface AttachmentLimits {
  maxCount: number
  imageBytes: number
  textBytes: number
  totalBytes: number
}

/** 首次提交(generate / chat)的限额 */
export const SEND_LIMITS: AttachmentLimits = {
  maxCount: MAX_ATTACHMENTS,
  imageBytes: MAX_IMAGE_BYTES,
  textBytes: MAX_TEXT_BYTES,
  totalBytes: MAX_TOTAL_BYTES,
}

/** 生成中追加(steer)的限额 */
export const STEER_LIMITS: AttachmentLimits = {
  maxCount: MAX_ATTACHMENTS,
  imageBytes: MAX_STEER_IMAGE_BYTES,
  textBytes: MAX_STEER_TEXT_BYTES,
  totalBytes: MAX_STEER_TOTAL_BYTES,
}

/** 扩展名 → MIME(白名单即唯一真相:不认的类型直接拒,避免把二进制塞给模型) */
export const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

export const TEXT_TYPES: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  js: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  html: 'text/html',
  css: 'text/css',
  py: 'text/x-python',
  go: 'text/x-go',
  java: 'text/x-java',
  sql: 'text/x-sql',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  xml: 'text/xml',
}

/** 派发给 agent 的附件(与 agent/src/types.ts 的 RunAttachment 对齐) */
export interface AgentAttachment {
  name: string
  mimeType: string
  /** base64(不含 data: 前缀) */
  data: string
}

export function attachmentTypeOf(name: string): { mimeType: string; kind: 'image' | 'text' } | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_TYPES[ext]) return { mimeType: IMAGE_TYPES[ext], kind: 'image' }
  if (TEXT_TYPES[ext]) return { mimeType: TEXT_TYPES[ext], kind: 'text' }
  return null
}

/** 前端 accept 属性用的扩展名清单(与上面两张表同源) */
export const ACCEPT_ATTR = [...Object.keys(IMAGE_TYPES), ...Object.keys(TEXT_TYPES)].map((e) => `.${e}`).join(',')

/** base64 字符串的解码后字节数(不真的解码,避免为校验付出一次 4MB 的 decode) */
function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.floor((data.length * 3) / 4) - padding
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

/** 文件名只保留末段 + 去掉路径分隔与控制字符(它只用于提示词展示和 agent 侧落盘) */
function safeName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  return base.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) || 'attachment'
}

/**
 * 校验并归一化前端传来的附件载荷。返回 `{ attachments }` 或 `{ error }`;
 * 前端已做过一遍同样规则的校验,这里是权威判定(直接调 API 也拦得住)。
 * `limits` 区分「首次提交」与「生成中追加」两套上限。
 */
export function parseAttachments(
  raw: unknown,
  limits: AttachmentLimits = SEND_LIMITS
): { attachments: AgentAttachment[]; error?: undefined } | { attachments?: undefined; error: string } {
  if (raw === undefined || raw === null) return { attachments: [] }
  if (!Array.isArray(raw)) return { error: '附件格式不合法' }
  if (raw.length === 0) return { attachments: [] }
  if (raw.length > limits.maxCount) return { error: `单条消息最多附 ${limits.maxCount} 个文件` }

  const out: AgentAttachment[] = []
  let total = 0
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { error: '附件格式不合法' }
    const rec = item as Record<string, unknown>
    if (typeof rec.name !== 'string' || typeof rec.data !== 'string' || !rec.data) return { error: '附件格式不合法' }
    const name = safeName(rec.name)
    const kind = attachmentTypeOf(name)
    if (!kind) return { error: `不支持的文件类型:${name}` }
    if (!BASE64_RE.test(rec.data)) return { error: `附件内容不是合法的 base64:${name}` }
    const bytes = base64Bytes(rec.data)
    const limit = kind.kind === 'image' ? limits.imageBytes : limits.textBytes
    if (bytes > limit) return { error: `${name} 超过 ${Math.round(limit / 1024)}KB 上限` }
    total += bytes
    if (total > limits.totalBytes) return { error: `附件合计超过 ${Math.round(limits.totalBytes / 1024)}KB 上限` }
    // 前端声明的 MIME 可能不准(部分浏览器给空串),以扩展名判定为准
    out.push({ name, mimeType: kind.mimeType, data: rec.data })
  }
  return { attachments: out }
}

/** 落进用户消息文本的附件清单(刷新后仍能看到当时附了什么) */
export function attachmentMarkdown(attachments: AgentAttachment[] | undefined): string {
  if (!attachments?.length) return ''
  const names = attachments.map((a) => a.name).join('、')
  return `\n\n📎 附件 ${attachments.length} 个:${names}`
}
