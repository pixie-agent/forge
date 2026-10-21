/**
 * 进程内 FIFO 排队(仅免费执行体启用,见 AGENTS.md §1 与 docs/FORGE2.md §21.5)。
 * 这里限制的是**任务并发**(同时跑几个 job),与 Cloud Run 的 --concurrency(单实例能接多少请求)无关;
 * 后者由资源侧扩缩容,前者由后台 model_configs.queue_concurrency 随每次派发下发。
 * Cloud Run 的请求队列只等约 10s 就返回 429,长任务必须由进程自己排队:
 * 同一实例同时只跑 `limit` 个,后来的请求在这里等,前面的跑完按顺序放行。
 * limit = 0 时完全不影响原有行为(VIP 执行体)。
 */
export class FifoQueue {
  private active = 0
  private waiters: { wake: (granted: boolean) => void; notify?: (position: number) => void; last?: number }[] = []
  private limit: number

  constructor(limit: number) {
    this.limit = limit
  }

  /** 当前排队人数(日志用) */
  get waiting(): number {
    return this.waiters.length
  }

  /** 当前正在执行的任务数(日志用) */
  get running(): number {
    return this.active
  }

  /**
   * 后台配置变化时生效:调大立即放行等待者,调 0 清空队列(全部直接放行)。
   * 每次都从请求里带下来,所以改配置后下一条任务就会用新值,不需要重启实例。
   */
  setLimit(limit: number): void {
    this.limit = limit
    this.pump()
  }

  /** 通知所有等待者「前面还有几个任务」(正在跑的 + 排在更前面的),位置没变不重复回调 */
  private notifyWaiters(): void {
    this.waiters.forEach((w, i) => {
      const position = this.active + i
      if (w.last === position) return
      w.last = position
      w.notify?.(position)
    })
  }

  /** 按当前 limit 放行等待者;limit <= 0 表示不排队,等待者不占执行位直接放行 */
  private pump(): void {
    if (this.limit <= 0) {
      while (this.waiters.length) this.waiters.shift()!.wake(false)
      return
    }
    while (this.active < this.limit && this.waiters.length) {
      this.active++
      this.waiters.shift()!.wake(true)
    }
    this.notifyWaiters()
  }

  /**
   * 拿到一个执行位;排队期间被用户取消则返回 cancelled。
   * onWait 在入队时与队列推进时回调「前面还有几个任务」,让用户能感知到自己正在排队。
   */
  async acquire(signal: AbortSignal, onWait?: (position: number) => void): Promise<'slot' | 'noqueue' | 'cancelled'> {
    if (signal.aborted) return 'cancelled'
    if (this.limit <= 0) return 'noqueue'
    if (this.active < this.limit) {
      this.active++
      return 'slot'
    }
    return await new Promise<'slot' | 'noqueue' | 'cancelled'>((resolve) => {
      const onAbort = () => {
        const i = this.waiters.findIndex((w) => w.wake === wake)
        if (i >= 0) this.waiters.splice(i, 1)
        this.notifyWaiters()
        resolve('cancelled')
      }
      const wake = (granted: boolean) => {
        signal.removeEventListener('abort', onAbort)
        resolve(granted ? 'slot' : 'noqueue')
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.waiters.push({ wake, notify: onWait })
      this.notifyWaiters()
    })
  }

  /** 释放执行位:先减计数,再按当前 limit 唤醒队首 */
  release(): void {
    this.active = Math.max(0, this.active - 1)
    this.pump()
  }
}
