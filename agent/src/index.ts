/** Cloud Run Service 入口:POST /run 跑一次 agent,GET /health 供健康检查 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  createProgressReporter,
  createStreamLogger,
  reportCheckpoint,
  reportCommit,
  reportFail,
  reportUsage,
  reportWait,
  startHeartbeat,
  startJobWatcher,
} from './callback.js'
import { applyModelOverride, loadConfig, type AgentConfig } from './config.js'
import { FifoQueue } from './queue.js'
import { HumanGatePaused, runJob } from './runner.js'
import { completeText } from './llm.js'
import { isUiLang, t, type UiLang } from './i18n.js'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { FileMap, RunAttachment, RunRequest, RunUsage, SteerMessage } from './types.js'

const config = loadConfig()
/**
 * 请求体上限:chat 载荷会带当前版本源码树,再加上用户附件(base64,合计上限 4MB → 约 5.4MB)。
 * 实时跟进 src/lib/attachments.ts 的 MAX_TOTAL_BYTES,留一倍余量。
 */
const MAX_BODY_BYTES = 24 * 1024 * 1024

const queue = new FifoQueue(config.queueConcurrency)

function readJson(req: IncomingMessage, uiLang: UiLang): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error(t(uiLang, 'error.bodyTooLarge')))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error(t(uiLang, 'error.badJson')))
      }
    })
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(text)
}

function isRunRequest(v: unknown): v is RunRequest {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.jobId === 'string' &&
    typeof r.projectId === 'string' &&
    (r.type === 'generate' || r.type === 'chat') &&
    typeof r.callbackBase === 'string'
  )
}

/**
 * 把用户「生成过程中追加的要求」交给 pi 的 session.steer():
 * 在模型当前轮次收完工具调用后、下一次 LLM 调用前生效(不是立刻打断)。
 * - 图片:直接作为多模态输入(仅在模型声明支持图片时);
 * - 文本附件:生成中没法再往工作目录塞文件让模型 read(它可能已经不在读文件了),所以直接内联进消息。
 */
