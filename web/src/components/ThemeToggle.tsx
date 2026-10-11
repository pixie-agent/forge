import { useTheme } from '../lib/theme'

/** 亮色/暗色主题切换按钮(持久化到 localStorage) */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const light = theme === 'light'
  return (
    <button
      onClick={toggle}
      title={light ? '切换到暗色主题' : '切换到亮色主题'}
      aria-label="切换主题"
      className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-700 text-sm text-gray-300 hover:bg-gray-800"
    >
      {light ? '☀' : '☾'}
    </button>
  )
}