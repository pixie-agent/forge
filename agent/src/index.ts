/** Cloud Run Service 入口:POST /run 跑一次 agent,GET /health 供健康检查 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createProgressReporter, createStreamLogger, reportCommit, reportFail, startHeartbeat } from './callback.js'
import { loadConfig } from './config.js'
import { runJob } from './runner.js'
import type { RunRequest } from './types.js'

const config = loadConfig()
/** 请求体上限:chat 载荷会带当前版本 HTML(D1 TEXT 列,几十 KB 量级) */
const MAX_BODY_BYTES = 2 * 1024 * 1024

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

    const startedAt = Date.now()
    const log = (msg: string) => console.log(`[run] ${body.jobId.slice(0, 8)} ${msg} (+${Math.round((Date.now() - startedAt) / 1000)}s)`)
    log(`start type=${body.type}`)

    // 心跳 + 进度回调:Worker 以回调为准(响应只作日志)。长请求可能被 Cloudflare 掐断(524),
    // 但 Cloud Run 只要 handler 未返回就继续跑并保持 CPU,因此交付不依赖这次 HTTP 响应
    const stopHeartbeat = startHeartbeat(body.callbackBase, config.agentSecret, body.jobId)
    const streamLog = createStreamLogger(body.callbackBase, config.agentSecret, body.jobId)
    try {
      const report = createProgressReporter(body.callbackBase, config.agentSecret, body.jobId)
      const result = await runJob(config, body, report, streamLog)
      await streamLog.stop()
      log(`done files=${Object.keys(result.src).length} dist=${result.manifest.files.length} plan=${result.plan?.name ?? '-'}`)
      await reportCommit(body.callbackBase, config.agentSecret, body.jobId, result).catch((err) =>
        log(`commit callback failed: ${err instanceof Error ? err.message : String(err)}`),
      )
      send(res, 200, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await streamLog.stop()
      log(`FAILED ${message}`)
      await reportFail(body.callbackBase, config.agentSecret, body.jobId, message)
      send(res, 500, { error: message })
    } finally {
      await streamLog.stop()
      stopHeartbeat()
    }
  })()
})

server.listen(config.port, () => {
  console.log(`[forge-agent] listening on :${config.port} provider=${config.providerId} model=${config.modelId}`)
})