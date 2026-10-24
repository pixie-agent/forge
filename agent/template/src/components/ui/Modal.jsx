import { useEffect } from 'react'
import { AnimatePresence, motion } from '../../lib/motion.jsx'
import { cx } from '../../lib/cx.js'
import { t } from '../../lib/locale.js'
import { Button, IconButton } from './Button.jsx'
import { Icon } from './Icon.jsx'

/**
 * 弹层。支持 ESC / 点遮罩 / 右上角关闭,自动锁滚动并聚焦。
 * 用法:<Modal open={open} onClose={() => setOpen(false)} title="编辑" footer={<Button>保存</Button>}>内容</Modal>
 */
const WIDTH = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }

export function Modal({ open, onClose, title, description, footer = null, size = 'md', className = '', children }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => onClose?.()}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className={cx(
              'relative z-10 w-full rounded-t-card border border-line bg-panel shadow-pop sm:rounded-card',
              WIDTH[size] ?? WIDTH.md,
              className,
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 md:px-6">
              <div className="min-w-0">
                {title ? <h2 className="text-[17px] font-semibold text-ink">{title}</h2> : null}
                {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
              </div>
              <IconButton label={t('close')} size="sm" onClick={() => onClose?.()}>
                <Icon name="X" />
              </IconButton>
            </div>
            <div className="px-5 py-5 md:px-6">{children}</div>
            {footer ? <div className="flex justify-end gap-2 border-t border-line px-5 py-4 md:px-6">{footer}</div> : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  )
}

/** 二次确认:删除等破坏性操作必须走它 */
export function ConfirmDialog({
  open,
  title = t('confirmTitle'),
  description,
  confirmText = t('confirm'),
  cancelText = t('cancel'),
  tone = 'danger',
  onConfirm,
  onClose,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose?.()}>
            {cancelText}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm?.()
              onClose?.()
            }}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="text-[15px] text-muted">{t('irreversible')}</p>
    </Modal>
  )
}
