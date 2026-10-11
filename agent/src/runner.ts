/** 单个 job 的执行:拷脚手架 → 跑 pi agent 写源码 → 构建 → 收集源码树 + 构建产物 */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import type { AgentConfig } from './config.js'
import type { ProgressReporter, StreamLogger } from './callback.js'
import { buildUserPrompt, parsePlan } from './prompt.js'
import { createForgeSession } from './session.js'
import type { ArtifactManifest, FileMap, Plan, RunRequest, RunResult } from './types.js'

const execFileAsync = promisify(execFile)

/** 收集源码树时跳过的目录(依赖、临时、构建产物) */
const SKIP_DIRS = new Set(['node_modules', '.pi', '.git', 'dist'])
/** 顶层不作为“源码”交付的文件(计划与锁文件) */
const SKIP_ROOT_FILES = new Set(['plan.json', 'package-lock.json'])
const BUILD_TIMEOUT_MS = 5 * 60 * 1000
const MAX_FILE_PREVIEW = 20_000

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
async function build(workspace: string): Promise<void> {
  try {
    await execFileAsync('npm', ['run', 'build'], { cwd: workspace, timeout: BUILD_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 })
  } catch (err) {
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

export async function runJob(
  config: AgentConfig,
  req: RunRequest,
  report: ProgressReporter,
  log: StreamLogger,
): Promise<RunResult> {
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

  report({ stage: req.type === 'chat' ? 'coding' : 'planning', progress: req.type === 'chat' ? '正在按要求修改应用' : '正在规划方案' })

  const session = await createForgeSession(config, workspace)
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
    const rel = relative(workspace, join(workspace, path)).replace(sep, '/')
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

  try {
    await withTimeout(session.prompt(buildUserPrompt(req)), config.maxRunMs, () => void session.abort())
  } finally {
    unsubscribe()
    session.dispose()
  }

  // 平台侧确定性构建
  report({ stage: 'building', progress: '正在构建应用产物' })
  await build(workspace)

  const [src, { dist, manifest }] = await Promise.all([collectSource(workspace), collectDist(workspace)])

  let plan: Plan | undefined
  if (req.type === 'generate') {
    const planText = await readIfExists(join(workspace, 'plan.json'))
    const parsed = planText ? parsePlan(planText) : null
    if (parsed) plan = parsed
  }

  return { src, dist, manifest, plan, summary: summary || undefined }
}