/**
 * 提示词压缩包:存储 / 校验 / 预览 / 下发(见 docs/FORGE2.md §17.10)。
 *
 * 提示词是「文件树」(shared/ system/ user/ 下的 .md 模板),运营把整棵树打成一个 zip 上传,
 * Worker 存进 R2(一个对象 = 一份原子版本),派发时解出来作为 `body.promptFiles` 发给 agent;
 * 后台预览也是在这里解包列目录。agent 侧无需 zip 库 —— 收到的就是「路径 → 文本」的清单。
 */

import { unzipSync } from 'fflate'
import type { Env } from '../types'
import { DEFAULT_PROMPT_FILES } from './prompt-defaults'
import { createZip } from './zip'

/** R2 里「当前生效」提示词压缩包的固定键(每次上传/恢复都重写这个键) */
export const PROMPTS_OBJECT_KEY = 'promptset.zip'
/** 历史版本前缀(不可变归档,key 以时间戳开头保证字典序 = 时间序) */
const PROMPTS_HISTORY_PREFIX = 'promptset-history/'
/** 最多保留的历史版本数,超出按最旧裁剪(单个 ~20KB,50 份 ≈ 1MB,给足余量) */
export const MAX_PROMPT_VERSIONS = 50
/** 压缩包大小上限(提示词是纯文本,几十 KB;这里给足余量防误传超大文件) */
export const MAX_PROMPTS_ZIP_BYTES = 2 * 1024 * 1024
/** 只收这三类目录下、一层深度的 .md 文件(与 agent 的 loader 布局一致) */
const PROMPT_FILE_RE = /^(shared|system|user)\/[^/]+\.md$/

/** 压缩包内的文件树(相对路径 → 文本内容) */
export type PromptFileMap = Record<string, string>

/** 解一个 zip 字节为文件树;非法返回中文错误(后台直接展示) */
export function unzipPrompts(zip: Uint8Array): { files?: PromptFileMap; error?: string } {
  if (zip.byteLength === 0) return { error: '压缩包为空' }
  if (zip.byteLength > MAX_PROMPTS_ZIP_BYTES) return { error: '压缩包过大(超过 2MB)' }
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zip)
  } catch {
    return { error: '不是合法的 zip 压缩包' }
  }
  const files: PromptFileMap = {}
  for (const [path, data] of Object.entries(entries)) {
    // 路径穿越 / 绝对路径一律拒绝;目录条目(data 为空)自然跳过
    if (path.includes('..') || path.startsWith('/')) return { error: `压缩包内有非法路径:${path}` }
    if (!PROMPT_FILE_RE.test(path)) continue
    files[path] = new TextDecoder().decode(data)
  }
  if (Object.keys(files).length === 0) {
    return { error: '压缩包里没有 shared/、system/、user/ 下的 .md 提示词文件' }
  }
  return { files }
}

/** 读 R2 里的提示词压缩包并解成文件树;无对象返回 undefined(agent 回落内置默认) */
export async function getPromptFiles(env: Env): Promise<PromptFileMap | undefined> {
  const obj = await env.PROMPTS.get(PROMPTS_OBJECT_KEY)
  if (!obj) return undefined
  const zip = new Uint8Array(await obj.arrayBuffer())
  return unzipPrompts(zip).files
}

/** 上传归档:写 current + 一份不可变历史版本,再裁剪到最近 N 份 */
export async function putPromptZip(env: Env, zip: Uint8Array): Promise<void> {
  await env.PROMPTS.put(PROMPTS_OBJECT_KEY, zip, { httpMetadata: { contentType: 'application/zip' } })
  await env.PROMPTS.put(`${PROMPTS_HISTORY_PREFIX}${Date.now()}.zip`, zip, {
    httpMetadata: { contentType: 'application/zip' },
  })
  const list = await env.PROMPTS.list({ prefix: PROMPTS_HISTORY_PREFIX })
  const keys = list.objects.map((o) => o.key).sort() // key 以毫秒时间戳开头 → 升序 = 时间升序
  const overflow = keys.length - MAX_PROMPT_VERSIONS
  if (overflow > 0) await env.PROMPTS.delete(keys.slice(0, overflow))
}

