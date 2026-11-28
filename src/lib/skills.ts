/**
 * 技能压缩包:存储 / 校验 / 下发(见 docs/FORGE2.md §17.12)。
 *
 * 技能是「文件树」(skills/<name>/ 下的 SKILL.md + 附属文件),与提示词同构:运营把整棵技能树
 * 打成一个 zip 上传,Worker 存进 R2(键 skillset.zip),派发时解出来作为 body.skillFiles 下发;
 * agent 解到工作区 .skills/ 后用 pi loadSkillsFromDir 加载,再按 agent 声明的 skills 子集
 * 注入 system prompt。agent 侧无需 zip 库 —— 收到的就是「路径 → 文本」清单。
 */

import { unzipSync } from 'fflate'
import type { Env } from '../types'
import type { FileMap } from './agent'
import { createZip } from './zip'

/** R2 里「当前生效」技能压缩包的固定键 */
export const SKILLS_OBJECT_KEY = 'skillset.zip'
/** 压缩包大小上限(纯文本,给足余量) */
const MAX_SKILLS_ZIP_BYTES = 2 * 1024 * 1024
/** 技能名(目录名)上限 */
const MAX_SKILL_NAME = 60
/** 最多技能数 */
const MAX_SKILLS = 100
/** 技能路径:skills/<name>/<file…>,name = ^[a-z][a-z0-9_-]*$;SKILL.md 须在技能根,附属文件可多层(与 push.mjs 递归收集一致) */
const SKILL_PATH_RE = /^skills\/([a-z][a-z0-9_-]*)\/([^/]+(?:\/[^/]+)*)$/

/** 校验「路径 → 内容」技能树(上传/在线保存共用);合法返回 null,非法返回中文错误 */
export function validateSkillFiles(files: Record<string, string>): string | null {
  const entries = Object.entries(files)
  if (entries.length === 0) return '技能树为空'
  let total = 0
  const names = new Set<string>()
  const hasSkillMd = new Set<string>()
  for (const [path, content] of entries) {
    if (path.includes('..') || path.startsWith('/')) return `非法路径:${path}`
    const m = SKILL_PATH_RE.exec(path)
    if (!m) return `技能路径必须是 skills/<name>/<file>,name 匹配 ^[a-z][a-z0-9_-]*$:${path}`
    const name = m[1]
    if (name.length > MAX_SKILL_NAME) return `技能名过长(>${MAX_SKILL_NAME}):${name}`
    if (content.trim() === '') return `技能文件不能为空:${path}`
    names.add(name)
    if (m[2] === 'SKILL.md') hasSkillMd.add(name)
    total += new TextEncoder().encode(content).length
  }
  if (names.size > MAX_SKILLS) return `技能数超过上限(>${MAX_SKILLS})`
  for (const name of names) {
    if (!hasSkillMd.has(name)) return `技能 ${name} 缺少 SKILL.md(技能入口)`
  }
  if (total > MAX_SKILLS_ZIP_BYTES) return '技能总大小超过 2MB'
  return null
}

/** 解一个 zip 字节为技能树;非法返回中文错误(后台直接展示) */
export function unzipSkills(zip: Uint8Array): { files?: FileMap; error?: string } {
  if (zip.byteLength === 0) return { error: '压缩包为空' }
  if (zip.byteLength > MAX_SKILLS_ZIP_BYTES) return { error: '压缩包过大(超过 2MB)' }
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zip)
  } catch {
    return { error: '不是合法的 zip 压缩包' }
  }
  const files: FileMap = {}
  for (const [path, data] of Object.entries(entries)) {
    // 路径穿越 / 绝对路径一律拒绝;非技能路径(如打包时混入的 README)自然跳过
    if (path.includes('..') || path.startsWith('/')) return { error: `压缩包内有非法路径:${path}` }
    if (!SKILL_PATH_RE.test(path)) continue
    files[path] = new TextDecoder().decode(data)
  }
  const err = validateSkillFiles(files)
  if (err) return { error: err }
  return { files }
}

/** 读 R2 里的技能压缩包并解成文件树;无对象/非法返回 undefined(agent 不启用技能) */
export async function getSkillFiles(env: Env): Promise<FileMap | undefined> {
  const obj = await env.PROMPTS.get(SKILLS_OBJECT_KEY)
  if (!obj) return undefined
  const zip = new Uint8Array(await obj.arrayBuffer())
  return unzipSkills(zip).files
}

/** 在线保存:校验整棵技能树后打 zip 覆盖 current(技能无内置默认,不建历史版本) */
export async function putSkillFiles(env: Env, files: FileMap): Promise<void> {
  await env.PROMPTS.put(SKILLS_OBJECT_KEY, createZip(files), { httpMetadata: { contentType: 'application/zip' } })
}

/** 上传归档:解包校验后覆盖 current */
export async function putSkillZip(env: Env, zip: Uint8Array): Promise<void> {
  await env.PROMPTS.put(SKILLS_OBJECT_KEY, zip, { httpMetadata: { contentType: 'application/zip' } })
}

/** 下载当前技能树(有效树);无配置时返回空 zip */
export async function downloadSkillZip(env: Env): Promise<Uint8Array> {
  const files = await getSkillFiles(env)
  return createZip(files ?? {})
}

/** 后台编辑器所需元信息 + 当前技能文件树(无配置时为空列表) */
export async function skillsInfo(env: Env): Promise<{
  active: boolean
  updated_at: string | null
  size: number
  files: { path: string; content: string; size: number }[]
}> {
  const obj = await env.PROMPTS.get(SKILLS_OBJECT_KEY)
  let files: FileMap = {}
  if (obj) {
    const zip = new Uint8Array(await obj.arrayBuffer())
    files = unzipSkills(zip).files ?? {}
  }
  const list = Object.entries(files)
    .map(([path, content]) => ({ path, content, size: new TextEncoder().encode(content).length }))
    .sort((a, b) => a.path.localeCompare(b.path))
  return { active: !!obj, updated_at: obj?.uploaded.toISOString() ?? null, size: obj?.size ?? 0, files: list }
}
