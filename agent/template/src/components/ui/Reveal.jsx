import { motion } from '../../lib/motion.jsx'

/**
 * 滚动进场包装。区段、卡片组套上一层即可,不需要自己写 IntersectionObserver。
 * 用法:<Reveal delay={0.05}>…</Reveal>   /   <Stagger><StaggerItem>…</StaggerItem></Stagger>
 * 注意:一次进场只做位移 + 淡入,时长 ≤500ms;系统开启「减少动态效果」时自动直接显示。
 */
const EASE = [0.22, 1, 0.36, 1]

export function Reveal({ children, delay = 0, y = 14, className = '', as = 'div' }) {
  const Cmp = motion[as] ?? motion.div
  return (
    <Cmp
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
    >
      {children}
    </Cmp>
  )
}

/** 一组元素按序进场(容器)。子项用 StaggerItem。 */
export function Stagger({ children, gap = 0.07, className = '' }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.1 }}
      variants={{ show: { transition: { staggerChildren: gap } } }}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, y = 16, className = '' }) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y },
        show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
      }}
    >
      {children}
    </motion.div>
  )
}