export interface PromptVersion {
  /** R2 对象键(promptset-history/<ms>.zip),恢复时原样回传 */
  key: string
  /** 该版本上传时间(ISO) */
  at: string
  size: number
}

/** 历史版本列表,最新在前 */
export async function listPromptVersions(env: Env): Promise<PromptVersion[]> {
  const list = await env.PROMPTS.list({ prefix: PROMPTS_HISTORY_PREFIX })
  return list.objects
    .map((o) => ({ key: o.key, at: o.uploaded.toISOString(), size: o.size }))
    .sort((a, b) => b.key.localeCompare(a.key))
}

/**
 * 恢复:key 为空 → 清空 current(回落内置默认);否则把某历史版本的字节拷回 current。
 * 返回是否成功(历史 key 不合法或不存在返回 false)。
 */
export async function restorePromptVersion(env: Env, key: string | null): Promise<boolean> {
  if (key === null) {
    await env.PROMPTS.delete(PROMPTS_OBJECT_KEY)
    return true
  }
  if (!key.startsWith(PROMPTS_HISTORY_PREFIX)) return false
  const obj = await env.PROMPTS.get(key)
  if (!obj) return false
  const zip = new Uint8Array(await obj.arrayBuffer())
  await env.PROMPTS.put(PROMPTS_OBJECT_KEY, zip, { httpMetadata: { contentType: 'application/zip' } })
  return true
}

/**
 * 「下载当前提示词」:打包**有效树**为 zip —— 默认树(DEFAULT_PROMPT_FILES,构建时快照)
 * 之上叠加自定义压缩包(有则覆盖同名路径)。这样下载到的是 agent 真正会看到的完整树,
 * 改完可直接原样回传,闭环。注意:默认树快照随 Worker 构建更新,若改了 agent/orchestration/prompts
 * 但只发 Worker 没发 agent,下载的默认部分会与镜像内回落默认短暂不一致(双发即一致)。
 */
export async function downloadPromptZip(env: Env): Promise<Uint8Array> {
  const custom = await getPromptFiles(env)
  return createZip({ ...DEFAULT_PROMPT_FILES, ...(custom ?? {}) })
}

/**
 * 后台编辑器所需元信息 + **有效树**(默认 ⊕ 自定义覆盖),始终非空 ——
 * 无自定义时就是 18 个默认文件,运营照样能逐文件编辑、保存成自定义版本。
 */
export async function promptEffectiveInfo(env: Env): Promise<{
  active: boolean
  updated_at: string | null
  size: number
  files: { path: string; content: string; size: number }[]
}> {
  const obj = await env.PROMPTS.get(PROMPTS_OBJECT_KEY)
  let custom: PromptFileMap = {}
  if (obj) {
    const zip = new Uint8Array(await obj.arrayBuffer())
    custom = unzipPrompts(zip).files ?? {}
  }
  const merged = { ...DEFAULT_PROMPT_FILES, ...custom }
  const files = Object.entries(merged)
    .map(([path, content]) => ({ path, content, size: new TextEncoder().encode(content).length }))
    .sort((a, b) => a.path.localeCompare(b.path))
  return { active: !!obj, updated_at: obj?.uploaded.toISOString() ?? null, size: obj?.size ?? 0, files }
}

/** 校验「路径 → 内容」提示词树(供后台在线保存);合法返回 null,非法返回中文错误 */
export function validatePromptFiles(files: PromptFileMap): string | null {
  const entries = Object.entries(files)
  if (entries.length === 0) return '没有 shared/、system/、user/ 下的 .md 提示词文件'
  let total = 0
  for (const [path, content] of entries) {
    if (path.includes('..') || path.startsWith('/')) return `非法路径:${path}`
    if (!PROMPT_FILE_RE.test(path)) return `只收 shared/、system/、user/ 下一层 .md 文件:${path}`
    total += new TextEncoder().encode(content).length
  }
  if (total > MAX_PROMPTS_ZIP_BYTES) return '提示词总大小超过 2MB'
  return null
}

/** 在线保存:把整棵有效树打成 zip 归档为新版本(与上传同一套 current + 历史机制) */
export async function putPromptFiles(env: Env, files: PromptFileMap): Promise<void> {
  await putPromptZip(env, createZip(files))
}
