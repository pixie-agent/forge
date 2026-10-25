import { useEffect, useRef, useState } from 'react'

/**
 * 平滑走秒:服务端快照每隔几秒才到一次,直接展示 `elapsed` 会让计时器一跳一跳的。
 * 以最近一次快照的 `elapsed` 为锚点,本地每秒自增;快照到达时只是「对表」,运动本身留在前端。
 *
 * - `running = false` 时停住,不再往前走(任务已结束,展示最终耗时)。
 * - `resetKey`(任务 id)变化时以服务端值为准重新起算,避免上一个任务的秒数漏到新任务。
 * - 同一任务内取「本地估算」与「服务端值」的较大者:快照可能比本地晚一两秒到,不能把计时器往回拨。
 */
export function useElapsed(serverElapsed: number, running: boolean, resetKey?: string | null): number {
  const [elapsed, setElapsed] = useState(serverElapsed)
  const state = useRef({ key: resetKey ?? null, value: serverElapsed, at: Date.now() })

  useEffect(() => {
    const now = Date.now()
    const prev = state.current
    if (prev.key !== (resetKey ?? null)) {
      state.current = { key: resetKey ?? null, value: serverElapsed, at: now }
      setElapsed(serverElapsed)
      return
    }
    const local = prev.value + Math.floor((now - prev.at) / 1000)
    const value = Math.max(local, serverElapsed)
    state.current = { key: prev.key, value, at: now }
    setElapsed(value)
  }, [serverElapsed, resetKey])

  useEffect(() => {
    if (!running) return
    const tick = () => {
      const s = state.current
      setElapsed(s.value + Math.floor((Date.now() - s.at) / 1000))
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [running, serverElapsed, resetKey])

  return elapsed
}
