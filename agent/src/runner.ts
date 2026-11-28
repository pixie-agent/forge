/** 单个 job 的执行:拷脚手架 → 规划 → 实现 → 构建 → 复查 → 收集源码树 + 构建产物 */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import type { AgentConfig } from './config.js'
import type { ProgressReporter, StreamLogger } from './callback.js'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { evalCondition } from './condition.js'
import { parsePlan } from './plan.js'
import { interpolate, loadPromptSet } from './prompts.js'
import {
  AGENTS,
  defaultPipeline,
  parsePipeline,
  SCHEMA_VERSION,
  topologicalOrder,
  type PipelineAgentStep,
  type PipelineGateStep,
  type PipelineStep,
} from './pipeline.js'
import { resolveOutputLang, localeCode, matchesLang } from './lang.js'
import { isUiLang, t, type UiLang } from './i18n.js'
import { createForgeSession, createModelContext } from './session.js'
import { ATTACHMENT_DIR, attachmentFileName } from './attachments.js'
import { CONNECTOR_DIR, materializeConnectors } from './connectors.js'
import type { ArtifactManifest, FileMap, Plan, ResumeContext, RunRequest, RunResult, RunUsage } from './types.js'

const execFileAsync = promisify(execFile)

/** 提示词覆盖树在工作目录里的落点(后台上传的压缩包解包到这里,不进源码树) */
const PROMPT_DIR = '.prompts'
/** 技能树在工作目录里的落点(后台上传的 skillset.zip 解包到这里,不进源码树) */
const SKILLS_DIR = '.skills'
/** 收集源码树时跳过的目录(依赖、临时、构建产物、用户附件、连接器凭证、提示词覆盖树、技能树) */
const SKIP_DIRS = new Set(['node_modules', '.pi', '.git', 'dist', ATTACHMENT_DIR, CONNECTOR_DIR, PROMPT_DIR, SKILLS_DIR])
/** 顶层不作为“源码”交付的文件(计划文件 / 需求说明书) */
const SKIP_ROOT_FILES = new Set(['plan.json', 'spec.md'])
const BUILD_TIMEOUT_MS = 5 * 60 * 1000
const MAX_FILE_PREVIEW = 20_000
/** 交付说明语言不对时的重问:预算上限与最低剩余量 */
const DELIVERY_RETRY_BUDGET_MS = 90_000
const DELIVERY_RETRY_MIN_MS = 120_000

/**
 * 平台自有文件:模型不得修改,每次 job 开始时从模板强制覆盖回工作目录
 * (旧的生成结果里被改坏的 forge.js / index.css 等,在这里被纠正)。
 */
const PLATFORM_FILES = [
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'package-lock.json',
  'index.html',
  'package.json',
  'vite.config.js',
  'src/main.jsx',
  'src/index.css',
  'src/lib/cx.js',
  'src/lib/forge.js',
  'src/lib/connectors.js',
  'src/lib/locale.js',
  'src/lib/motion.jsx',
  'src/lib/store.js',
]
/** 平台自有目录:整体覆盖;其中 tokens.css 是模型唯一允许改的(保留模型选择的品牌色) */
const PLATFORM_DIRS = ['src/components/ui', 'src/styles']
const PLATFORM_KEEP = new Set(['src/styles/tokens.css'])


/** 从工具名与入参里判断本次写入的目标文件路径 */
function writtenPath(toolName: string, args: Record<string, unknown> | undefined): string | null {
  if (toolName !== 'write' && toolName !== 'edit') return null
  const p = args?.path ?? args?.file_path
  return typeof p === 'string' ? p : null
}

/** 工具调用的单行摘要(文件名或命令首行),用于流式日志里一眼看清 agent 在做什么 */
function toolArgSummary(args: Record<string, unknown> | undefined): string {
  if (!args) return ''
  const p = args.path ?? args.file_path
  if (typeof p === 'string') return ` ${p.split(sep).pop()}`
  const cmd = args.command
  if (typeof cmd === 'string') return ` ${cmd.split('\n')[0].slice(0, 120)}`
  return ''
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * 两版源码是否完全一致。用于识别「模型什么都没写就结束」——
 * 线上事故:provider 401 被 pi 降级成空轮次,构建仍能通过未改动的脚手架,
 * 于是用户看到"秒回旧页面"。没有代码改动就不该交付。
 */
function sourcesEqual(a: FileMap, b: FileMap): boolean {
  const ak = Object.keys(a)
  if (ak.length !== Object.keys(b).length) return false
  return ak.every((k) => a[k] === b[k])
}

/** 从文本里提取首个合法 JSON 对象(取第一个 { 到最后一个 },再 JSON.parse);失败返回 null */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  const candidate = text.slice(start, end + 1)
  try {
    const v = JSON.parse(candidate) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 判别门节点(approve/choose 至少其一);用它做类型收窄(比裸 `in` 可靠:字段是可选的) */
function isGateStep(s: PipelineStep): s is PipelineGateStep {
  return 'approve' in s || 'choose' in s
}

/**
 * 从恢复上下文还原暂停时的编排节点快照(固定版本)。快照缺失/损坏时返回 null,
 * 由调用方回落「重新派生」—— 正常续跑路径总是带上快照,这里只是纵深防御。
 */
function restoreStepsSnapshot(json: string | undefined): PipelineStep[] | null {
  if (!json) return null
  try {
    const raw = JSON.parse(json) as unknown
    if (!Array.isArray(raw)) return null
    // 复用 parsePipeline 的校验(与「校验通过」同一语义):包一层定义再解析
    return parsePipeline(JSON.stringify({ schemaVersion: SCHEMA_VERSION, steps: raw }))
  } catch {
    return null
  }
}

/** 递归拷贝模板(跳过 node_modules;node_modules 用符号链接复用,省时省空间) */
async function copyTemplate(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true })
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const s = join(src, entry.name)
    const d = join(dest, entry.name)
    if (entry.isDirectory()) await copyTemplate(s, d)
    else if (entry.isFile()) await cp(s, d)
  }
}

