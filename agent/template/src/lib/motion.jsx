/**
 * 动效原语(基于 motion / motion/react)。默认克制:短时长、软缓动、只做位移与淡入。
 *
 * 常用:
 *   <Reveal>…</Reveal>              滚动进入视口时淡入上浮(区段/卡片首选)
 *   <Stagger>…<StaggerItem>…       列表或卡片组按序进场
 *   const n = useCountUp(total)     数字滚动(统计卡片)
 *   useReducedMotion()              系统是否要求减少动态效果
 *
 * 约定:不要在页面里写超过 400ms 的动画,也不要让动画成为传达信息的唯一手段。
 */
import { useEffect, useRef, useState } from 'react'
import { motion, useInView, useReducedMotion } from 'motion/react'

export { motion, useReducedMotion }
export { AnimatePresence } from 'motion/react'

export const SOFT = [0.22, 1, 0.36, 1]
export const SPRING = { type: 'spring', stiffness: 320, damping: 28, mass: 0.7 }

/** 进场过渡:统一时长与缓动,reduced-motion 下退化为「直接出现」 */
export function fadeUp(delay = 0, y = 14) {
  return {
    initial: { opacity: 0, y },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.15 },
    transition: { duration: 0.5, delay, ease: SOFT },
  }
}

/** 元素是否进入过视口(一次性) */
export function useSeen(options = {}) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: options.once !== false, amount: options.amount ?? 0.15 })
  return [ref, inView]
}

/** 数字滚动:从 0 到 target,尊重 reduced-motion(直接给终值) */
export function useCountUp(target, { duration = 1100, decimals = 0 } = {}) {
  const reduce = useReducedMotion()
  const value = Number(target) || 0
  const [display, setDisplay] = useState(reduce ? value : 0)

  useEffect(() => {
    if (reduce) {
      setDisplay(value)
      return
    }
    let raf = 0
    const start = performance.now()
    const from = 0
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration)
      // easeOutCubic,收尾更自然
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(from + (value - from) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration, reduce])

  const factor = Math.pow(10, decimals)
  return Math.round(display * factor) / factor
}

/** 数字格式化成中文习惯(千分位;超过 1 万折算成「万」) */
export function formatNumber(n, { decimals = 0 } = {}) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 10000) {
    const w = v / 10000
    return `${w.toFixed(Math.abs(w) >= 100 ? 0 : 1)} 万`
  }
  return v.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
