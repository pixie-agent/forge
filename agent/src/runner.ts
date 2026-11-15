/** 单个 job 的执行:拷脚手架 → 跑 pi agent 写源码 → 构建 → 收集源码树 + 构建产物 */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import type { AgentConfig } from './config.js'
import type { ProgressReporter, StreamLogger } from './callback.js'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { polishPrompt, buildUserPrompt, parsePlan, deliveryNotePrompt } from './prompt.js'
import { resolveOutputLang, localeCode, matchesLang } from './lang.js'
import { isUiLang, t, type UiLang } from './i18n.js'
import { createForgeSession } from './session.js'
import { ATTACHMENT_DIR, attachmentFileName } from './attachments.js'
import { CONNECTOR_DIR, materializeConnectors } from './connectors.js'
import type { ArtifactManifest, FileMap, Plan, RunRequest, RunResult, RunUsage } from './types.js'

const execFileAsync = promisify(execFile)

/** 收集源码树时跳过的目录(依赖、临时、构建产物、用户附件、连接器凭证) */
const SKIP_DIRS = new Set(['node_modules', '.pi', '.git', 'dist', ATTACHMENT_DIR, CONNECTOR_DIR])
/** 顶层不作为“源码”交付的文件(计划文件) */
const SKIP_ROOT_FILES = new Set(['plan.json'])
const BUILD_TIMEOUT_MS = 5 * 60 * 1000
const MAX_FILE_PREVIEW = 20_000
/** 复查轮至少要有这么多剩余预算才值得跑 */
const MIN_POLISH_BUDGET_MS = 30_000
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

/**
 * 取本次会话累计的 token 用量。必须趁 session 还活着时读 —— dispose() 之后 agent state 就没了,
 * 而失败/被停止的任务同样烧了这些 token,所以要在 finally 里读、而不是只在成功路径上读。
 */
