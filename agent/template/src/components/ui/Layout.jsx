import { cx } from '../../lib/cx.js'
import { motion, fadeUp, formatNumber, useCountUp } from '../../lib/motion.jsx'
import { Icon } from './Icon.jsx'

/**
 * 版式与数据展示。Section/SectionTitle 决定页面节奏,Stat 用于统计数字。
 * 用法:<Section id="features"><SectionTitle eyebrow="功能" title="为什么选它" description="一句话说明"/><StatGrid>…</StatGrid></Section>
 */

export function Container({ width = 'default', className = '', children }) {
  const max = width === 'narrow' ? 'max-w-3xl' : width === 'wide' ? 'max-w-[92rem]' : 'max-w-6xl'
  return <div className={cx('mx-auto w-full px-5 md:px-8', max, className)}>{children}</div>
}

/** 页面区段:统一上下留白,配 id 供导航锚点跳转 */
export function Section({ id, className = '', children, tinted = false }) {
  return (
    <section id={id} className={cx('py-16 md:py-24', tinted && 'bg-panel', className)}>
      <Container>{children}</Container>
    </section>
  )
}

export function SectionTitle({ eyebrow, title, description, align = 'left', className = '' }) {
  return (
    <motion.div
      {...fadeUp()}
      className={cx('max-w-2xl', align === 'center' && 'mx-auto text-center', className)}
    >
      {eyebrow ? <p className="mb-3 text-sm font-semibold tracking-wide text-brand uppercase">{eyebrow}</p> : null}
      {title ? <h2 className="text-[28px] leading-tight font-semibold text-ink md:text-[40px]">{title}</h2> : null}
      {description ? <p className="mt-4 text-[17px] leading-relaxed text-muted">{description}</p> : null}
    </motion.div>
  )
}

/** 统计数字:自动滚动到目标值(text 可覆盖显示) */
export function Stat({ label, value, text, hint, icon, className = '' }) {
  const isNumber = typeof value === 'number' && Number.isFinite(value)
  const shown = useCountUp(isNumber ? value : 0)
  return (
    <div className={cx('rounded-card border border-line bg-panel p-5 shadow-card', className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{label}</p>
        {icon ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-pill bg-brand-soft text-brand">
            <Icon name={icon} size={16} />
          </span>
        ) : null}
      </div>
      <p className="tnum mt-3 text-[32px] leading-none font-semibold text-ink">
        {text ?? (isNumber ? formatNumber(shown) : value)}
      </p>
      {hint ? <p className="mt-2 text-[13px] text-muted">{hint}</p> : null}
    </div>
  )
}

export function StatGrid({ cols = 3, className = '', children }) {
  const grid = cols === 2 ? 'sm:grid-cols-2' : cols === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'
  return <div className={cx('grid grid-cols-1 gap-4 md:gap-6', grid, className)}>{children}</div>
}

const TONE = {
  neutral: 'bg-panel-2 text-muted border-line',
  brand: 'bg-brand-soft text-brand border-transparent',
  success: 'bg-success/12 text-success border-transparent',
  warning: 'bg-warning/12 text-warning border-transparent',
  danger: 'bg-danger/12 text-danger border-transparent',
}

export function Badge({ tone = 'neutral', icon, className = '', children }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[13px] font-medium whitespace-nowrap',
        TONE[tone] ?? TONE.neutral,
        className,
      )}
    >
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  )
}
