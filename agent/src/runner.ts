/** 单个 job 的执行:拷脚手架 → 跑 pi agent 写源码 → 构建 → 收集源码树 + 构建产物 */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import type { AgentConfig } from './config.js'
import type { ProgressReporter, StreamLogger } from './callback.js'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import { POLISH_PROMPT, buildUserPrompt, parsePlan } from './prompt.js'
import { createForgeSession } from './session.js'
import { ATTACHMENT_DIR, attachmentFileName } from './attachments.js'
import { CONNECTOR_DIR, materializeConnectors } from './connectors.js'
import type { ArtifactManifest, FileMap, Plan, RunRequest, RunResult, RunUsage } from './types.js'

const execFileAsync = promisify(execFile)

/** 收集源码树时跳过的目录(依赖、临时、构建产物、用户附件、连接器凭证) */
const SKIP_DIRS = new Set(['node_modules', '.pi', '.git', 'dist', ATTACHMENT_DIR, CONNECTOR_DIR])
/** 顶层不作为“源码”交付的文件(计划与锁文件) */
const SKIP_ROOT_FILES = new Set(['plan.json', 'package-lock.json'])
const BUILD_TIMEOUT_MS = 5 * 60 * 1000
const MAX_FILE_PREVIEW = 20_000
/** 复查轮至少要有这么多剩余预算才值得跑 */
const MIN_POLISH_BUDGET_MS = 30_000

/**
 * 平台自有文件:模型不得修改,每次 job 开始时从模板强制覆盖回工作目录
 * (旧的生成结果里被改坏的 forge.js / index.css 等,在这里被纠正)。
 */