/**
 * 把平台自有文件从模板强制覆盖回工作目录。
 * 两个时机各调一次:
 *   ① agent 动手**前**(prune=true):连平台目录一起重建,清掉上一版源码里对设计系统/SDK 的改动;
 *   ② 每一轮 agent 结束、构建**前**(prune=false):只覆盖平台自己的文件、保留模型新增的文件,
 *      即使模型无视约束改了平台文件,也不会真的进入产物与源码树。
 * 唯一例外是 src/styles/tokens.css —— 那是模型按 plan.palette 选色的文件,任何时候都保留。
 */
async function restorePlatformFiles(workspace: string, templateDir: string, prune: boolean): Promise<void> {
  const exists = async (p: string) => {
    try {
      await stat(p)
      return true
    } catch {
      return false
    }
  }
  for (const rel of PLATFORM_FILES) {
    const from = join(templateDir, rel)
    const to = join(workspace, rel)
    if (await exists(from)) await cp(from, to)
  }
  for (const rel of PLATFORM_DIRS) {
    const from = join(templateDir, rel)
    const to = join(workspace, rel)
    const kept: [string, string][] = []
    for (const k of PLATFORM_KEEP) {
      if (!k.startsWith(`${rel}/`)) continue
      const text = await readIfExists(join(workspace, k))
      if (text !== null) kept.push([k, text])
    }
    if (prune) {
      await rm(to, { recursive: true, force: true })
      await cp(from, to, { recursive: true })
    } else {
      // 覆盖式:逐个平台文件写回,不删除模型新增的文件(避免误删它自己引用的组件)
      for (const p of await walkFiles(from)) {
        const target = join(to, p)
        await mkdir(dirname(target), { recursive: true })
        await cp(join(from, p), target)
      }
    }
    for (const [k, text] of kept) await writeFile(join(workspace, k), text, 'utf8')
  }
}

/** 用一份源码映射覆盖回工作目录(复查轮构建失败时回滚),并删掉映射外的新增源码文件 */
async function restoreFromMap(workspace: string, files: FileMap): Promise<void> {
  for (const p of await walkFiles(workspace)) {
    if (SKIP_ROOT_FILES.has(p)) continue
    if (!(p in files)) await rm(join(workspace, p), { force: true })
  }
  for (const [p, content] of Object.entries(files)) {
    const abs = join(workspace, p)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
  }
}

/** 递归列出文件(相对路径用 '/' 分隔),跳过 SKIP_DIRS */
async function walkFiles(root: string, rel = ''): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(rel ? join(root, rel) : root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const r = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...(await walkFiles(root, r)))
    } else if (entry.isFile()) {
      out.push(r)
    }
  }
  return out
}

/** 读取一组文件为 路径→内容 映射 */
async function readIntoMap(root: string, paths: string[]): Promise<FileMap> {
  const map: FileMap = {}
  await Promise.all(
    paths.map(async (p) => {
      const text = await readIfExists(join(root, p))
      if (text !== null) map[p] = text
    }),
  )
  return map
}

/** 收集源码树(交付/续聊用) */
async function collectSource(workspace: string): Promise<FileMap> {
  const paths = (await walkFiles(workspace)).filter((p) => !SKIP_ROOT_FILES.has(p))
  return readIntoMap(workspace, paths)
}

/** pi 的多模态输入块(与 @earendil-works/pi-ai 的 ImageContent 结构一致) */
type ImageBlock = { type: 'image'; data: string; mimeType: string }

/**
 * 落盘用户附件,并挑出图片作为多模态输入。
 * 图片「落盘 + 内联」双份:内联保证模型第一眼就看见,落盘让 agent 需要时还能自己 read;
 * 文本附件只落盘,由提示词里的清单元数据引导模型主动 read。
 * 返回的 data 与提示词里的文件名一一对应(见 attachments.ts 的命名规则)。
 */
async function materializeAttachments(
  workspace: string,
  attachments: RunRequest['attachments'],
  imageInputEnabled: boolean,
): Promise<ImageBlock[]> {
  const images: ImageBlock[] = []
  if (!attachments?.length) return images
  const dir = join(workspace, ATTACHMENT_DIR)
  await mkdir(dir, { recursive: true })
  for (const [i, a] of attachments.entries()) {
    await writeFile(join(dir, attachmentFileName(a.name, i)), Buffer.from(a.data, 'base64'))
    if (a.mimeType.startsWith('image/') && imageInputEnabled) {
      images.push({ type: 'image', data: a.data, mimeType: a.mimeType })
    }
  }
  return images
}

/**
 * 提示词覆盖树:把 Worker 解包下发的 { 路径 → 模板文本 } 落到 <workspace>/.prompts/。
 * 返回该目录路径供 loader 按路径覆盖默认树;无覆盖时返回 undefined(用镜像内置默认)。
 * 路径穿越/绝对路径/空内容一律跳过(Worker 已校验过一遍,这里是纵深防御)。
 */
