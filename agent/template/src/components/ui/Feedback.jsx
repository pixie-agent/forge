import { cx } from '../../lib/cx.js'
import { t } from '../../lib/locale.js'
import { Icon } from './Icon.jsx'

/**
 * 加载 / 空 / 错误 三态组件。任何异步区域都必须有这三个状态,不要留白屏。
 *   {loading ? <SkeletonCard/> : error ? <ErrorState onRetry={reload}/> : items.length === 0
 *     ? <EmptyState icon="Inbox" title="还没有记录" action={<Button>新增</Button>}/> : <列表/>}
 */

/** 局部小转圈:尺寸随字号 */
export function Spinner({ className = '', size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cx('anim-spin', className)}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/** 骨架块:尺寸用 className 传(如 h-4 w-32) */
export function Skeleton({ className = '' }) {
  return <div className={cx('shimmer rounded-md bg-panel-2', className)} aria-hidden="true" />
}

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={cx('space-y-2.5', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cx('h-4', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  )
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="rounded-card border border-line bg-panel p-5">
      <Skeleton className="h-5 w-1/3" />
      <div className="mt-4">
        <SkeletonText lines={lines} />
      </div>
    </div>
  )
}

/** 整块加载中:给出文字,不要只留一个转圈 */
export function LoadingBlock({ label = t('loading'), className = '' }) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-3 py-12 text-muted', className)} role="status">
      <Spinner size={22} />
      <p className="text-sm">{label}</p>
    </div>
  )
}

export function EmptyState({ icon = 'Inbox', title = t('empty'), description, action = null, className = '' }) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center rounded-card border border-dashed border-line bg-panel/60 px-6 py-14 text-center',
        className,
      )}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-pill bg-brand-soft text-brand">
        <Icon name={icon} size={24} />
      </div>
      <h3 className="text-[17px] font-semibold text-ink">{title}</h3>
      {description ? <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

/** 错误态:必须给出「重试」这类可执行的下一步 */
export function ErrorState({ title = t('loadFailed'), description, onRetry, retryText = t('retry'), className = '' }) {
  return (
    <div className={cx('rounded-card border border-line bg-panel px-6 py-10 text-center', className)} role="alert">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-pill bg-danger/10 text-danger">
        <Icon name="AlertTriangle" size={24} />
      </div>
      <h3 className="text-[17px] font-semibold text-ink">{title}</h3>
      {description ? <p className="mt-1.5 text-sm text-muted">{description}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex h-11 items-center gap-2 rounded-field border border-line bg-panel-2 px-5 text-[15px] font-medium text-ink transition-colors duration-200 ease-soft hover:bg-line"
        >
          <Icon name="RefreshCw" size={16} />
          {retryText}
        </button>
      ) : null}
    </div>
  )
}
