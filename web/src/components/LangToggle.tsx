import { useEffect, useRef, useState } from 'react'
import { LANG_OPTIONS, preloadLang, useI18n } from '../lib/i18n'

/**
 * 语言选择器。
 *
 * 早期只有中/英两门语言,这里是个「一键切换」按钮;扩到 11 门之后必须变成
 * 下拉菜单 —— 循环切换会让用户每次都要点好几下才能到目标语言。
 */
export default function LangToggle() {
  const { lang, setLang, t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const current = LANG_OPTIONS.find((o) => o.code === lang) ?? LANG_OPTIONS[1]

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={t('common.language')}
        aria-label={t('common.language')}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-7 items-center gap-1 rounded-full border border-gray-700 px-2 text-xs text-gray-300 hover:bg-gray-800"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5 shrink-0">
          <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm5.78 6h-2.9a12.6 12.6 0 0 0-1.2-4.06A6.03 6.03 0 0 1 13.78 6ZM8 1.53c.72 1.02 1.3 2.4 1.62 4.47H6.38C6.7 3.93 7.28 2.55 8 1.53ZM5.32 1.94A12.6 12.6 0 0 0 4.12 6h-2.9a6.03 6.03 0 0 1 4.1-4.06ZM1.22 8c0 .5.06 1 .18 1.47h2.9a13.6 13.6 0 0 0 0 2.94h-2.9A6.4 6.4 0 0 1 1.22 8Zm2.9 4.42a6.03 6.03 0 0 1 4.1-4.06 12.6 12.6 0 0 0 1.2 4.06H4.12ZM8 14.47c-.72-1.02-1.3-2.4-1.62-4.05h3.24c-.32 1.65-.9 3.03-1.62 4.05Zm2.3-1.47a12.6 12.6 0 0 0 1.2-4.06h2.9a6.03 6.03 0 0 1-4.1 4.06Zm1.58-5.53a13.6 13.6 0 0 0 0-2.94h2.9c.12.47.18.96.18 1.47s-.06 1-.18 1.47h-2.9Z" />
        </svg>
        <span className="max-w-[5.5rem] truncate">{current.label}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-50 max-h-[70vh] w-40 overflow-auto rounded-xl border border-gray-700 bg-gray-900 p-1 text-xs text-gray-300 shadow-xl"
        >
          {LANG_OPTIONS.map((o) => (
            <button
              key={o.code}
              role="menuitem"
              onMouseEnter={() => preloadLang(o.code)}
              onClick={() => {
                setLang(o.code)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left hover:bg-gray-800"
            >
              <span className="truncate">{o.label}</span>
              {o.code === lang && (
                <span aria-hidden="true" className="text-indigo-300">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
