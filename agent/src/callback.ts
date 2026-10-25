/** 与 Cloudflare Worker 内部接口的通信:进度/心跳上报,以及最终结果的 commit / fail 回调 */

import type { Plan, RunResult, RunUsage, SteerMessage } from './types.js'

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
 * 里程碑日志上报:runner 只把关键节点(复查轮开始/结束、交付语言重问、告警)append 进来,
 * 增量 POST 到 Worker 的 /log 接口。pi 的逐 token thinking/正文/工具调用**不走这里** ——
 * 那些直接写 Cloud Run stdout(运维排查用),否则会把 D1 当消息总线写爆(实测几万行/天)。
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
    // 不在这里递归续发:否则每个网络往返就写一次 D1(实测 ~11 次/秒)。
    // 后续增量交给 interval 的下一次触发,最多 800ms 一批。
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

/**
 * 任务巡检(每 5s 一次 GET /internal/jobs/:id/state),一次轮询承担两件事:
 * - **取消**:用户点「停止」→ onCancel,调用方 abort 当前轮次(Cloud Run 的在途请求无法被
 *   Worker 反向杀掉,所以取消是协作式的:agent 自己查、自己收手);
 * - **追加要求**:用户在生成过程中补充的话/图 → onMessages,调用方 session.steer() 进去。
 * 取消是终态,一旦命中就停止轮询;消息只管转发,不用回执(Worker 侧已标记 consumed)。
 * 请求异常只当网络抖动,下一轮再试(不因此放弃巡检)。
 * 返回停止函数。
 */
export interface JobWatchHandlers {
  onCancel: () => void
  onMessages?: (messages: SteerMessage[]) => void
}

export function startJobWatcher(
  callbackBase: string,
  secret: string,
  jobId: string,
  handlers: JobWatchHandlers,
  intervalMs = 5_000,
): () => void {
  let stopped = false
  const url = `${callbackBase.replace(/\/+$/, '')}/internal/jobs/${jobId}/state`
  const tick = async () => {
    if (stopped) return
    try {
      const res = await fetch(url, { headers: { 'X-Agent-Secret': secret } })
      if (stopped || !res.ok) return
      const data = (await res.json()) as { cancelled?: boolean; messages?: SteerMessage[] }
      if (data.cancelled) {
        stopped = true
        clearInterval(timer)
        handlers.onCancel()
        return
      }
      if (data.messages?.length) handlers.onMessages?.(data.messages)
    } catch {
      // 网络抖动/网关抖动:下一轮再问
    }
  }
  const timer = setInterval(() => void tick(), intervalMs)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

/** 最终结果回调(与 HTTP 响应二选一即可:Worker 以该回调为准,响应不作为交付依据) */
export async function reportCommit(callbackBase: string, secret: string, jobId: string, result: RunResult): Promise<void> {
  const res = await post(callbackBase, secret, jobId, 'commit', result)
  if (!res.ok) throw new Error(`commit 回调失败 http ${res.status}`)
}

export async function reportFail(callbackBase: string, secret: string, jobId: string, error: string): Promise<void> {
  await post(callbackBase, secret, jobId, 'fail', { error }).catch(() => {})
}

/**
 * 断点快照:把当前工作目录的源码树整份上报给 Worker(存 R2)。
 * 任务成功时由 commit 清掉;失败/被停止时保留,供用户「从断点继续」。
 * 失败只记日志 —— 快照是增强能力,不能影响生成主流程。
 */
export async function reportCheckpoint(
  callbackBase: string,
  secret: string,
  jobId: string,
  source: Record<string, string>,
): Promise<boolean> {
  try {
    const res = await post(callbackBase, secret, jobId, 'checkpoint', { source })
    if (!res.ok) {
      console.error(`[checkpoint] http ${res.status}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[checkpoint] ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/**
 * 用量上报:token 与耗时的真实数字,Worker 侧换算成美元写进 job_usage(见 src/lib/pricing.ts)。
 * 这是纯统计:重放无害(Worker 按 job_id upsert),失败也只记日志 —— 绝不能因为统计写不进去
 * 而改变任务的终态。
 */
export async function reportUsage(
  callbackBase: string,
  secret: string,
  jobId: string,
  usage: RunUsage & { runMs: number },
): Promise<void> {
  await post(callbackBase, secret, jobId, 'usage', usage)
    .then((res) => {
      if (!res.ok) console.error(`[usage] http ${res.status}`)
    })
    .catch((err) => console.error(`[usage] ${err instanceof Error ? err.message : String(err)}`))
}