const PLATFORM_FILES = [
  'index.html',
  'package.json',
  'vite.config.js',
  'src/main.jsx',
  'src/index.css',
  'src/lib/cx.js',
  'src/lib/forge.js',
  'src/lib/connectors.js',
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

/** pi 的多模态输入块(与 @mariozechner/pi-ai 的 ImageContent 结构一致) */
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
async function build(workspace: string, signal?: AbortSignal): Promise<void> {
  try {
    // signal 让用户停止时能直接杀掉 vite 子进程(构造阶段往往是最长的一段,不能等它跑完)
    await execFileAsync('npm', ['run', 'build'], {
      cwd: workspace,
      timeout: BUILD_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      signal,
    })
  } catch (err) {
    // 被取消打断:原样抛出,交给调用方按"取消"处理(不要伪装成构建失败)
    if (signal?.aborted) throw err
    const e = err as { stderr?: string; stdout?: string; message?: string }
    const detail = (e.stderr || e.stdout || e.message || '').toString().trim().slice(-800)
    throw new Error(`构建失败:${detail || 'vite build 未通过'}`)
  }
}

/** 把 promise 与超时竞速;超时抛错,并调用 onTimeout 让 agent 尽快停下 */
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout()
      reject(new Error(`Agent 执行超时(上限 ${Math.round(ms / 1000)}s)`))
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

/** 用户主动停止(协作式取消):由 cancel watcher 触发,经 AbortSignal 传进 runJob */
export class CancelledError extends Error {
  constructor() {
    super('任务已被用户停止')
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
): Promise<RunResult> {
  // 冷启动期间就被停止:连工作目录都不用建
  if (signal?.aborted) throw new CancelledError()
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

  report({ stage: req.type === 'chat' ? 'coding' : 'planning', progress: req.type === 'chat' ? '正在按要求修改应用' : '正在规划方案' })

  const session = await createForgeSession(config, workspace)
  // 会话就绪:交给 index.ts,它在模型跑起来之前缓冲的「追加要求」此刻补投
  onSession?.(session)
  // 用户主动停止:signal 一响就 abort 当前轮次;每个阶段结束后再用 throwIfCancelled 把控制流拉出
  // runJob —— abort 只保证"轮次尽快结束",不代表 prompt 会抛错,所以两条都要有。
  const onAbort = () => void session.abort()
  if (signal?.aborted) onAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new CancelledError()
  }
  // 会话建好之前就被停止(冷启动 + 拷模板慢于巡检间隔):abort 一个还没跑过的会话是空操作,
  // 这里直接退出,别让整整一轮生成白跑(不然会占满 --max-instances 1 的实例)
  throwIfCancelled()
  // tool_execution_end 不带入参,先用 start 事件按 toolCallId 记住本次调用的参数
  const pendingArgs = new Map<string, Record<string, unknown>>()
  // 累积 agent 的正文输出;最后一轮正文(text_end 时定格)即交付说明,回传后作为对话里的 assistant 回复
  let textBuf = ''
  let summary = ''
  const unsubscribe = session.subscribe((event) => {
    // 流式日志:把模型的思考与正文逐 token 追加,前端据此实时显示 agent 在「想什么、写什么」
    if (event.type === 'message_update') {
      const ev = event.assistantMessageEvent
      if (ev.type === 'thinking_start') log.append('\n💭 ')
      else if (ev.type === 'thinking_delta') log.append(ev.delta)
      else if (ev.type === 'thinking_end') log.append('\n')
      else if (ev.type === 'text_start') {
        textBuf = ''
        log.append('\n')
      } else if (ev.type === 'text_delta') {
        textBuf += ev.delta
        log.append(ev.delta)
      } else if (ev.type === 'text_end') {
        if (textBuf.trim()) summary = textBuf.trim()
        textBuf = ''
        log.append('\n')
      }
      return
    }
    if (event.type === 'tool_execution_start') {
      const args = (event.args ?? {}) as Record<string, unknown>
      pendingArgs.set(event.toolCallId, args)
      log.append(`\n🔧 ${event.toolName}${toolArgSummary(args)}\n`)
      return
    }
    if (event.type !== 'tool_execution_end') return
    const args = pendingArgs.get(event.toolCallId)
    pendingArgs.delete(event.toolCallId)
    log.append(event.isError ? '   ✗ 失败\n' : '   ✓ 完成\n')
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
        if (plan) report({ plan, stage: 'coding', progress: '规划完成,正在实现应用' })
      })
      return
    }
    report({ stage: 'coding', progress: `正在编写 ${rel}` })
    void readIfExists(join(workspace, rel)).then((text) => {
      if (text !== null) report({ filePreview: { path: rel, content: text.slice(0, MAX_FILE_PREVIEW) } })
    })
  })

  const startedAt = Date.now()
  const remainingMs = () => config.maxRunMs - (Date.now() - startedAt)
  /** 第一轮的交付说明(复查轮自己的收尾话术不适合当交付说明,所以优先用第一轮的) */
  let deliverSummary = ''

  try {
    await withTimeout(
      session.prompt(buildUserPrompt(req, { imageInputEnabled: config.supportsImageInput }), {
        images: attachmentImages.length ? attachmentImages : undefined,
      }),
      config.maxRunMs,
      () => void session.abort(),
    )
    throwIfCancelled()
    deliverSummary = summary.trim()
    // 构建前再覆盖一次平台文件:模型若无视约束改了组件/SDK,也不会进入产物与源码树
    await restorePlatformFiles(workspace, config.templateDir, false)

    // 第一轮先构建:既是对初稿的校验,也是复查轮回滚的基线
    report({ stage: 'building', progress: '正在构建应用产物' })
    throwIfCancelled()
    await build(workspace, signal)
    const baseline = await collectSource(workspace)

    // 第二轮:同会话的「设计总监复查与打磨」——只精修,不推翻;失败不判 job 失败
    const wantPolish =
      config.designReview === 'always' || (config.designReview === 'generate' && req.type === 'generate')
    if (wantPolish && remainingMs() >= MIN_POLISH_BUDGET_MS) {
      throwIfCancelled()
      const budget = Math.min(config.polishMaxMs, remainingMs())
      log.append('\n💭 设计总监复查轮开始\n')
      report({ stage: 'coding', progress: '正在做设计总监复查与打磨' })
      try {
        await withTimeout(session.prompt(POLISH_PROMPT), budget, () => void session.abort())
        throwIfCancelled()
        await restorePlatformFiles(workspace, config.templateDir, false)
        report({ stage: 'building', progress: '正在重新构建应用产物' })
        try {
          await build(workspace, signal)
        } catch {
          // 复查轮把代码改坏了:回滚到已通过构建的初稿,保证交付可用
          await restoreFromMap(workspace, baseline)
          await build(workspace, signal)
          log.append('\n⚠️ 复查轮产物构建失败,已回落到第一轮结果\n')
        }
      } catch (err) {
        // 复查轮本身失败不判 job 失败;但用户主动停止必须传播出去(别被这里吞成"保留第一轮结果")
        throwIfCancelled()
        log.append(`\n⚠️ 复查轮未完成,保留第一轮结果(${err instanceof Error ? err.message : String(err)})\n`)
      }
      log.append('\n💭 设计总监复查轮结束\n')
    }
  } finally {
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

  return { src, dist, manifest, plan, summary: deliverSummary || summary.trim() || undefined }
}