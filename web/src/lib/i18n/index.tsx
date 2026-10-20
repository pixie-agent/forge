import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { zh, type DictKey } from './dict.zh'
import { en } from './dict.en'
import { SERVER_MESSAGES } from './serverMessages'

/**
 * 极简 i18n:**不引第三方库**,只做三件事 —— 中/英两份同构字典、一个 React context、一个 t()。
 *
 * 加一门语言 = 新增一份 `Record<DictKey, string>` 字典 + 在 DICTS/LANG_OPTIONS 里各加一行,
 * **组件一行都不用改**(键名才是契约)。
 *
 * 刻意不做的事:复数规则、日期/数字本地化(时间格式化在 lib/format.ts,本身就是数字型格式)、
 * 服务端渲染 —— 目前都不需要,加进来只会让这份文件变复杂。
 */
export type Lang = 'zh' | 'en'

/** 词条键(来自基准字典)。组件里做「值 → 键」映射时可用它约束类型 */
export type { DictKey } from './dict.zh'

export const DICTS: Record<Lang, Record<DictKey, string>> = { zh, en }

/** 语言切换器的选项(新增语言只改这里) */
export const LANG_OPTIONS: { code: Lang; label: string }[] = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
]

const STORAGE_KEY = 'forge-lang'

/**
 * 首次访问的默认语言:浏览器语言是中文就中文,否则英文。
 * 产品面向海外,所以「非中文一律英文」比「非英文一律中文」更合理(法语用户看到英文好过看到中文)。
 */
function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    // 隐私模式等场景读不到 localStorage:走下面的浏览器语言判断
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** `{name}` 占位符替换;缺参时原样保留占位符,方便一眼看出漏传 */
function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole))
}

export interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  /** 取词条。传未知键时原样返回键名(开发期一眼可见),不抛错、不空白 */
  t: (key: DictKey, vars?: Record<string, string | number>) => string
  /** 把服务端返回的中文文案翻成当前语言;无映射时原样返回 */
  tServer: (message: string) => string
}

const I18nCtx = createContext<I18n>({
  lang: 'zh',
  setLang: () => {},
  t: (key) => zh[key] ?? key,
  tServer: (message) => message,
})

export function useI18n(): I18n {
  return useContext(I18nCtx)
}

/** 组件里最常用的一层糖:const t = useT() */
export function useT(): I18n['t'] {
  return useContext(I18nCtx).t
}

/**
 * React 之外(如 lib/api.ts 里的 fetch 封装)没有 context,这里留一份「当前语言」的模块级副本,
 * 由 Provider 在 effect 里同步。只为这两处非组件代码服务,组件一律用 useI18n()/useT()。
 */
let activeLang: Lang = 'zh'
export function setActiveLang(lang: Lang): void {
  activeLang = lang
}

/**
 * 当前语言的读取口(非组件环境用)。服务端有少量文案(附件/连接器清单、任务收尾的 assistant 消息)
 * 需要**在写库时就定下语言**,请求体里带上它;回调时刻(commit/cancel)才能按用户当时的语言渲染。
 */
export function getActiveLang(): Lang {
  return activeLang
}

/** 非组件环境下的取词条 */
export function tStatic(key: DictKey, vars?: Record<string, string | number>): string {
  return interpolate(DICTS[activeLang][key] ?? zh[key] ?? key, vars)
}

/** 非组件环境下的服务端文案翻译 */
export function translateServer(message: string): string {
  const key = SERVER_MESSAGES[message]
  return key ? tStatic(key) : message
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang)

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 存不进就只在本次会话生效
    }
  }, [])

  // 同步 <html lang>:影响屏幕阅读器与浏览器翻译提示,不发请求
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    setActiveLang(lang)
  }, [lang])

  const value = useMemo<I18n>(() => {
    const dict = DICTS[lang]
    const t: I18n['t'] = (key, vars) => interpolate(dict[key] ?? zh[key] ?? key, vars)
    return {
      lang,
      setLang,
      t,
      tServer: (message) => {
        const key = SERVER_MESSAGES[message]
        return key ? t(key) : message
      },
    }
  }, [lang, setLang])

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}
