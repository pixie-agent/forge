import { useTheme } from '../lib/theme'
import { useT } from '../lib/i18n'

/** 亮色/暗色主题切换按钮(持久化到 localStorage) */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const t = useT()
  const light = theme === 'light'
  return (
    <button
      onClick={toggle}
      title={light ? t('theme.toDark') : t('theme.toLight')}
      aria-label={t('theme.toggle')}
      className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-700 text-sm text-gray-300 hover:bg-gray-800"
    >
      {light ? '☀' : '☾'}
    </button>
  )
}