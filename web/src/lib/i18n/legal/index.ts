import type { Lang } from '../langs'
import { zh } from './zh'
import { en } from './en'

/**
 * 法务文档(隐私政策 / 服务条款 / 可接受使用政策)的词条集合。
 *
 * **为什么不放在 UI 词典里**:UI 文案跟着功能迭代,法务文本跟着法律走 —— 两套
 * 生命周期。翻译 UI 可以跟着版本走,翻译法务文本需要法务审阅(尤其是 Creem
 * 账户复审明确要求的「色情 / 成人 / NSFW 内容禁止」条款,不能走机翻)。
 *
 * 因此这里只保留**已审阅**的语言,其余语言回落到英文并在前端显示提示条
 * (`legal.fallbackNotice`)。新增已审阅语言 = 在 `legal/` 下加一份同构对象。
 */
export type LegalKey = keyof typeof zh

export const legalZh = zh
export const legalEn = en

const TABLES: Partial<Record<Lang, Record<LegalKey, string>>> = {
  zh: zh as Record<LegalKey, string>,
  en: en as Record<LegalKey, string>,
}

export interface LegalDoc {
  doc: Record<LegalKey, string>
  /** 文档是否已翻译成当前界面语言;false 表示展示的是英文原文 */
  translated: boolean
}

/** 取当前界面语言对应的法务文档;没有译本时回落到英文。 */
export function legalDoc(lang: Lang): LegalDoc {
  const table = TABLES[lang]
  if (table) return { doc: table, translated: true }
  return { doc: TABLES.en as Record<LegalKey, string>, translated: false }
}