async function steerSession(session: AgentSession, msg: SteerMessage, config: AgentConfig, log: (m: string) => void): Promise<void> {
  const isImage = (a: RunAttachment) => a.mimeType.startsWith('image/')
  const images = config.supportsImageInput
    ? msg.attachments.filter(isImage).map((a) => ({ type: 'image' as const, data: a.data, mimeType: a.mimeType }))
    : []
  const inlined = msg.attachments
    .filter((a) => !isImage(a))
    .map((a) => `\n\n【用户附上的文本文件 ${a.name}】\n${Buffer.from(a.data, 'base64').toString('utf8').slice(0, 60_000)}`)
    .join('')
  const skippedImages = !config.supportsImageInput && msg.attachments.some(isImage)
  const text =
    `【用户在你执行过程中补充的要求,请落到当前这版实现里】\n${msg.content || '(见附件)'}${inlined}` +
    (skippedImages ? '\n\n(用户还附了图片,但当前模型不支持图片输入,无法查看)' : '')

  await session.steer(text, images.length ? images : undefined)
  log(`steer delivered images=${images.length} textFiles=${msg.attachments.length - images.length}`)
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    // 界面语言:Worker 放在请求头里(请求体之前失败时也要能回对语言),请求体里的 lang 优先
    const headerLang: UiLang = isUiLang(req.headers['x-forge-lang']) ? req.headers['x-forge-lang'] : 'zh'

    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { ok: true })
      return
    }

    if (req.method === 'POST' && url.pathname === '/suggest') {
      if (req.headers['x-agent-secret'] !== config.agentSecret) {
        send(res, 401, { error: t(headerLang, 'error.unauthorized') })
        return
      }
      const body = await readJson(req, headerLang).catch((err) => {
        send(res, 400, { error: err instanceof Error ? err.message : t(headerLang, 'error.badParams') })
        return null
      })
      if (body === null) return
      const rec = (body ?? {}) as Record<string, unknown>
      if (typeof rec.prompt !== 'string' || !rec.prompt.trim()) {
        send(res, 400, { error: t(headerLang, 'error.incomplete') })
        return
      }
      try {
        const text = await completeText(config, {
          prompt: rec.prompt,
          system: typeof rec.system === 'string' && rec.system.trim() ? rec.system : undefined,
          maxTokens: typeof rec.maxTokens === 'number' && Number.isFinite(rec.maxTokens) ? rec.maxTokens : undefined,
        })
        send(res, 200, { text })
      } catch (err) {
        send(res, 502, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    if (req.method !== 'POST' || url.pathname !== '/run') {
      send(res, 404, { error: t(headerLang, 'error.notFound') })
      return
    }

    if (req.headers['x-agent-secret'] !== config.agentSecret) {
      send(res, 401, { error: t(headerLang, 'error.unauthorized') })
      return
    }

    const body = await readJson(req, headerLang).catch((err) => {
      send(res, 400, { error: err instanceof Error ? err.message : t(headerLang, 'error.badParams') })
      return null
    })
    if (body === null) return
    if (!isRunRequest(body)) {
      send(res, 400, { error: t(headerLang, 'error.incomplete') })
      return
    }
    const uiLang: UiLang = isUiLang(body.lang) ? body.lang : headerLang

    // 后台配置的模型覆盖(见 docs/FORGE2.md §21):每次请求独立生效,不改进程级 config,
    // 也不碰密钥 —— baseUrl/modelId/思考档位/复查轮/运行上限都从这里合并,非法值回落 env。
    const runConfig = applyModelOverride(config, body.model)

    // 附件只做形状过滤(大小/类型/数量上限已由 Worker 侧 src/lib/attachments.ts 判定):
    // 脏数据直接丢弃,不让整个 job 崩在半个字段上
    body.attachments = (Array.isArray(body.attachments) ? body.attachments : []).filter(
      (a): a is RunAttachment =>
        !!a &&
        typeof a === 'object' &&
        typeof a.name === 'string' &&
        typeof a.mimeType === 'string' &&
        typeof a.data === 'string' &&
        a.data.length > 0,
    )
    if (!body.attachments.length) delete body.attachments

    // 任务并发:后台随请求下发,缺省回落 env。只限制「同时跑几个 job」,
    // 不改变 Cloud Run --concurrency(那是单实例能接多少请求,由资源侧扩缩容)。
    const queueLimit =
      typeof body.queueConcurrency === 'number' && Number.isFinite(body.queueConcurrency)
        ? Math.min(32, Math.max(0, Math.round(body.queueConcurrency)))
        : config.queueConcurrency
    queue.setLimit(queueLimit)

    const startedAt = Date.now()
    const log = (msg: string) => console.log(`[run] ${body.jobId.slice(0, 8)} ${msg} (+${Math.round((Date.now() - startedAt) / 1000)}s)`)
    log(`accepted type=${body.type} model=${runConfig.modelId}${body.model ? ' (override)' : ''} queue=${queueLimit || 'off'}`)

    // 心跳 + 进度回调:Worker 以回调为准(响应只作日志)。长请求可能被 Cloudflare 掐断(524),
    // 但 Cloud Run 只要 handler 未返回就继续跑并保持 CPU,因此交付不依赖这次 HTTP 响应
    const stopHeartbeat = startHeartbeat(body.callbackBase, config.agentSecret, body.jobId)
    const streamLog = createStreamLogger(body.callbackBase, config.agentSecret, body.jobId)
    // 协作式取消 + 生成中追加要求:两者共用同一次 5s 巡检(见 callback.ts 的 startJobWatcher)
    let cancelledByUser = false
    const abortController = new AbortController()
    // 会话还没建好(拷模板 + 建 pi 会话要十几秒)时先缓冲追加要求,会话一就绪立刻补投
    let liveSession: AgentSession | null = null
    const bufferedSteer: SteerMessage[] = []
    /**
     * 本次运行的用量(tokens 由 runner 在会话销毁前回调给我们)。runMs 在这里补:取整个请求的耗时,
     * 因为 Cloud Run 按实例存活时间计费 —— 拷模板、建会话、构建都在烧钱,只算 pi 那一段会低估成本。
     */
    let usage: RunUsage | null = null
    const reportRunUsage = async () => {
      const u = usage
      if (!u) return
      // HITL 恢复:同一 job 的两段执行用量要累加,不能互相覆盖(见 callback.ts reportUsage 的 accumulate)
      await reportUsage(
        body.callbackBase,
        config.agentSecret,
        body.jobId,
        { ...u, runMs: Date.now() - startedAt },
        !!body.resume,
      )
      log(`usage in=${u.input} out=${u.output} cacheRead=${u.cacheRead} turns=${u.turns}`)
    }
    const deliverSteer = (session: AgentSession, msg: SteerMessage) => {
      void steerSession(session, msg, runConfig, log).catch((err) =>
        log(`steer failed: ${err instanceof Error ? err.message : String(err)}`),
      )
    }
    const stopJobWatch = startJobWatcher(body.callbackBase, config.agentSecret, body.jobId, {
      onCancel: () => {
        cancelledByUser = true
        log('cancel requested by user, aborting')
        abortController.abort()
      },
      onMessages: (messages) => {
        for (const msg of messages) {
          log(`steer received: ${msg.content.slice(0, 40)}`)
          if (liveSession) deliverSteer(liveSession, msg)
          else bufferedSteer.push(msg)
        }
      },
    })
    const report = createProgressReporter(body.callbackBase, config.agentSecret, body.jobId)
    let holdsSlot = false
    try {
      // 排队必须放在心跳/巡检启动之后:等待期间仍要写 updated_at,否则 Worker 巡检会把
      // 还在排队的任务当成失联(180s)判死。取消也会在这里生效,不必等排到才响应。
      if (queueLimit > 0) {
        log(`queue check (running=${queue.running} waiting=${queue.waiting})`)
        // 排队提示:写进 job.progress,前端生成面板直接展示(与常规阶段文案同一条链路)。
        // 排到后 runner 的第一条进度会立刻覆盖,不需要额外清理。
        let lastPosition = -1
        const admission = await queue.acquire(abortController.signal, (position) => {
          if (position === lastPosition) return
          lastPosition = position
          log(`queued position=${position} (running=${queue.running} waiting=${queue.waiting})`)
          report({
            progress:
              position > 0
                ? t(uiLang, 'progress.queued', { n: position })
                : t(uiLang, 'progress.queuedNow'),
          })
        })
        if (admission === 'cancelled') {
          log('CANCELLED while queued')
          send(res, 409, { error: t(uiLang, 'error.cancelled') })
          return
        }
        if (admission === 'slot') {
          holdsSlot = true
          log(`slot acquired (running=${queue.running} waiting=${queue.waiting})`)
        } else {
          // 等待期间后台把并发调到 0:不排队,直接跑
          log('queue disabled by config while waiting, running without a slot')
        }
      }
      const result = await runJob(
        runConfig,
        body,
        report,
        streamLog,
        abortController.signal,
        (session) => {
          liveSession = session
          for (const msg of bufferedSteer.splice(0)) deliverSteer(session, msg)
        },
        (u) => {
          usage = u
        },
        (source) => reportCheckpoint(body.callbackBase, config.agentSecret, body.jobId, source),
        (resume) => reportWait(body.callbackBase, config.agentSecret, body.jobId, resume),
      )
      await streamLog.stop()
      log(`done files=${Object.keys(result.src).length} dist=${result.manifest.files.length} plan=${result.plan?.name ?? '-'}`)
      // 用量先落地再 commit:commit 之后响应就结束了,Cloud Run 会把 CPU 收走,那时再发就未必发得出去
      await reportRunUsage()
      await reportCommit(body.callbackBase, config.agentSecret, body.jobId, result).catch((err) =>
        log(`commit callback failed: ${err instanceof Error ? err.message : String(err)}`),
      )
      send(res, 200, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await streamLog.stop()
      // 失败/被停止同样烧了 token 与实例时间:用量照报(runner 的 finally 已经给到快照),只是不写产物
      await reportRunUsage()
      // HITL 人门:已把恢复上下文交给 Worker(置 waiting_human),这里不报 fail,实例正常释放
      if (err instanceof HumanGatePaused) {
        log('PAUSED waiting for human')
        send(res, 200, { paused: true })
        return
      }
      // 用户主动停止:不报 fail(Worker 侧已是 cancelled 终态,报 fail 也只是幂等空转)
      if (cancelledByUser) {
        log('CANCELLED by user')
        send(res, 409, { error: t(uiLang, 'error.cancelled') })
        return
      }
      log(`FAILED ${message}`)
      await reportFail(body.callbackBase, config.agentSecret, body.jobId, message)
      send(res, 500, { error: message })
    } finally {
      if (holdsSlot) queue.release()
      stopJobWatch()
      await streamLog.stop()
      stopHeartbeat()
    }
  })()
})

server.listen(config.port, () => {
  console.log(`[forge-agent] listening on :${config.port} provider=${config.providerId} model=${config.modelId}`)
})