function collectUsage(session: AgentSession, model: string): RunUsage {
  const stats = session.getSessionStats()
  return {
    model,
    input: stats.tokens.input,
    output: stats.tokens.output,
    cacheRead: stats.tokens.cacheRead,
    cacheWrite: stats.tokens.cacheWrite,
    turns: stats.assistantMessages,
  }
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

  // chat:把当前源码树覆盖进工作目录,agent 直接在其上修改
  if (req.type === 'chat' && req.currentFiles) {
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

  // 生成前的源码快照:生成结束若一个字节都没变,说明模型空转(provider 401/空回复),
  // 绝不能把未改动的脚手架当成"生成成功"交付。
  const sourceBefore = req.type === 'generate' ? await collectSource(workspace) : null

  report({
    stage: req.type === 'chat' ? 'coding' : 'planning',
    progress: t(uiLang, req.type === 'chat' ? 'progress.chatEdit' : 'progress.plan'),
  })

  const session = await createForgeSession(config, workspace, { outLang, uiLang, mode: req.type })
  // 会话就绪:交给 index.ts,它在模型跑起来之前缓冲的「追加要求」此刻补投
  onSession?.(session)
  // 用户主动停止:signal 一响就 abort 当前轮次;每个阶段结束后再用 throwIfCancelled 把控制流拉出
  // runJob —— abort 只保证"轮次尽快结束",不代表 prompt 会抛错,所以两条都要有。
  const onAbort = () => void session.abort()
  if (signal?.aborted) onAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new CancelledError(uiLang)
  }
  // 会话建好之前就被停止(冷启动 + 拷模板慢于巡检间隔):abort 一个还没跑过的会话是空操作,
  // 这里直接退出,别让整整一轮生成白跑(不然会占满 --max-instances 1 的实例)
  throwIfCancelled()
  // tool_execution_end 不带入参,先用 start 事件按 toolCallId 记住本次调用的参数
  const pendingArgs = new Map<string, Record<string, unknown>>()
  // 累积 agent 的正文输出;交付说明 = **最后一次工具调用之后**的那段正文,
  // 回传后作为对话里的 assistant 回复。
  // 为什么不能只取「最后一段正文」:有些模型(实测 MiniMax-M3.1-Flash)整轮只在开头说过一句话,
  // 之后全是思考与工具调用、收尾时不再输出正文 —— 那样取到的会是开场白,不是交付说明。
  let textBuf = ''
  let summary = ''
  /** 工具调用之后出现过的最后一段正文(那才是交付说明) */
  let summaryAfterTool = ''
  /** 本轮是否调用过工具 */
  let usedTool = false
  /**
   * 最后一次 provider 错误。pi 的约定是:请求失败不抛异常,而是产出一条
   * stopReason='error' 的 assistant 消息。必须在 prompt 结束后检查 —— 否则一次 401
   * 会变成「空轮次 + 构建未改动的脚手架 + commit 成功」,用户看到的是"秒回旧页面"。
   */
  let providerError = ''
  /** 最后一条 assistant 消息的结束原因:length = 单轮输出被 max_tokens 截断(思考吃光了额度) */
  let lastStopReason = ''
  /**
   * 完整过程(逐 token 正文/思考/每次工具调用)只写 Cloud Run stdout,用于运维排查;
   * D1 的 agent_log 只保留里程碑与告警,避免把日志当消息总线(实测会写出几万行/天)。
   */
  let rawBuf = ''
  const flushRaw = () => {
    if (!rawBuf) return
    process.stdout.write(rawBuf.endsWith('\n') ? rawBuf : `${rawBuf}\n`)
    rawBuf = ''
  }
  const raw = (text: string) => {
    rawBuf += text
    if (rawBuf.length > 200_000) flushRaw()
  }
  const rawTimer = setInterval(flushRaw, 5_000)
  /** 本次已写入的文件(去重,用于进度里的计数) */
  const writtenFiles = new Set<string>()
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
      // 只关心 assistant 终态:成功消息会清掉之前 auto-retry 留下的错误
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

  /**
   * 断点:每 60s 或异常收尾时快照源码树。内容没变就不重复上报(长时间思考不该产生写入),
   * 快照失败只记日志 —— 它只是「失败后可续跑」的增强,绝不能影响主流程。
   */
  let checkpointBusy = false
  let lastCheckpointHash = ''
  const checkpointNow = async (force = false): Promise<void> => {
    if (!onCheckpoint || checkpointBusy) return
    checkpointBusy = true
    try {
      const src = await collectSource(workspace)
      const hash = createHash('sha256').update(JSON.stringify(src)).digest('hex')
      if (!force && hash === lastCheckpointHash) return
      if (await onCheckpoint(src)) lastCheckpointHash = hash
    } catch (err) {
      console.error(`[checkpoint] ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      checkpointBusy = false
    }
  }
  const checkpointTimer = onCheckpoint ? setInterval(() => void checkpointNow(), 60_000) : undefined

  const startedAt = Date.now()
  const remainingMs = () => config.maxRunMs - (Date.now() - startedAt)
  /** 第一轮的交付说明(复查轮自己的收尾话术不适合当交付说明,所以优先用第一轮的) */
  let deliverSummary = ''

  try {
    await withTimeout(
      session.prompt(buildUserPrompt(req, { imageInputEnabled: config.supportsImageInput, lang: outLang }), {
        images: attachmentImages.length ? attachmentImages : undefined,
      }),
      config.maxRunMs,
      () => void session.abort(),
      uiLang,
    )
    throwIfCancelled()
    // provider 失败(401/404/5xx)不会让 prompt 抛错,只会留下一轮空回复;
    // 必须在构建前显式判失败,否则未改动的脚手架会被当成产物交付。
    if (providerError) throw new Error(t(uiLang, 'error.modelFailed', { msg: providerError }))
    if (sourceBefore && sourcesEqual(sourceBefore, await collectSource(workspace))) {
      // 区分「模型什么都没干」与「思考吃光 max_tokens、输出被截断」:
      // 后者不是凭证/方言问题,调大该配置的 max_tokens 即可(见 docs/FORGE2.md §21.1)。
      throw new Error(t(uiLang, lastStopReason === 'length' ? 'error.modelTruncated' : 'error.emptyModelRun'))
    }
    // 工具调用之后没有正文 → 模型没写交付说明(返回空,让 Worker 用平台自己的收尾文案兜底)
    deliverSummary = summaryAfterTool || (usedTool ? '' : summary.trim())
    // 交付说明的语言跑偏了(模型有时会用提示词的中文写收尾)→ 专门再问一次。
    // 这段提示词短、目标单一,比在长提示词末尾强调有效得多;问不到就保留原来那份。
    if (deliverSummary && !matchesLang(deliverSummary, outLang) && remainingMs() > DELIVERY_RETRY_MIN_MS) {
      const budget = Math.min(DELIVERY_RETRY_BUDGET_MS, remainingMs())
      log.append(t(uiLang, 'log.deliveryLangRetry'))
      try {
        await withTimeout(
          session.prompt(deliveryNotePrompt(outLang)),
          budget,
          () => void session.abort(),
          uiLang,
        )
        const retry = summaryAfterTool || summary.trim()
        if (retry && matchesLang(retry, outLang)) deliverSummary = retry
      } catch {
        // 重问失败(超时/异常):保留原来那份,别把交付说明弄丢
      }
    }
    // 构建前再覆盖一次平台文件:模型若无视约束改了组件/SDK,也不会进入产物与源码树
    await restorePlatformFiles(workspace, config.templateDir, false)

    // 第一轮先构建:既是对初稿的校验,也是复查轮回滚的基线
    report({ stage: 'building', progress: t(uiLang, 'progress.building') })
    throwIfCancelled()
    await ensureLocaleCall(workspace, localeCode(outLang), req.type)
    await build(workspace, signal, uiLang, localeCode(outLang))
    const baseline = await collectSource(workspace)

    // 第二轮:同会话的「设计总监复查与打磨」——只精修,不推翻;失败不判 job 失败
    const wantPolish =
      config.designReview === 'always' || (config.designReview === 'generate' && req.type === 'generate')
    if (wantPolish && remainingMs() >= MIN_POLISH_BUDGET_MS) {
      throwIfCancelled()
      const budget = Math.min(config.polishMaxMs, remainingMs())
      log.append(t(uiLang, 'log.polishStart'))
      report({ stage: 'coding', progress: t(uiLang, 'progress.polish') })
      try {
        await withTimeout(session.prompt(polishPrompt(outLang, req.type)), budget, () => void session.abort(), uiLang)
        throwIfCancelled()
        await restorePlatformFiles(workspace, config.templateDir, false)
        report({ stage: 'building', progress: t(uiLang, 'progress.rebuilding') })
        try {
          await ensureLocaleCall(workspace, localeCode(outLang), req.type)
          await build(workspace, signal, uiLang, localeCode(outLang))
        } catch {
          // 复查轮把代码改坏了:回滚到已通过构建的初稿,保证交付可用
          await restoreFromMap(workspace, baseline)
          await build(workspace, signal, uiLang, localeCode(outLang))
          log.append(t(uiLang, 'log.polishFallback'))
        }
      } catch (err) {
        // 复查轮本身失败不判 job 失败;但用户主动停止必须传播出去(别被这里吞成"保留第一轮结果")
        throwIfCancelled()
        log.append(t(uiLang, 'log.polishUndone', { msg: err instanceof Error ? err.message : String(err) }))
      }
      log.append(t(uiLang, 'log.polishEnd'))
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
      onUsage?.(collectUsage(session, config.modelId))
    } catch (err) {
      console.error(`[usage] ${err instanceof Error ? err.message : String(err)}`)
    }
    unsubscribe()
    session.dispose()
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
