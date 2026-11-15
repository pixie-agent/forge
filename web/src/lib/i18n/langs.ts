/**
 * 平台界面语言清单。
 *
 * **与产物语言集合保持一致**:agent 侧 `OutputLang`(产物文案语言)与这里的界面语言
 * 是同一组语言代码,这样「界面语言 = 产物语言」的默认值链路不需要任何映射表。
 * 新增一门语言 = 在这里加一个代码 + 在 `dict.<code>.ts` 补一份同构词典。
 */
export const LANGS = ['zh', 'en', 'ja', 'ko', 'ru', 'es', 'fr', 'de', 'it', 'pt', 'nl'] as const

export type Lang = (typeof LANGS)[number]

export interface LangOption {
  code: Lang
  /** 语言名用母语写法(用户在语言列表里找的是「日本語」,不是「Japanese」) */
  label: string
  /** 写进 `<html lang>` 的 BCP-47 标签 */
  htmlLang: string
}

export const LANG_OPTIONS: LangOption[] = [
  { code: 'zh', label: '中文', htmlLang: 'zh-CN' },
  { code: 'en', label: 'English', htmlLang: 'en' },
  { code: 'ja', label: '日本語', htmlLang: 'ja' },
  { code: 'ko', label: '한국어', htmlLang: 'ko' },
  { code: 'ru', label: 'Русский', htmlLang: 'ru' },
  { code: 'es', label: 'Español', htmlLang: 'es' },
  { code: 'fr', label: 'Français', htmlLang: 'fr' },
  { code: 'de', label: 'Deutsch', htmlLang: 'de' },
  { code: 'it', label: 'Italiano', htmlLang: 'it' },
  { code: 'pt', label: 'Português', htmlLang: 'pt' },
  { code: 'nl', label: 'Nederlands', htmlLang: 'nl' },
]

const HTML_LANG: Record<Lang, string> = LANG_OPTIONS.reduce(
  (acc, o) => {
    acc[o.code] = o.htmlLang
    return acc
  },
  {} as Record<Lang, string>,
)

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value)
}

/** 把任意输入收敛成合法语言代码;非法值回落到 fallback。 */
export function parseLang(value: unknown, fallback: Lang = 'en'): Lang {
  return isLang(value) ? value : fallback
}

/** `<html lang>` 用的 BCP-47 标签。 */
export function htmlLang(lang: Lang): string {
  return HTML_LANG[lang] ?? 'en'
}
