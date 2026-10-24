import { useId, useState } from 'react'
import { AnimatePresence, motion } from '../../lib/motion.jsx'
import { cx } from '../../lib/cx.js'
import { t } from '../../lib/locale.js'

/**
 * 标签页与分段控件。用于「同页多视图」切换(列表/看板、日/周/月)。
 * 用法:
 *   <Tabs items={[{key:'all',label:'全部',content:<列表/>},{key:'done',label:'已完成',content:<列表/>}]} />
 *   <SegmentedControl items={[{key:'day',label:'日'}]} value={v} onChange={setV} />
 */
export function Tabs({ items = [], value, onChange, className = '' }) {
  const [inner, setInner] = useState(items[0]?.key)
  const uid = useId()
  const active = value ?? inner
  const current = items.find((i) => i.key === active) ?? items[0]

  function select(key) {
    if (value === undefined) setInner(key)
    onChange?.(key)
  }

  function onKeyDown(e) {
    const idx = items.findIndex((i) => i.key === active)
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const next = e.key === 'ArrowRight' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length
      select(items[next].key)
    }
  }

  return (
    <div className={className}>
      <div role="tablist" aria-label={t('viewSwitch')} onKeyDown={onKeyDown} className="flex gap-1 border-b border-line">
        {items.map((it) => {
          const on = it.key === active
          return (
            <button
              key={it.key}
              role="tab"
              type="button"
              id={`${uid}-tab-${it.key}`}
              aria-selected={on}
              aria-controls={`${uid}-panel-${it.key}`}
              tabIndex={on ? 0 : -1}
              onClick={() => select(it.key)}
              className={cx(
                'relative -mb-px rounded-t-field px-4 py-2.5 text-[15px] font-medium transition-colors duration-200 ease-soft',
                on ? 'text-ink' : 'text-muted hover:text-ink',
              )}
            >
              <span className="inline-flex items-center gap-2">
                {it.icon ? it.icon : null}
                {it.label}
              </span>
              {on ? (
                <motion.span layoutId={`${uid}-underline`} className="absolute inset-x-2 -bottom-px h-0.5 rounded-pill bg-brand" />
              ) : null}
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        id={`${uid}-panel-${current?.key}`}
        aria-labelledby={`${uid}-tab-${current?.key}`}
        className="pt-5"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current?.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {current?.content}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

/** 分段控件:iOS 风格的小切换开关 */
export function SegmentedControl({ items = [], value, onChange, className = '' }) {
  const uid = useId()
  const active = value ?? items[0]?.key
  return (
    <div
      role="tablist"
      aria-label={t('segmentedSwitch')}
      className={cx('inline-flex rounded-pill border border-line bg-panel-2 p-1', className)}
    >
      {items.map((it) => {
        const on = it.key === active
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange?.(it.key)}
            className={cx(
              'relative rounded-pill px-4 py-1.5 text-sm font-medium transition-colors duration-200 ease-soft',
              on ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {on ? <motion.span layoutId={`${uid}-seg`} className="absolute inset-0 -z-10 rounded-pill bg-canvas shadow-card" /> : null}
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