async function materializePromptFiles(workspace: string, files: FileMap | undefined): Promise<string | undefined> {
  if (!files || Object.keys(files).length === 0) return undefined
  const dir = join(workspace, PROMPT_DIR)
  await mkdir(dir, { recursive: true })
  for (const [path, content] of Object.entries(files)) {
    if (path.includes('..') || path.startsWith('/') || !content) continue
    const abs = join(dir, path)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
  }
  return dir
}

/**
 * 技能树:把 Worker 解包下发的 { skills/<name>/<file> → 内容 } 落到 <workspace>/.skills/<name>/<file>。
 * 返回目录路径供 createForgeSession 用 loadSkillsFromDir 加载;无技能时返回 undefined。
 * 路径穿越/绝对路径/空内容一律跳过(Worker 已校验过一遍,这里是纵深防御)。
 */
async function materializeSkillFiles(workspace: string, files: FileMap | undefined): Promise<string | undefined> {
  if (!files || Object.keys(files).length === 0) return undefined
  const root = join(workspace, SKILLS_DIR)
  let count = 0
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith('skills/') || !content) continue
    const rel = path.slice('skills/'.length)
    if (rel.includes('..') || rel.startsWith('/')) continue
    const abs = join(root, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
    count++
  }
  return count ? root : undefined
}

/** 收集构建产物并生成清单 */
async function collectDist(workspace: string): Promise<{ dist: FileMap; manifest: ArtifactManifest }> {
  const distDir = join(workspace, 'dist')
  const paths = await walkFiles(distDir)
  if (!paths.includes('index.html')) throw new Error('构建产物缺少 index.html')
  const dist = await readIntoMap(distDir, paths)
  const hash = createHash('sha256')
  let bytes = 0
  const files = paths
    .sort()
    .map((p) => {
      const content = dist[p] ?? ''
      const size = Buffer.byteLength(content, 'utf8')
      bytes += size
      hash.update(`${p}:${createHash('sha256').update(content).digest('hex')}\n`)
      return { path: p, size }
    })
  return { dist, manifest: { entry: 'index.html', buildHash: hash.digest('hex'), files } }
}

/** 平台侧确定性构建:agent 只写源码,构建在 agent 结束后由平台执行 */
async function build(workspace: string, signal: AbortSignal | undefined, uiLang: UiLang, locale: 'zh' | 'en'): Promise<void> {
  try {
    // signal 让用户停止时能直接杀掉 vite 子进程(构造阶段往往是最长的一段,不能等它跑完)
    await execFileAsync('npm', ['run', 'build'], {
      cwd: workspace,
      timeout: BUILD_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      signal,
      // 产物语言:模板的 vite 插件用它写 <html lang>(见 agent/template/vite.config.js)
      env: { ...process.env, FORGE_LOCALE: locale },
    })
  } catch (err) {
    // 被取消打断:原样抛出,交给调用方按"取消"处理(不要伪装成构建失败)
    if (signal?.aborted) throw err
    const e = err as { stderr?: string; stdout?: string; message?: string }
    const detail = (e.stderr || e.stdout || e.message || '').toString().trim().slice(-800)
    throw new Error(t(uiLang, 'error.buildFailed', { detail: detail || t(uiLang, 'error.buildNotPass') }))
  }
}

/** 把 promise 与超时竞速;超时抛错,并调用 onTimeout 让 agent 尽快停下 */
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void, uiLang: UiLang): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout()
      reject(new Error(t(uiLang, 'error.timeout', { s: Math.round(ms / 1000) })))
    }, ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/**
 * 保证 src/App.jsx 调了 setLocale。
 *
 * 为什么不让模型自己记得:平台自带的默认文案(空状态「暂无内容」、报错「加载失败」、
 * Modal 的「确认/取消」…)全靠它切语言 —— 模型漏了这一行,产物里就会到处漏中文。
 *
 * generate:就地改成目标语言(模型写错了也纠正)。
 * chat:**不动已有应用的 locale** —— 续聊时应用是什么语言就还是什么语言,
 *       只有「整个应用都没有这一行」(本次改动之前生成的老应用)才补一行中文兜底。
 */
async function ensureLocaleCall(workspace: string, locale: 'zh' | 'en', mode: 'generate' | 'chat'): Promise<void> {
  const path = join(workspace, 'src/App.jsx')
  const text = await readIfExists(path)
  if (text === null) return
  const hasCall = /setLocale\(\s*['"][^'"]*['"]\s*\)/.test(text)
  const call = `setLocale('${locale}')`
  if (hasCall) {
    if (mode === 'chat') return
    if (text.includes(call)) return
    await writeFile(path, text.replace(/setLocale\(\s*['"][^'"]*['"]\s*\)/, call), 'utf8')
    return
  }
  // 没有这一行调用:generate 用目标语言;chat 里的老应用(本次改动之前生成的,全是中文)用中文兜底
  const fallback = mode === 'chat' ? 'zh' : locale
  await writeFile(path, `import { setLocale } from './lib/locale.js'\nsetLocale('${fallback}')\n\n${text}`, 'utf8')
}

/** 用户主动停止(协作式取消):由 cancel watcher 触发,经 AbortSignal 传进 runJob */
export class CancelledError extends Error {
  constructor(uiLang: UiLang = 'zh') {
    super(t(uiLang, 'error.cancelled'))
    this.name = 'CancelledError'
  }
}

