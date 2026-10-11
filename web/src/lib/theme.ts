import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'forge-theme'

/** 读取当前生效的主题:html[data-theme="light"] 即亮色,否则暗色 */
function readTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

/**
 * 主题切换:通过 html[data-theme] 驱动 index.css 里的颜色变量覆盖。
 * 默认暗色;选择持久化到 localStorage,首屏由 index.html 的内联脚本提前应用(防闪烁)。
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => readTheme())

  const setTheme = useCallback((next: Theme) => {
    if (next === 'light') document.documentElement.dataset.theme = 'light'
    else delete document.documentElement.dataset.theme
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // localStorage 不可用(隐私模式等)时忽略,仅本次会话生效
    }
    setThemeState(next)
  }, [])

  const toggle = useCallback(() => setTheme(readTheme() === 'light' ? 'dark' : 'light'), [setTheme])

  // 跨标签页同步
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setThemeState(readTheme())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return { theme, setTheme, toggle }
}