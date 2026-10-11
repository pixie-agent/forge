/** 与 Cloudflare Worker 内部接口的通信:进度/心跳上报,以及最终结果的 commit / fail 回调 */

import type { Plan, RunResult } from './types.js'

export interface ProgressUpdate {
  stage?: 'planning' | 'coding' | 'building'
  progress?: string
  plan?: Plan
  /** agent 最近写入的源文件,前端实时看代码 */
  filePreview?: { path: string; content: string }
}

export type ProgressReporter = (update: ProgressUpdate) => void

function post(callbackBase: string, secret: string, jobId: string, path: string, body: unknown): Promise<Response> {
  const url = `${callbackBase.replace(/\/+$/, '')}/internal/jobs/${jobId}/${path}`
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Secret': secret },
    body: JSON.stringify(body),
  })
}

/** 同字段节流:html_preview 体积大,合并到最多每 intervalMs 推一次;文字进度即时推 */
function throttle(intervalMs: number) {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: (() => void) | undefined
  return (fn: () => void) => {
    const now = Date.now()
    if (now - last >= intervalMs) {
      last = now
      fn()
      return
    }
    pending = fn
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      last = Date.now()
      const run = pending
      pending = undefined
      run?.()
    }, intervalMs - (now - last))
  }
}

/**
 * 创建进度上报器。内部按字段节流并 fire-and-forget 上报,失败只打日志,
 * 绝不因回调异常打断 agent 主流程。
 */
export function createProgressReporter(callbackBase: string, secret: string, jobId: string): ProgressReporter {
  const flushHeavy = throttle(3000)
  const send = (update: ProgressUpdate) => {
    void post(callbackBase, secret, jobId, 'progress', update)
      .then((res) => {
        if (!res.ok) console.error(`[progress] http ${res.status}`)
      })
      .catch((err) => console.error(`[progress] ${err instanceof Error ? err.message : String(err)}`))
  }
  return (update) => {
    if (update.filePreview !== undefined) {
      // 大字段走节流;其余字段(文字进度)立即上报一份不含 filePreview 的
      const { filePreview, ...rest } = update
      if (Object.keys(rest).length) send(rest)
      flushHeavy(() => send({ filePreview }))
      return
    }
    send(update)
  }
}

/**
 * 流式日志:把 pi 的 thinking / 正文 / 工具调用事件累积进本地缓冲,增量 POST 到 Worker 的 /log 接口。
 * 串行化上报(上一次未回就不发下一批),避免 D1 侧追加乱序;stop() 会等待在途请求并把剩余缓冲补发,
 * 确保终态落定前的最后一段输出不丢。Worker 侧用 substr 保留尾部,故此处不做长度裁剪。
 */
export function createStreamLogger(callbackBase: string, secret: string, jobId: string, intervalMs = 800) {
  let buf = ''
  let sent = 0
  let flushing = false
  let stopped = false

  async function flush(): Promise<void> {
    if (flushing || sent >= buf.length) return
    flushing = true
    const chunk = buf.slice(sent)
    sent = buf.length
    try {
      await post(callbackBase, secret, jobId, 'log', { chunk })
    } catch (err) {
      console.error(`[log] ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      flushing = false
    }
    if (!stopped && sent < buf.length) void flush()
  }

  const timer = setInterval(() => void flush(), intervalMs)

  return {
    /** 追加一段流式文本:先入本地缓冲,再异步增量上报 */
    append(text: string) {
      if (!stopped && text) buf += text
    },
    /** 停止定时器,等待在途请求并补发剩余缓冲 */
    async stop(): Promise<void> {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      while (flushing) await new Promise((r) => setTimeout(r, 20))
      await flush()
    },
  }
}

export type StreamLogger = ReturnType<typeof createStreamLogger>

/**
 * 心跳:agent 跑多久,就每 intervalMs 触碰一次任务的 updated_at。
 * Worker 侧 cron 据此判断执行体是否还活着(heartbeat 停了即判死),不依赖长连接的存活。
 * 返回停止函数。
 */
export function startHeartbeat(callbackBase: string, secret: string, jobId: string, intervalMs = 20_000): () => void {
  const tick = () => {
    void post(callbackBase, secret, jobId, 'progress', { heartbeat: true }).catch(() => {})
  }
  tick()
  const timer = setInterval(tick, intervalMs)
  return () => clearInterval(timer)
}

/** 最终结果回调(与 HTTP 响应二选一即可:Worker 以该回调为准,响应不作为交付依据) */
export async function reportCommit(callbackBase: string, secret: string, jobId: string, result: RunResult): Promise<void> {
  const res = await post(callbackBase, secret, jobId, 'commit', result)
  if (!res.ok) throw new Error(`commit 回调失败 http ${res.status}`)
}

export async function reportFail(callbackBase: string, secret: string, jobId: string, error: string): Promise<void> {
  await post(callbackBase, secret, jobId, 'fail', { error }).catch(() => {})
}