/** HITL 人门节点触发:runJob 抛它表示「暂停等用户」,index.ts 据此返回 200 { paused: true } 而非失败 */
export class HumanGatePaused extends Error {
  constructor() {
    super('human gate reached, waiting for user')
    this.name = 'HumanGatePaused'
  }
}

/**
 * 汇总多个子 agent 会话的 token 用量。必须趁各 session 还活着时逐条读 —— dispose() 之后
 * agent state 就没了,而失败/被停止的任务同样烧了这些 token,所以统一在 finally 里读。
 */
function usageAccumulator(model: string) {
  const acc = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 }
  return {
    absorb(session: AgentSession) {
      const stats = session.getSessionStats()
      acc.input += stats.tokens.input
      acc.output += stats.tokens.output
      acc.cacheRead += stats.tokens.cacheRead
      acc.cacheWrite += stats.tokens.cacheWrite
      acc.turns += stats.assistantMessages
    },
    total(): RunUsage {
      return { model, ...acc }
    },
  }
}

/** 单个子 agent 节点跑完一轮后的产出(供调用方判断空转/截断/交付说明) */
interface TurnOutput {
  providerError: string
  lastStopReason: string
  summary: string
  summaryAfterTool: string
  usedTool: boolean
}

/**
 * 跑一个子 agent 节点的一轮 prompt:订阅事件做进度/日志/文件预览/plan 上报,并在结束时自清理订阅。
 * abort 由调用方统一接线(signal → 当前 session.abort),这里只管超时与收尾。
 */
async function runAgentTurn(input: {
  session: AgentSession
  prompt: string
  images?: ImageBlock[]
  budgetMs: number
  workspace: string
  report: ProgressReporter
  uiLang: UiLang
  raw: (text: string) => void
  writtenFiles: Set<string>
}): Promise<TurnOutput> {
  const { session, prompt, images, budgetMs, workspace, report, uiLang, raw, writtenFiles } = input
  const pendingArgs = new Map<string, Record<string, unknown>>()
  let textBuf = ''
  let summary = ''
  let summaryAfterTool = ''
  let usedTool = false
  let providerError = ''
  let lastStopReason = ''

  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'message_update') {
      const ev = event.assistantMessageEvent
      if (ev.type === 'thinking_start') raw('\n💭 ')
      else if (ev.type === 'thinking_delta') raw(ev.delta)
      else if (ev.type === 'thinking_end') raw('\n')
      else if (ev.type === 'text_start') {
        textBuf = ''
        raw('\n')
      } else if (ev.type === 'text_delta') {
        textBuf += ev.delta
        raw(ev.delta)
      } else if (ev.type === 'text_end') {
        if (textBuf.trim()) {
          summary = textBuf.trim()
          if (usedTool) summaryAfterTool = summary
        }
        textBuf = ''
        raw('\n')
      }
      return
    }
    if (event.type === 'message_end') {
      const msg = event.message
      if (msg.role === 'assistant') {
        lastStopReason = msg.stopReason
        providerError = msg.stopReason === 'error' ? msg.errorMessage || 'provider error' : ''
      }
      return
    }
    if (event.type === 'tool_execution_start') {
      const args = (event.args ?? {}) as Record<string, unknown>
      pendingArgs.set(event.toolCallId, args)
      raw(`\n🔧 ${event.toolName}${toolArgSummary(args)}\n`)
      return
    }
    if (event.type !== 'tool_execution_end') return
    const args = pendingArgs.get(event.toolCallId)
    pendingArgs.delete(event.toolCallId)
    usedTool = true
    raw(event.isError ? '   ✗\n' : '   ✓\n')
    if (event.isError) return
    const path = writtenPath(event.toolName, args)
    if (!path) return
    // 模型既可能给相对路径,也可能给工作目录下的绝对路径;统一归一化成 workspace 内的相对路径,
    // 否则实时「看代码」预览会读到不存在的位置而空白。
    const abs = isAbsolute(path) ? path : join(workspace, path)
    const rel = relative(workspace, abs).replace(sep, '/')
    if (!rel || rel.startsWith('..')) return
    if (rel.endsWith('plan.json')) {
      void readIfExists(join(workspace, 'plan.json')).then((text) => {
        const plan = text ? parsePlan(text) : null
        if (plan) report({ plan, stage: 'coding', progress: t(uiLang, 'progress.planned') })
      })
      return
    }
    writtenFiles.add(rel)
    report({
      stage: 'coding',
      progress: t(uiLang, 'progress.writing', { file: rel, count: writtenFiles.size }),
    })
    void readIfExists(join(workspace, rel)).then((text) => {
      if (text !== null) report({ filePreview: { path: rel, content: text.slice(0, MAX_FILE_PREVIEW) } })
    })
  })

  try {
    await withTimeout(
      session.prompt(prompt, { images: images?.length ? images : undefined }),
      budgetMs,
      () => void session.abort(),
      uiLang,
    )
  } finally {
    unsubscribe()
  }

  return { providerError, lastStopReason, summary, summaryAfterTool, usedTool }
}

