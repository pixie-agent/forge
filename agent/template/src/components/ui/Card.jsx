import { cx } from '../../lib/cx.js'

/**
 * 卡片与分区。用它们承载页面里的每一块内容,不要写裸 div 拼边框。
 * 用法:<Card hover><CardHeader title="标题" subtitle="副标题" action={<Badge>新</Badge>}/><CardBody>…</CardBody></Card>
 */
export function Card({ as: Tag = 'div', hover = false, padding = 'md', className = '', children, ...rest }) {
  return (
    <Tag
      className={cx(
        'rounded-card border border-line bg-panel shadow-card',
        'transition-[transform,box-shadow] duration-300 ease-soft',
        hover && 'hover:-translate-y-0.5 hover:shadow-lift',
        padding === 'lg' ? 'p-6 md:p-8' : padding === 'none' ? '' : 'p-5 md:p-6',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  )
}

export function CardHeader({ title, subtitle, action = null, className = '' }) {
  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {title ? <h3 className="text-[17px] font-semibold text-ink">{title}</h3> : null}
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function CardBody({ className = '', children }) {
  return <div className={cx('mt-4', className)}>{children}</div>
}

export function CardFooter({ className = '', children }) {
  return <div className={cx('mt-5 flex items-center gap-2 border-t border-line pt-4', className)}>{children}</div>
}
