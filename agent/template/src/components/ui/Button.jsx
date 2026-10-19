import { cx } from '../../lib/cx.js'
import { Spinner } from './Feedback.jsx'

/**
 * 按钮。所有交互态(hover / active / focus-visible / disabled / loading)已内置。
 * 用法:<Button onClick={fn}>开始使用</Button>
 *      <Button variant="secondary" size="sm" icon={<Icon name="Plus" />}>新增</Button>
 */
const VARIANT = {
  primary: 'bg-brand text-white hover:bg-brand-600 active:bg-brand-700 shadow-card',
  secondary: 'bg-panel-2 text-ink hover:bg-line border border-line',
  outline: 'bg-transparent text-ink border border-line hover:bg-panel-2',
  ghost: 'bg-transparent text-muted hover:bg-panel-2 hover:text-ink',
  danger: 'bg-danger text-white hover:opacity-90',
  link: 'bg-transparent text-brand underline-offset-4 hover:underline px-0',
}

const SIZE = {
  sm: 'h-9 px-3.5 text-sm rounded-field gap-1.5',
  md: 'h-11 px-5 text-[15px] rounded-field gap-2',
  lg: 'h-12 px-6 text-base rounded-field gap-2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  full = false,
  icon = null,
  iconRight = null,
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  const isDisabled = disabled || loading
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center font-medium whitespace-nowrap select-none',
        'transition-[transform,background-color,color,box-shadow] duration-200 ease-soft',
        'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
        VARIANT[variant] ?? VARIANT.primary,
        SIZE[size] ?? SIZE.md,
        full && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {iconRight}
    </button>
  )
}

/** 只有图标的方形按钮(工具栏/关闭按钮);必须提供 aria-label */
export function IconButton({ label, size = 'md', variant = 'ghost', className = '', children, ...rest }) {
  const box = size === 'sm' ? 'h-9 w-9' : 'h-11 w-11'
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex items-center justify-center rounded-field transition-colors duration-200 ease-soft',
        'hover:bg-panel-2 active:scale-95 disabled:opacity-45 disabled:pointer-events-none',
        VARIANT[variant] ?? VARIANT.ghost,
        box,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
