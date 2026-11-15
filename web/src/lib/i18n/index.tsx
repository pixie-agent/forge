import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DictKey } from './dict.zh'
import { SERVER_MESSAGES } from './serverMessages'
import { htmlLang, isLang, LANG_OPTIONS, LANGS, parseLang, type Lang } from './langs'

export type { DictKey, Lang }
export { LANG_OPTIONS, LANGS, isLang, parseLang, htmlLang }

type Dict = Record<DictKey, string>

/**
 * 每种语言一个独立 chunk。
 *
 * 11 份词典全量打进主包会让首屏 JS 体积翻倍(每份 ~10 KB gzip),而语言切换是
 * 低频操作 —— 所以按需加载:首屏只下载当前语言,切换时再拉对应 chunk。
 */
const LOADERS: Record<Lang, () => Promise<Dict>> = {
  zh: () => import('./dict.zh').then((m) => m.zh),
  en: () => import('./dict.en').then((m) => m.en),
  ja: () => import('./dict.ja').then((m) => m.ja),
  ko: () => import('./dict.ko').then((m) => m.ko),
  ru: () => import('./dict.ru').then((m) => m.ru),
  es: () => import('./dict.es').then((m) => m.es),
  fr: () => import('./dict.fr').then((m) => m.fr),
  de: () => import('./dict.de').then((m) => m.de),
  it: () => import('./dict.it').then((m) => m.it),
  pt: () => import('./dict.pt').then((m) => m.pt),
  nl: () => import('./dict.nl').then((m) => m.nl),
}

const STORAGE_KEY = 'forge-lang'
const cache = new Map<Lang, Dict>()

/** 加载并缓存某门语言的词典。 */
export async function loadLang(lang: Lang): Promise<Dict> {
  const hit = cache.get(lang)
  if (hit) return hit
  const dict = await LOADERS[lang]()
  cache.set(lang, dict)
  return dict
}

/** 预取词典(悬停语言列表时调用,让点击时几乎无延迟)。 */
export function preloadLang(lang: Lang): void {
  if (!cache.has(lang)) void loadLang(lang).catch(() => {})
}

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLang(saved)) return saved
  } catch {
    // localStorage 不可用(隐私模式 / SSR)时忽略
  }
  try {
    const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : ''
    const base = nav.split('-')[0]
    if (isLang(base)) return base
  } catch {
    // navigator 不可用时忽略
  }
  return 'en'
}

export function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole))
}

export interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: DictKey, vars?: Record<string, string | number>) => string
  tServer: (message: string) => string
}

const I18nCtx = createContext<I18n | null>(null)

/**
 * 模块级当前语言:供 React 之外的代码取词(`lib/api.ts`、`lib/attachments.ts`)。
 * 这些地方不在 React 树里,拿不到 context,只能读模块状态。
 */
let activeLang: Lang = 'en'
export function setActiveLang(lang: Lang): void {
  activeLang = lang
}
export function getActiveLang(): Lang {
  return activeLang
}

export function tStatic(key: DictKey, vars?: Record<string, string | number>): string {
  const dict = cache.get(activeLang)
  const text = dict?.[key] ?? cache.get('en')?.[key] ?? key
  return interpolate(text, vars)
}

export function translateServer(message: string): string {
  const key = SERVER_MESSAGES[message]
  return key ? tStatic(key) : message
}

export function useI18n(): I18n {
  const ctx = useContext(I18nCtx)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}

export function useT(): I18n['t'] {
  return useI18n().t
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang)
  const [dict, setDict] = useState<Dict | null>(null)

  // 切换语言时保留上一次的词典继续渲染,新词典到位后再替换 —— 避免整页闪白。
  useEffect(() => {
    let alive = true
    loadLang(lang)
      .then((d) => {
        if (alive) setDict(d)
      })
      .catch(() => {
        // 目标语言的 chunk 拉取失败(网络抖动 / CDN 故障)→ 回落英文。
        // 宁可界面语言不是用户选的那个,也不能白屏 —— 首屏渲染完全依赖这份词典。
        // 只改内存状态,不写 localStorage:刷新后网络正常的话仍回到用户选的语言。
        loadLang('en')
          .then((d) => {
            if (alive) {
              setDict(d)
              setLangState('en')
            }
          })
          .catch(() => {
            // 两个 chunk 都拉不到:保持现状,不再往下退
          })
      })
    return () => {
      alive = false
    }
  }, [lang])

  useEffect(() => {
    document.documentElement.lang = htmlLang(lang)
    setActiveLang(lang)
  }, [lang])

  // 词典到位后同步浏览器标签标题(index.html 里写死的是中文,只作首屏与 SEO 兜底)
  useEffect(() => {
    if (!dict) return
    document.title = dict['app.title']
  }, [dict])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // localStorage 不可用时忽略:本次会话内依然生效
    }
  }, [])

  const value = useMemo<I18n>(() => {
    // 词典缺键时回落到英文,再回落到键名(类型已保证不缺,这里是兜底)
    const t: I18n['t'] = (key, vars) => interpolate(dict?.[key] ?? cache.get('en')?.[key] ?? key, vars)
    return {
      lang,
      setLang,
      t,
      tServer: (message) => {
        const key = SERVER_MESSAGES[message]
        return key ? t(key) : message
      },
    }
  }, [lang, setLang, dict])

  // 首屏:词典是异步 chunk,到位前不渲染子树(否则会先用错误语言闪一下)。
  if (!dict) return null

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}
