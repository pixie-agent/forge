import type { OutgoingAttachment } from './attachments'
import type { JobSnapshot } from './types'
import { getActiveLang, tStatic, translateServer } from './i18n'

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    // 服务端只返回中文文案(lib/i18n/serverMessages.ts 负责映射);没映射到的原样透出,不吞原因。
    // code 原样透出:调用方据此做分支(例如 email_unverified 显示重发面板),不必匹配文案。
    let message = tStatic('req.failed', { status: res.status })
    let code: string | undefined
    try {
      const data = (await res.json()) as { error?: string; code?: string }
      if (data.error) message = translateServer(data.error)
      code = data.code
    } catch {
      // 保留默认消息
    }
    const err = new Error(message) as Error & { status: number; code?: string }
    err.status = res.status
    if (code) err.code = code
    throw err
  }
  return (await res.json()) as T
}

/**
 * 创建后台生成任务,立即返回 jobId;body 里可带 attachments(对话附件,见 lib/attachments)。
 * 统一补 `lang`:服务端会把用户消息里的附件/连接器清单、以及任务收尾时补的 assistant 消息
 * **按这里的语言写进库**(见 Worker 侧 src/lib/i18n.ts),所以请求必须带上当前界面语言。
 */
export function startJob(
  path: string,
  body: Record<string, unknown>
): Promise<{ jobId: string; message?: string }> {
  return api<{ jobId: string; message?: string }>(path, { method: 'POST', body: { ...body, lang: getActiveLang() } })
}

const POLL_INTERVAL_MS = 2000
/** 连续轮询失败上限(会话过期/持续断网时终止订阅,避免无限静默重试) */
const MAX_POLL_FAILURES = 3

/**
 * 订阅任务进度:优先 SSE 推送,连接断开自动降级为轮询,全程通过 onUpdate 输出统一快照,
 * 到达终态后自行停止。返回取消函数;连续多次轮询失败时调用 onError(此时任务可能仍在
 * 服务端执行,调用方应结束任务态并提示用户刷新恢复)
 */
export function subscribeJob(
  jobId: string,
  onUpdate: (job: JobSnapshot) => void,
  onError: (message: string) => void
): () => void {
  const es = new EventSource(`/api/jobs/${jobId}/events`)
  let terminal = false
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let failures = 0

  const stop = () => {
    es.close()
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  const apply = (job: JobSnapshot) => {
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      terminal = true
      stop()
    }
    onUpdate(job)
  }

  const startPolling = () => {
    if (pollTimer || terminal) return
    pollTimer = setInterval(async () => {
      try {
        const job = await getJob(jobId)
        failures = 0
        if (job) apply(job)
      } catch {
        failures += 1
        if (failures >= MAX_POLL_FAILURES) {
          stop()
          onError(tStatic('job.progressLost'))
        }
      }
    }, POLL_INTERVAL_MS)
  }

  es.onmessage = (e) => {
    try {
      apply(JSON.parse(e.data) as JobSnapshot)
    } catch {
      // 忽略不完整数据
    }
  }
  es.onerror = () => {
    // 服务端推完终态会主动关流,浏览器触发 onerror 并尝试重连 —— 已拿到终态,直接关闭即可
    if (terminal) {
      stop()
      return
    }
    // 连接异常(网络断/代理掐断/会话过期):降级为轮询,任务本身不受影响
    es.close()
    startPolling()
  }
  return stop
}

export async function getJob(jobId: string): Promise<JobSnapshot | null> {
  const data = await api<{ job: JobSnapshot | null }>(`/api/jobs/${jobId}`)
  return data.job
}

/**
 * 停止项目当前活动任务:服务端立即置 cancelled(项目锁当场释放);Cloud Run 侧的在途执行
 * 由 agent 自己巡检到 cancelled 后中止,因此产物/积分都不会落地。已结束的任务返回 409。
 */
export function cancelJob(projectId: string): Promise<{ ok: boolean; jobId: string }> {
  return api<{ ok: boolean; jobId: string }>(`/api/projects/${projectId}/cancel`, {
    method: 'POST',
    body: { lang: getActiveLang() },
  })
}

/**
 * 生成过程中追加要求(steering):投给正在执行的任务,由 agent 在下一轮 LLM 调用前注入。
 * 只对活动任务有效,任务已结束返回 409(调用方应退化成正常发送)。附件限额比首次提交更紧。
 */
export function steerJob(
  projectId: string,
  body: { jobId: string; message: string; attachments?: OutgoingAttachment[] }
): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/api/projects/${projectId}/steer`, {
    method: 'POST',
    body: { ...body, lang: getActiveLang() },
  })
}

/** 人门应答(approve/choose):对暂停的任务作答,服务端带着断点重新派发(见 docs/FORGE2.md §17.14) */
export function respondJob(
  projectId: string,
  body: { choice?: string; decline?: boolean; feedback?: string }
): Promise<{ ok: boolean; declined?: boolean; jobId?: string }> {
  return api<{ ok: boolean; declined?: boolean; jobId?: string }>(`/api/projects/${projectId}/respond`, {
    method: 'POST',
    body: { ...body, lang: getActiveLang() },
  })
}

/** 活动任务(接管轮询)+ 可续任务(最近一次失败但有产物的任务,继续对话即续跑) */
export async function getActiveJob(
  projectId: string
): Promise<{ job: JobSnapshot | null; resume: JobSnapshot | null }> {
  const data = await api<{ job: JobSnapshot | null; resume: JobSnapshot | null }>(
    `/api/projects/${projectId}/job/active`,
  )
  return { job: data.job ?? null, resume: data.resume ?? null }
}