export async function runJob(
  config: AgentConfig,
  req: RunRequest,
  report: ProgressReporter,
  log: StreamLogger,
  signal?: AbortSignal,
  /** 会话建好后的回调:index.ts 借此拿到 session 引用,把用户追加的要求 steer 进去 */
  onSession?: (session: AgentSession) => void,
  /**
   * 用量回调:在 session 销毁前触发一次,成功、失败、用户停止三种终态都会触发
   * (index.ts 据此上报 /internal/jobs/:id/usage)。回调抛错不影响主流程。
   */
  onUsage?: (usage: RunUsage) => void,
  /**
   * 断点快照回调:任务运行期间周期性把当前源码树交给 Worker(存 R2),失败/停止后供「从断点继续」。
   * 回调失败只打日志,不影响生成。
   */
  onCheckpoint?: (source: FileMap) => Promise<boolean>,
  /** HITL 人门节点暂停回调:把恢复上下文交给 Worker(置 waiting_human),实例随后释放 */
  onWait?: (resume: ResumeContext) => Promise<void>,
): Promise<RunResult> {
  // 冷启动期间就被停止:连工作目录都不用建
  const uiLang: UiLang = isUiLang(req.lang) ? req.lang : 'zh'
  if (signal?.aborted) throw new CancelledError(uiLang)
  // 凭证缺失必须在接活前就失败:pi 解析不到环境变量时会把变量名当字面量发出去,
  // 上游 401 → pi 降级成空轮次(见 error.modelFailed / error.emptyModelRun 的兜底)。
  if (!process.env[config.apiKeyEnv]) throw new Error(t(uiLang, 'error.apiKeyMissing', { env: config.apiKeyEnv }))
  // 产物语言:跟随需求正文的语言,识别不出才回落界面语言(见 lang.ts)
  const outLang = resolveOutputLang(req)
  const workspace = join(config.workspaceRoot, req.jobId)
  await rm(workspace, { recursive: true, force: true })
  await mkdir(workspace, { recursive: true })

  // 从预装模板拷贝工作目录,node_modules 用符号链接复用(不重复安装依赖)
  await copyTemplate(config.templateDir, workspace)
  await symlink(join(config.templateDir, 'node_modules'), join(workspace, 'node_modules'), 'dir').catch(() => {})

  // chat 或 HITL 恢复:把当前源码树覆盖进工作目录,agent 直接在其上修改/继续
  if (req.currentFiles && (req.type === 'chat' || req.resume)) {
    for (const [path, content] of Object.entries(req.currentFiles)) {
      if (path.includes('..') || path.startsWith('/')) continue
      const abs = join(workspace, path)
      await mkdir(join(abs, '..'), { recursive: true })
      await writeFile(abs, content, 'utf8')
    }
  }

  // 平台自有文件强制还原(脚手架契约 / 设计系统 / 后端 SDK 不可被上一版源码或模型改坏)
  await restorePlatformFiles(workspace, config.templateDir, true)

  // 用户附件:图片直接作为多模态输入,文本落到 .attachments/ 供模型 read(不进源码树)
  const attachmentImages = await materializeAttachments(workspace, req.attachments, config.supportsImageInput)

  // 本轮连接器:凭证明文落到 .forge/connectors.json(不进源码树、不进产物,随容器销毁)
  await materializeConnectors(workspace, req.connectors)

  report({
    stage: req.type === 'chat' ? 'coding' : 'planning',
    progress: t(uiLang, req.type === 'chat' ? 'progress.chatEdit' : 'progress.plan'),
  })

  // 三个子 agent 共享同一份 models.json/provider(只解析一次),各节点用各自的 system prompt + 工具集
  const modelCtx = await createModelContext(config, workspace, uiLang)
  // ---- 会话生命周期:abort 始终指向「当前正在跑的那个子 agent」----
  const sessions: AgentSession[] = []
  const acc = usageAccumulator(config.modelId)
  let currentSession: AgentSession | null = null
  const onAbort = () => void currentSession?.abort()
  if (signal?.aborted) throw new CancelledError(uiLang)
  signal?.addEventListener('abort', onAbort, { once: true })
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new CancelledError(uiLang)
  }

  /**
   * 完整过程(逐 token 正文/思考/每次工具调用)默认只写 Cloud Run stdout,用于运维排查;
   * D1 的 agent_log 只保留里程碑与告警,避免把日志当消息总线(实测会写出几万行/天)。
   * 本地开发(Worker 派发时带 streamLog=true)时,同样的内容也追加进里程碑日志上报,
   * 供后台实时看到完整生成过程;线上不带该字段,行为与从前完全一致。
   */
  let rawBuf = ''
  const flushRaw = () => {
    if (!rawBuf) return
    const chunk = rawBuf.endsWith('\n') ? rawBuf : `${rawBuf}\n`
    process.stdout.write(chunk)
    if (req.streamLog) log.append(chunk)
    rawBuf = ''
  }
  const raw = (text: string) => {
    rawBuf += text
    if (rawBuf.length > 200_000) flushRaw()
  }
  const rawTimer = setInterval(flushRaw, 5_000)
  /** 本次已写入的文件(去重,跨节点共享,用于进度里的计数) */
  const writtenFiles = new Set<string>()

  // 技能覆盖树解包到 .skills/(不进源码树);每个节点按 agent 声明的 skills 子集注入 system prompt
  const skillsDir = await materializeSkillFiles(workspace, req.skillFiles)

  /** 为某个节点建一个独立会话:system prompt 与工具集各节点不同;建好即成为 steer 目标 */
  const newSession = async (systemPrompt: string, tools: string[], skillNames?: string[], mcpNames?: string[]) => {
    const s = await createForgeSession(config, workspace, modelCtx, {
      uiLang,
      systemPrompt,
      tools,
      skillsDir,
      skillNames,
      mcp: req.mcp,
      mcpNames,
    })
    sessions.push(s)
    currentSession = s
    onSession?.(s)
    // 会话建好之前就被停止(冷启动 + 拷模板慢于巡检间隔):abort 一个还没跑过的会话是空操作,
    // 这里直接退出,别让整整一轮生成白跑(不然会占满 --max-instances 1 的实例)
    throwIfCancelled()
    return s
  }
  // (逐 token 事件订阅已移入 runAgentTurn,各子 agent 节点自行订阅并清理)

  /**
   * 断点:每 60s 或异常收尾时快照源码树。内容没变就不重复上报(长时间思考不该产生写入),
   * 快照失败只记日志 —— 它只是「失败后可续跑」的增强,绝不能影响主流程。
   */
  let checkpointBusy: Promise<void> | null = null
  let lastCheckpointHash = ''
  const checkpointNow = (force = false): Promise<void> => {
    if (!onCheckpoint) return Promise.resolve()
    // 已有快照在途:普通调用复用其结果(内容没变就不重复上报);强制快照(门节点暂停 / 异常收尾)
    // 等它结束后再补一次 —— 之前这里直接 return,门节点可能引用到稍旧的 checkpoint。
    if (checkpointBusy) {
      return force ? checkpointBusy.then(() => checkpointNow(true)) : checkpointBusy
    }
    const run = async (): Promise<void> => {
      try {
        const src = await collectSource(workspace)
        const hash = createHash('sha256').update(JSON.stringify(src)).digest('hex')
        if (!force && hash === lastCheckpointHash) return
        if (await onCheckpoint(src)) lastCheckpointHash = hash
      } catch (err) {
        console.error(`[checkpoint] ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        checkpointBusy = null
      }
    }
    checkpointBusy = run()
    return checkpointBusy
  }
  const checkpointTimer = onCheckpoint ? setInterval(() => void checkpointNow(), 60_000) : undefined

  // HITL 恢复:把「已消耗」的那段预算从钟上扣掉,remainingMs() 从恢复上下文的剩余预算开始倒数,
  // 而不是拿新实例的全新 maxRunMs —— 否则一个任务能借 HITL 反复刷新预算,超时护栏形同虚设。
  const startedAt = Date.now() - (req.resume ? Math.max(0, config.maxRunMs - req.resume.remainingMs) : 0)
  const remainingMs = () => config.maxRunMs - (Date.now() - startedAt)
  /** 交付说明:取标记 deliver 的节点(默认最后一个 agent 节点)的收尾正文;恢复时带回暂停前的值 */
  let deliverSummary = req.resume?.deliverSummary ?? ''

  // 编排流水线:顶层 body.pipeline(全局、与模型配置解耦)优先,否则内置默认(Planner→Coder→build→Reviewer→rebuild)。
  // 非法/空 → parsePipeline 返回 null → 回落内置默认,绝不因脏配置打断生成。
  // HITL 续跑优先用暂停时快照的编排版本:后台在等待期间改了编排的话,doneStepIds/gateStepId 仍与快照一致。
  const steps =
    restoreStepsSnapshot(req.resume?.stepsJson) ??
    (req.pipeline ? parsePipeline(req.pipeline) : null) ??
    defaultPipeline(config, req, uiLang, remainingMs)
  // 提示词文件系统:system prompt + user prompt + 流水线模板变量(含 {{plannerPrompt}} 等成品提示词)。
  // 后台自定义压缩包解包到 <workspace>/.prompts/ 后按路径覆盖默认树(部分覆盖 = 部分回落默认)。
  const promptOverrideDir = await materializePromptFiles(workspace, req.promptFiles)
  const prompts = await loadPromptSet(
    config.promptsDir,
    {
      req,
      lang: outLang,
      mode: req.type,
      imageInputEnabled: config.supportsImageInput,
    },
    promptOverrideDir,
  )
  const vars = prompts.vars()
  // 步骤类型化输出(见 docs/FORGE2.md §17.14):step id → field → 值。恢复时从上下文还原并注入 vars,
  // 使下游 `{{ steps.<id>.outputs.<field> }}` 跨实例可用。
  const stepsOutputs: Record<string, Record<string, string>> = {}
  if (req.resume?.outputs) {
    for (const [sid, fields] of Object.entries(req.resume.outputs)) {
      stepsOutputs[sid] = { ...fields }
      for (const [f, v] of Object.entries(fields)) vars[`steps.${sid}.outputs.${f}`] = v
    }
  }
  // 拓扑序 = 实际执行序(默认线性流水线退化为原始顺序;有分支时先跑完被依赖的节点)。
  const order = topologicalOrder(steps) ?? steps

  try {
    // HITL 恢复:基线/构建态/交付说明/空转基线都从恢复上下文还原(新实例没有这些内存态)
    const sourceBefore = req.resume
      ? (req.resume.sourceBefore ?? null)
      : req.type === 'generate'
        ? await collectSource(workspace)
        : null
    let lastStopReason = ''
    let baseline: FileMap | null = req.resume?.baseline ?? null
    let built = req.resume?.built ?? false
    let emptyChecked = false
    let deliverSession: AgentSession | null = null
    let lastAgentSummary = req.resume?.lastAgentSummary ?? ''
    let lastAgentSession: AgentSession | null = null
    // 已完成(或条件跳过)的步骤 id;恢复时连同已作答的门一起跳过,下游从门后继续
    const doneIds: string[] = [...(req.resume?.doneStepIds ?? [])]
    const skipIds = new Set<string>([...doneIds, ...(req.resume ? [req.resume.gateStepId] : [])])

    // 空转检测(仅 generate):首个构建节点之前 source 一个字节都没变 → 模型空转/provider 空回复,
    // 绝不能把未改动的脚手架当成"生成成功"交付。放在构建之前 —— ensureLocaleCall 会改写 App.jsx
    // 的 setLocale,放在构建之后会漏判(目标语言 ≠ 中文时一行之差就放过了空转)。
    const checkEmptyRun = async () => {
      if (emptyChecked || !sourceBefore) return
      emptyChecked = true
      if (sourcesEqual(sourceBefore, await collectSource(workspace))) {
        throw new Error(t(uiLang, lastStopReason === 'length' ? 'error.modelTruncated' : 'error.emptyModelRun'))
      }
    }

    // 构建节点:还原平台文件 + setLocale + 平台确定性构建;失败可回滚到最近一次成功构建的源码
    const runBuild = async (rollback: boolean) => {
      await restorePlatformFiles(workspace, config.templateDir, false)
      report({ stage: 'building', progress: t(uiLang, built ? 'progress.rebuilding' : 'progress.building') })
      await ensureLocaleCall(workspace, localeCode(outLang), req.type)
      try {
        await build(workspace, signal, uiLang, localeCode(outLang))
        baseline = await collectSource(workspace)
        built = true
      } catch (err) {
        if (rollback && baseline) {
          // 后续节点把代码改坏了:回滚到已通过构建的最近一次源码,保证交付可用
          await restoreFromMap(workspace, baseline)
          await build(workspace, signal, uiLang, localeCode(outLang))
          log.append(t(uiLang, 'log.polishFallback'))
          baseline = await collectSource(workspace)
        } else {
          throw err
        }
      }
    }

    // 解析节点引用的 agent → { systemPrompt, tools, skillNames?, mcpNames? }。命名 agent 先查内置,
    // 再查后台 agents 注册表,最后按名字找 system/<name>.md;都不认识则回落 coder 默认(记告警,绝不因脏配置打断生成)。
    const resolveAgent = (
      ref: PipelineAgentStep['agent'],
    ): { systemPrompt: string; tools: string[]; skillNames?: string[]; mcpNames?: string[] } => {
      if (typeof ref === 'string') {
        const builtin = AGENTS[ref as keyof typeof AGENTS]
        if (builtin) return { systemPrompt: prompts.system(ref), tools: builtin.tools }
        const custom = req.agents?.[ref]
        if (custom) {
          return {
            systemPrompt: custom.systemPrompt || prompts.system(ref) || prompts.system('coder'),
            tools: custom.tools ?? AGENTS.coder.tools,
            skillNames: custom.skills,
            mcpNames: custom.mcp,
          }
        }
        const byFile = prompts.system(ref)
        if (byFile) {
          console.warn(`[pipeline] 未知 agent 名 "${ref}"(无注册定义),用其 system/<name>.md + coder 默认工具集`)
          return { systemPrompt: byFile, tools: AGENTS.coder.tools }
        }
        console.warn(`[pipeline] 未知 agent 名 "${ref}",回落到 coder 默认`)
        return { systemPrompt: prompts.system('coder'), tools: AGENTS.coder.tools }
      }
      // 内联定义:systemPrompt 缺省回落 coder;tools 缺省 = coder 默认工具集;skills/mcp 直接采用
      return {
        systemPrompt: ref.systemPrompt || prompts.system('coder'),
        tools: ref.tools ?? AGENTS.coder.tools,
        skillNames: ref.skills,
        mcpNames: ref.mcp,
      }
    }

    // 跑一个 agent 节点(闭包,便于 continue_on_failure 节点失败不判 job 失败)
    const runAgentStep = async (step: PipelineAgentStep) => {
      if (step.min_budget_ms && remainingMs() < step.min_budget_ms) return
      if (step.progress) report({ stage: 'coding', progress: interpolate(step.progress, vars) })
      const def = resolveAgent(step.agent)
      const session = await newSession(def.systemPrompt, step.tools ?? def.tools, def.skillNames, def.mcpNames)
      const budget = step.budget_ms && step.budget_ms > 0 ? Math.min(step.budget_ms, remainingMs()) : remainingMs()
      const turn = await runAgentTurn({
        session,
        prompt: interpolate(step.prompt, vars),
        images: step.images && attachmentImages.length ? attachmentImages : undefined,
        budgetMs: budget,
        workspace,
        report,
        uiLang,
        raw,
        writtenFiles,
      })
      throwIfCancelled()
      if (turn.providerError) throw new Error(t(uiLang, 'error.modelFailed', { msg: turn.providerError }))
      lastStopReason = turn.lastStopReason
      const text = turn.summaryAfterTool || (turn.usedTool ? '' : turn.summary.trim())
      lastAgentSummary = text
      lastAgentSession = session
      if (step.deliver && !deliverSummary) {
        deliverSummary = text
        deliverSession = session
      }
      // 类型化输出(见 docs/FORGE2.md §17.14):恒有 outputs.summary = 完整收尾正文;
      // 声明了 output 字段时,尝试从收尾正文里提取 JSON 对象按字段取值,提不到留空串。
      const outs: Record<string, string> = { summary: text }
      if (step.output?.length) {
        const obj = extractJsonObject(text)
        for (const f of step.output) {
          const v = obj?.[f]
          // 数组/对象保留为 JSON 文本(下游用 JSON.parse 消费),标量直接 String;null/undefined 留空串。
          // 之前统一 String() 会把数组压成逗号串、对象压成 [object Object],下游无法可靠消费。
          outs[f] = v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
        }
      }
      stepsOutputs[step.id] = outs
      for (const [f, v] of Object.entries(outs)) vars[`steps.${step.id}.outputs.${f}`] = v
    }

    // DAG 执行:按拓扑序逐个跑(共享工作目录,分支顺序执行不并行 —— 见 §17.9 的已知局限)。
    // 非 continue_on_failure 节点失败直接冒泡判 job 失败;continue_on_failure 节点失败只记告警,依赖它的节点照跑。
    for (const step of order) {
      throwIfCancelled()
      // 恢复:已完成步骤 + 已作答的门直接跳过,下游从门后开始
      if (skipIds.has(step.id)) continue
      // 条件跳过(if):为假视作已完成(下游照跑),并记入 doneIds 供后续门节点快照
      if (step.if && !evalCondition(step.if, vars)) {
        doneIds.push(step.id)
        continue
      }
      // 人门节点:快照源码 + 落恢复上下文 → 交给 Worker 置 waiting_human,实例随即释放(空等零成本)
      if (isGateStep(step)) {
        await checkpointNow(true)
        // 把已作答的门记进 doneStepIds:流程遇到第二个门再暂停时,恢复上下文仍要包含之前的门,
        // 否则下一次续跑 skipIds 只含最新门,会重新停在第一个门 → 回退循环。
        doneIds.push(step.id)
        const resume: ResumeContext = {
          doneStepIds: [...doneIds],
          gateStepId: step.id,
          kind: step.approve ? 'approve' : 'choose',
          question: step.approve ?? step.choose!.question,
          options: step.choose?.options,
          deliverSummary,
          lastAgentSummary,
          baseline,
          built,
          remainingMs: remainingMs(),
          sourceBefore,
          outputs: stepsOutputs,
          stepsJson: JSON.stringify(steps),
          attachments: req.attachments,
          connectors: req.connectors,
        }
        if (onWait) await onWait(resume)
        throw new HumanGatePaused()
      }
      if ('command' in step) {
        await checkEmptyRun()
        await runBuild(step.rollback === true)
        doneIds.push(step.id)
        continue
      }
      if (step.continue_on_failure) {
        try {
          await runAgentStep(step)
          doneIds.push(step.id)
        } catch (err) {
          // continue_on_failure 节点失败不判 job 失败;但用户主动停止必须传播出去(别被吞成"保留之前结果")
          throwIfCancelled()
          doneIds.push(step.id)
          log.append(t(uiLang, 'log.polishUndone', { msg: err instanceof Error ? err.message : String(err) }))
        }
      } else {
        await runAgentStep(step)
        doneIds.push(step.id)
      }
    }

    throwIfCancelled()
    await checkEmptyRun()
    // 保证 dist 存在且新鲜:流水线里没有构建,或最后一个节点改动过源码但之后没构建 → 补一次
    if (!built || (order.length > 0 && !('command' in order[order.length - 1]))) {
      await runBuild(false)
    }

    // 交付说明:没标 deliver 时用最后一个 agent 节点的收尾正文
    if (!deliverSummary) {
      deliverSummary = lastAgentSummary
      deliverSession = lastAgentSession
    }
    // 交付说明的语言跑偏了(模型有时会用提示词的中文写收尾)→ 专门再问一次(在产出它的会话上)。
    // 这段提示词短、目标单一,比在长提示词末尾强调有效得多;问不到就保留原来那份。
    if (deliverSummary && deliverSession && !matchesLang(deliverSummary, outLang) && remainingMs() > DELIVERY_RETRY_MIN_MS) {
      const budget = Math.min(DELIVERY_RETRY_BUDGET_MS, remainingMs())
      log.append(t(uiLang, 'log.deliveryLangRetry'))
      try {
        const retry = await runAgentTurn({
          session: deliverSession,
          prompt: prompts.user('deliveryNote'),
          budgetMs: budget,
          workspace,
          report,
          uiLang,
          raw,
          writtenFiles,
        })
        const note = retry.summaryAfterTool || retry.summary.trim()
        if (note && matchesLang(note, outLang)) deliverSummary = note
      } catch {
        // 重问失败(超时/异常):保留原来那份,别把交付说明弄丢
      }
    }
  } catch (err) {
    // 异常/停止:补一次断点(周期快照可能刚好处在两次之间)。成功路径不需要 —— 产物会进草稿
    await checkpointNow(true)
    throw err
  } finally {
    if (checkpointTimer) clearInterval(checkpointTimer)
    clearInterval(rawTimer)
    flushRaw()
    signal?.removeEventListener('abort', onAbort)
    // 用量快照必须在这里取:dispose() 之后就读不到了,而失败/被停止的任务同样烧了 token 与实例时间
    try {
      for (const s of sessions) acc.absorb(s)
      onUsage?.(acc.total())
    } catch (err) {
      console.error(`[usage] ${err instanceof Error ? err.message : String(err)}`)
    }
    for (const s of sessions) s.dispose()
  }

  const [src, { dist, manifest }] = await Promise.all([collectSource(workspace), collectDist(workspace)])

  let plan: Plan | undefined
  if (req.type === 'generate') {
    const planText = await readIfExists(join(workspace, 'plan.json'))
    const parsed = planText ? parsePlan(planText) : null
    if (parsed) plan = parsed
  }

  return { src, dist, manifest, plan, summary: deliverSummary || undefined }
}
