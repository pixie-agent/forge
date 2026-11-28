/**
 * 提示词文件系统加载器(见 docs/FORGE2.md §17.10 与 agent/orchestration/AGENTS.md)。
 *
 * 提示词不再内联在 TS 里,而是一棵文件树(<dir> 下的 shared/ system/ user/),
 * 每个文件是带 `{{变量}}` 占位符的模板;这里把整棵树读进来、按 mode 选片段、做插值。
 * 与流水线共用同一套 `{{ }}` 语法(interpolate),「文件即数据」——默认树与编排同住
 * agent/orchestration/(pipeline.default.json + prompts/),自定义提示词压缩包解压进
 * <workspace>/.prompts/ 后按路径覆盖默认树。
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunRequest } from './types.js'
import { langName, localeCode, type OutputLang } from './lang.js'
import { attachmentsBrief } from './attachments.js'
import { connectorsBrief } from './connectors.js'

export type PromptAgent = string
export type PromptMode = 'generate' | 'chat'
export type UserPromptKind = 'planner' | 'generate' | 'chat' | 'polish' | 'deliveryNote'

/** 模板变量替换:`{{ 变量名 }}` → vars 里同名字段(花括号内允许带空格、点号);不存在的名字原样保留(便于发现漏配) */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => (k in vars ? vars[k] : m))
}

/** 递归读取目录下所有文件为 { 相对路径(用 / 分隔) → 内容 } */
async function readTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  async function walk(rel: string): Promise<void> {
    const entries = await readdir(join(dir, rel), { withFileTypes: true })
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(r)
      else if (e.isFile()) out[r] = await readFile(join(dir, r), 'utf8')
    }
  }
  await walk('')
  return out
}

/** 文件名 → 变量名:data-sdk → dataSdk;lang-block.generate → langBlockGenerate */
function varName(fileName: string): string {
  const base = fileName.replace(/\.md$/, '')
  return base.replace(/[-.]([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

export interface PromptContext {
  req: RunRequest
  lang: OutputLang
  mode: PromptMode
  imageInputEnabled: boolean
}

export interface PromptSet {
  /** 命名 agent 的 system prompt(按 ctx.mode 选语言块/语言检查) */
  system(agent: PromptAgent): string
  /** user prompt(planner/generate/chat/polish/deliveryNote) */
  user(kind: UserPromptKind): string
  /** 流水线模板变量:含解析好的 plannerPrompt / coderPrompt / reviewerPrompt */
  vars(): Record<string, string>
}

export async function loadPromptSet(dir: string, ctx: PromptContext, overrideDir?: string): Promise<PromptSet> {
  const files = await readTree(dir)
  // 覆盖目录(自定义压缩包解压出的)按路径覆盖默认树,缺的文件仍回落默认 —— 支持部分覆盖
  if (overrideDir) {
    const over = await readTree(overrideDir)
    for (const [path, content] of Object.entries(over)) files[path] = content
  }

  // 1) 基础动态变量:语言 + 需求原始字段 + 组合字段 + 连接器/附件清单
  const name = langName(ctx.lang)
  const idea = ctx.req.idea?.trim() ?? ''
  const note = ctx.req.note?.trim() ?? ''
  const message = ctx.req.message?.trim() ?? ''
  const ideaWithNote = [idea, note ? `\n\n用户补充要求(务必落实):${note}` : ''].join('')
  const requirement = [message, note ? `\n补充要求:${note}` : ''].join('')
  const history = ctx.req.history?.length
    ? `\n\n此前对话(供你理解上下文与用户意图;若与下面的「修改要求」冲突,以「修改要求」为准):\n` +
      ctx.req.history
        .map((h) => `${h.role === 'user' ? '用户' : '你'}:${h.content.replace(/\s+/g, ' ').slice(0, 600)}`)
        .join('\n')
    : ''
  const connectors = connectorsBrief(ctx.req.connectors)
  const attachments = ctx.req.attachments?.length ? attachmentsBrief(ctx.req.attachments, ctx.imageInputEnabled) : ''
  const briefs = [connectors, attachments].filter(Boolean).join('\n\n')

  const base: Record<string, string> = {
    langName: name,
    langCode: ctx.lang,
    localeCode: localeCode(ctx.lang),
    idea,
    note,
    message,
    ideaWithNote,
    requirement,
    history,
    connectors,
    attachments,
    briefs,
  }

  // 2) shared/ 下的片段先拿 base 插值(它们只引用 langName/localeCode 等基础变量)
  const shared: Record<string, string> = {}
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith('shared/')) continue
    shared[varName(path.slice('shared/'.length))] = interpolate(content, base)
  }

  // 3) 全量变量 = base + shared + mode 选定的 langBlock / reviewerLang / polishLang
  const modeKey = ctx.mode === 'chat' ? 'chat' : 'generate'
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const all: Record<string, string> = {
    ...base,
    ...shared,
    langBlock: shared[`langBlock${cap(modeKey)}`] ?? '',
    reviewerLang: shared[`reviewerLang${cap(modeKey)}`] ?? '',
    polishLang: shared[`polishLang${cap(modeKey)}`] ?? '',
  }

  const resolve = (path: string) => interpolate(files[path] ?? '', all).trim()

  const userFile: Record<UserPromptKind, string> = {
    planner: 'user/planner.md',
    generate: 'user/generate.md',
    chat: 'user/chat.md',
    polish: 'user/polish.md',
    deliveryNote: 'user/delivery-note.md',
  }

  // 命名 agent 的 system prompt 一律按名字找 system/<name>.md(内置 planner/coder/reviewer
  // 走同一条路);缺文件返回空串,由调用方(见 runner.ts 的 resolveAgent)回落内置默认。
  const system = (agent: PromptAgent) => resolve(`system/${agent}.md`)
  const user = (kind: UserPromptKind) => resolve(userFile[kind])

  return {
    system,
    user,
    vars: () => ({
      langName: name,
      langCode: ctx.lang,
      localeCode: localeCode(ctx.lang),
      idea,
      note,
      message,
      history,
      connectors,
      attachments,
      // 用户对人门节点的作答(HITL,见 docs/FORGE2.md §17.14);无门时为空串
      answer: ctx.req.answer ?? '',
      answerChoice: ctx.req.answerChoice ?? '',
      plannerPrompt: user('planner'),
      coderPrompt: user(ctx.mode === 'chat' ? 'chat' : 'generate'),
      reviewerPrompt: user('polish'),
    }),
  }
}
