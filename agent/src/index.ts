/** Cloud Run Service 入口:POST /run 跑一次 agent,GET /health 供健康检查 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createProgressReporter, createStreamLogger, reportCommit, reportFail, startHeartbeat, startJobWatcher } from './callback.js'
import { loadConfig, type AgentConfig } from './config.js'
import { runJob } from './runner.js'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import type { RunAttachment, RunRequest, SteerMessage } from './types.js'

const config = loadConfig()
/**
 * 请求体上限:chat 载荷会带当前版本源码树,再加上用户附件(base64,合计上限 4MB → 约 5.4MB)。
 * 实时跟进 src/lib/attachments.ts 的 MAX_TOTAL_BYTES,留一倍余量。
 */
const MAX_BODY_BYTES = 24 * 1024 * 1024

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
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

    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { ok: true })
      return
    }

    if (req.method !== 'POST' || url.pathname !== '/run') {
      send(res, 404, { error: '不存在' })
      return
    }

    if (req.headers['x-agent-secret'] !== config.agentSecret) {
      send(res, 401, { error: '未授权' })
      return
    }

    const body = await readJson(req).catch((err) => {
      send(res, 400, { error: err instanceof Error ? err.message : '参数错误' })
      return null
    })
    if (body === null) return
    if (!isRunRequest(body)) {
      send(res, 400, { error: '参数不完整' })
      return
    }

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

    const startedAt = Date.now()
    const log = (msg: string) => console.log(`[run] ${body.jobId.slice(0, 8)} ${msg} (+${Math.round((Date.now() - startedAt) / 1000)}s)`)
    log(`start type=${body.type}`)

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
    const deliverSteer = (session: AgentSession, msg: SteerMessage) => {
      void steerSession(session, msg, config, log).catch((err) =>
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
    try {
      const report = createProgressReporter(body.callbackBase, config.agentSecret, body.jobId)
      const result = await runJob(config, body, report, streamLog, abortController.signal, (session) => {
        liveSession = session
        for (const msg of bufferedSteer.splice(0)) deliverSteer(session, msg)
      })
      await streamLog.stop()
      log(`done files=${Object.keys(result.src).length} dist=${result.manifest.files.length} plan=${result.plan?.name ?? '-'}`)
      await reportCommit(body.callbackBase, config.agentSecret, body.jobId, result).catch((err) =>
        log(`commit callback failed: ${err instanceof Error ? err.message : String(err)}`),
      )
      send(res, 200, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await streamLog.stop()
      // 用户主动停止:不报 fail(Worker 侧已是 cancelled 终态,报 fail 也只是幂等空转)
      if (cancelledByUser) {
        log('CANCELLED by user')
        send(res, 409, { error: '任务已被用户停止' })
        return
      }
      log(`FAILED ${message}`)
      await reportFail(body.callbackBase, config.agentSecret, body.jobId, message)
      send(res, 500, { error: message })
    } finally {
      stopJobWatch()
      await streamLog.stop()
      stopHeartbeat()
    }
  })()
})

server.listen(config.port, () => {
  console.log(`[forge-agent] listening on :${config.port} provider=${config.providerId} model=${config.modelId}`)
})