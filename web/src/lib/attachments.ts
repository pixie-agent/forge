/**
 * 对话附件的浏览器侧处理:选择/粘贴 → 本地校验 → 转 base64 → 随消息提交。
 *
 * 这里的上限必须与 Worker 侧 src/lib/attachments.ts 一致(那边是权威判定,
 * 这里只是提前拦住,免得用户等一次 400 才知道超限)。两套上限:
 * - SEND_LIMITS:首次提交(generate / chat);
 * - STEER_LIMITS:生成过程中追加要求(steer),要整行塞进 D1 投递队列,所以更紧。
 *
 * 文案用非组件的 tStatic 取词(见 lib/i18n):这些函数不在 React 里,语言取模块级的当前语言。
 */

import { tStatic } from './i18n'

export interface AttachmentLimits {
  /** 单条消息附件个数上限 */
  maxCount: number
  /** 单张图片上限(字节) */
  imageBytes: number
  /** 单个文本文件上限(字节) */
  textBytes: number
  /** 单条消息附件合计上限(字节) */
  totalBytes: number
}

const MB = 1024 * 1024

/** 首次提交(generate / chat);与 Worker 侧 SEND_LIMITS 对齐 */
export const SEND_LIMITS: AttachmentLimits = { maxCount: 3, imageBytes: 2 * MB, textBytes: 256 * 1024, totalBytes: 4 * MB }

/** 生成中追加(steer);与 Worker 侧 STEER_LIMITS 对齐(约 1.6MB base64,避开 D1 单行 2MB 上限) */
export const STEER_LIMITS: AttachmentLimits = { maxCount: 3, imageBytes: MB, textBytes: 128 * 1024, totalBytes: 1_200_000 }

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif']
const TEXT_EXT = [
  'txt', 'md', 'markdown', 'csv', 'json', 'js', 'jsx', 'ts', 'tsx',
  'html', 'css', 'py', 'go', 'java', 'sql', 'yml', 'yaml', 'xml',
]

/** 文件选择框的 accept(与 Worker 白名单同源) */
export const ACCEPT_ATTR = [...IMAGE_EXT, ...TEXT_EXT].map((e) => `.${e}`).join(',')

/** 待发送的附件(含本地预览用信息) */
export interface PendingAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  kind: 'image' | 'text'
  /** base64(不含 data: 前缀) */
  data: string
  /** 仅图片:本地缩略图 URL,发送后/移除时释放 */
  previewUrl?: string
}

/** 真正提交给后端的字段 */
export interface OutgoingAttachment {
  name: string
  mimeType: string
  data: string
}

export function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

/** 能不能收这个文件;不能收则返回给用户看的原因。limits 按「首次提交 / 生成中追加」两套上限传入 */
export function rejectReason(file: File, limits: AttachmentLimits = SEND_LIMITS): string | null {
  const ext = extOf(file.name)
  const isImage = IMAGE_EXT.includes(ext)
  const isText = TEXT_EXT.includes(ext)
  if (!isImage && !isText)
    return tStatic('attach.rejectType', { name: file.name, imageExt: IMAGE_EXT.join('/'), textExt: TEXT_EXT.join('/') })
  const limit = isImage ? limits.imageBytes : limits.textBytes
  if (file.size > limit) return tStatic('attach.rejectSize', { name: file.name, kb: Math.round(limit / 1024) })
  if (file.size === 0) return tStatic('attach.rejectEmpty', { name: file.name })
  return null
}

/**
 * 粘贴板里的图片常常没有文件名(或只有一段通用名),没有扩展名就没法过白名单,
 * 这里按 MIME 补一个;补不出来就原样返回,交给 rejectReason 去拒。
 */
export function withPastedName(file: File): File {
  if (extOf(file.name)) return file
  const mime = file.type.split('/')[1]
  if (!mime) return file
  const ext = mime === 'jpeg' ? 'jpg' : mime.replace(/[^a-z0-9]/gi, '')
  if (!ext) return file
  return new File([file], tStatic('attach.pastedFileName', { ts: Date.now() }) + `.${ext}`, { type: file.type })
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(tStatic('attach.fileReadError', { name: file.name })))
    reader.onload = () => {
      const text = String(reader.result)
      const comma = text.indexOf(',')
      resolve(comma >= 0 ? text.slice(comma + 1) : text)
    }
    reader.readAsDataURL(file)
  })
}

/** 把用户选中的文件转成待发送附件(调用方负责先跑 rejectReason 与数量/总量校验) */
export async function toPending(file: File): Promise<PendingAttachment> {
  const ext = extOf(file.name)
  const kind: 'image' | 'text' = IMAGE_EXT.includes(ext) ? 'image' : 'text'
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type || (kind === 'image' ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : 'text/plain'),
    size: file.size,
    kind,
    data: await fileToBase64(file),
    previewUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/** 已选附件的合计大小(解码后) */
export function totalBytes(list: PendingAttachment[]): number {
  return list.reduce((sum, a) => sum + a.size, 0)
}

/** 追加到用户消息文本里的附件清单(与服务端 attachmentMarkdown 同格式,刷新后一致) */
export function attachmentMarker(attachments: readonly { name: string }[] | undefined): string {
  if (!attachments?.length) return ''
  return tStatic('attach.marker', {
    count: attachments.length,
    names: attachments.map((a) => a.name).join(tStatic('chat.listSep')),
  })
}

/** 释放本地缩略图 URL */
export function releasePreview(list: PendingAttachment[]): void {
  for (const a of list) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
}
