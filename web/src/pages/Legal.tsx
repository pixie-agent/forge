import { Link } from 'react-router-dom'
import PublicFooter from '../components/PublicFooter'
import PublicHeader from '../components/PublicHeader'
import { interpolate, useI18n, useT, type DictKey } from '../lib/i18n'
import { legalDoc, type LegalKey } from '../lib/i18n/legal'
import { BUSINESS_NAME, LEGAL_ENTITY, OPERATOR_COUNTRY, SITE_URL, SUPPORT_EMAIL } from '../lib/site'

/**
 * 法务页面:隐私政策 / 服务条款 / 可接受使用政策。
 *
 * 三份文档结构一致(标题 + 若干节),正文全部来自 i18n 词典,所以切换语言不需要改组件。
 * 服务条款与 AUP 里必须保留「色情 / 成人 / NSFW 内容明确禁止」条款 —— 这是 Creem 复审的硬性要求。
 *
 * 法务正文与 UI 文案分开存放(`lib/i18n/legal/`):法务文本只维护已审阅的语言,
 * 没有译本时展示英文原文并在页首提示 —— 宁可让用户读到英文原文,也不要给一份
 * 没经审阅的机器翻译当法律条款。
 */
export type LegalDoc = 'privacy' | 'terms' | 'acceptable'

interface Section {
  title: LegalKey
  body: LegalKey
}

const DOCS: Record<LegalDoc, { title: DictKey; intro: LegalKey; sections: Section[] }> = {
  privacy: {
    title: 'footer.privacy',
    intro: 'legal.privacy.intro',
    sections: [
      { title: 'legal.privacy.s1.title', body: 'legal.privacy.s1.body' },
      { title: 'legal.privacy.s2.title', body: 'legal.privacy.s2.body' },
      { title: 'legal.privacy.s3.title', body: 'legal.privacy.s3.body' },
      { title: 'legal.privacy.s4.title', body: 'legal.privacy.s4.body' },
      { title: 'legal.privacy.s5.title', body: 'legal.privacy.s5.body' },
      { title: 'legal.privacy.s6.title', body: 'legal.privacy.s6.body' },
      { title: 'legal.privacy.s7.title', body: 'legal.privacy.s7.body' },
      { title: 'legal.privacy.s8.title', body: 'legal.privacy.s8.body' },
      { title: 'legal.privacy.s9.title', body: 'legal.privacy.s9.body' },
      { title: 'legal.privacy.s10.title', body: 'legal.privacy.s10.body' },
    ],
  },
  terms: {
    title: 'footer.terms',
    intro: 'legal.terms.intro',
    sections: [
      { title: 'legal.terms.s1.title', body: 'legal.terms.s1.body' },
      { title: 'legal.terms.s2.title', body: 'legal.terms.s2.body' },
      { title: 'legal.terms.s3.title', body: 'legal.terms.s3.body' },
      { title: 'legal.terms.s4.title', body: 'legal.terms.s4.body' },
      { title: 'legal.terms.s5.title', body: 'legal.terms.s5.body' },
      { title: 'legal.terms.s6.title', body: 'legal.terms.s6.body' },
      { title: 'legal.terms.s7.title', body: 'legal.terms.s7.body' },
      { title: 'legal.terms.s8.title', body: 'legal.terms.s8.body' },
      { title: 'legal.terms.s9.title', body: 'legal.terms.s9.body' },
      { title: 'legal.terms.s10.title', body: 'legal.terms.s10.body' },
      { title: 'legal.terms.s11.title', body: 'legal.terms.s11.body' },
      { title: 'legal.terms.s12.title', body: 'legal.terms.s12.body' },
      { title: 'legal.terms.s13.title', body: 'legal.terms.s13.body' },
      { title: 'legal.terms.s14.title', body: 'legal.terms.s14.body' },
      { title: 'legal.terms.s15.title', body: 'legal.terms.s15.body' },
    ],
  },
  acceptable: {
    title: 'footer.acceptableUse',
    intro: 'legal.aup.intro',
    sections: [
      { title: 'legal.aup.s1.title', body: 'legal.aup.s1.body' },
      { title: 'legal.aup.s2.title', body: 'legal.aup.s2.body' },
      { title: 'legal.aup.s3.title', body: 'legal.aup.s3.body' },
      { title: 'legal.aup.s4.title', body: 'legal.aup.s4.body' },
      { title: 'legal.aup.s5.title', body: 'legal.aup.s5.body' },
      { title: 'legal.aup.s6.title', body: 'legal.aup.s6.body' },
      { title: 'legal.aup.s7.title', body: 'legal.aup.s7.body' },
    ],
  },
}

export default function Legal({ doc }: { doc: LegalDoc }) {
  const t = useT()
  const { lang } = useI18n()
  const current = DOCS[doc]
  const { doc: text, translated } = legalDoc(lang)
  const vars = {
    email: SUPPORT_EMAIL,
    url: SITE_URL,
    year: new Date().getFullYear(),
    entity: LEGAL_ENTITY,
    business: BUSINESS_NAME,
    country: OPERATOR_COUNTRY,
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <PublicHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <Link to="/" className="text-xs text-gray-500 hover:text-gray-300">
          ← {t('legal.backHome')}
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">{t(current.title)}</h1>
        <p className="mt-1 text-xs text-gray-500">{t('legal.lastUpdated')}</p>
        <p className="mt-2 text-xs text-gray-400">{t('legal.operator', vars)}</p>
        {!translated && (
          <p className="mt-4 rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
            {t('legal.fallbackNotice')}
          </p>
        )}
        <p className="mt-6 whitespace-pre-line text-sm leading-relaxed text-gray-300">
          {interpolate(text[current.intro], vars)}
        </p>

        {current.sections.map((section) => (
          <section key={section.title} className="mt-8">
            <h2 className="text-base font-semibold text-gray-100">{text[section.title]}</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-300">
              {interpolate(text[section.body], vars)}
            </p>
          </section>
        ))}

        <p className="mt-10 text-sm text-gray-400">{t('legal.contact', vars)}</p>
      </main>
      <PublicFooter />
    </div>
  )
}
