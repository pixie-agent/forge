import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { AnimatePresence, motion } from '../../lib/motion.jsx'
import { cx } from '../../lib/cx.js'
import { Icon } from './Icon.jsx'

/**
 * 轻提示(Toast):提交成功/失败给一次反馈,不要只靠静默跳转。
 * 用法:
 *   ① 在应用根组件包一层:<ToastProvider>…整个 App…</ToastProvider>
 *   ② 任意子组件里:const toast = useToast(); toast.success('已保存')
 */
const ToastCtx = createContext(null)
let seq = 0

const TONE = {
  success: { icon: 'CheckCircle2', cls: 'text-success' },
  error: { icon: 'XCircle', cls: 'text-danger' },
  info: { icon: 'Info', cls: 'text-brand' },
}

/** 没有包 Provider 时的兜底:不崩、不显示(控制台提示一次) */
const NOOP = {
  toast: () => console.warn('[toast] 请在根组件包一层 <ToastProvider>'),
  success: () => console.warn('[toast] 请在根组件包一层 <ToastProvider>'),
  error: () => console.warn('[toast] 请在根组件包一层 <ToastProvider>'),
  info: () => console.warn('[toast] 请在根组件包一层 <ToastProvider>'),
  dismiss: () => {},
}

export function ToastProvider({ children, duration = 3200, position = 'top' }) {
  const [items, setItems] = useState([])

  const dismiss = useCallback((id) => setItems((prev) => prev.filter((t) => t.id !== id)), [])

  const push = useCallback(
    (message, tone = 'info', opts = {}) => {
      const id = ++seq
      // 最多同时显示 4 条,超出丢弃最早的
      setItems((prev) => [...prev.slice(-3), { id, message, tone }])
      const ms = opts.duration ?? duration
      if (ms > 0) setTimeout(() => dismiss(id), ms)
      return id
    },
    [dismiss, duration],
  )

  const api = useMemo(
    () => ({
      toast: (m, o) => push(m, 'info', o),
      info: (m, o) => push(m, 'info', o),
      success: (m, o) => push(m, 'success', o),
      error: (m, o) => push(m, 'error', o),
      dismiss,
    }),
    [push, dismiss],
  )

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        className={cx(
          'pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4',
          position === 'bottom' ? 'bottom-5' : 'top-5',
        )}
        aria-live="polite"
        role="status"
      >
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const tone = TONE[t.tone] ?? TONE.info
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: position === 'bottom' ? 12 : -12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border border-line bg-panel px-4 py-3 shadow-pop"
              >
                <span className={cx('mt-0.5 shrink-0', tone.cls)}>
                  <Icon name={tone.icon} size={18} />
                </span>
                <p className="min-w-0 flex-1 text-[15px] leading-snug text-ink">{t.message}</p>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="关闭提示"
                  className="-mr-1 shrink-0 rounded-md p-1 text-muted transition-colors hover:text-ink"
                >
                  <Icon name="X" size={15} />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  return useContext(ToastCtx) ?? NOOP
}
