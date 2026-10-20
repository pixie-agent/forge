import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import { api } from '../lib/api'
import { JOB_COST, SIGNUP_CREDITS } from '../lib/billing'
import { useT } from '../lib/i18n'
import type { DictKey } from '../lib/i18n/dict.zh'
import PublicFooter from '../components/PublicFooter'
import PublicHeader from '../components/PublicHeader'
import PricingSection from '../components/PricingSection'

/** 示例想法:只存词条键,渲染/点击时才取文本(切语言时按钮文字跟着变) */
const EXAMPLE_KEYS: DictKey[] = [
  'landing.example1',
  'landing.example2',
  'landing.example3',
  'landing.example4',
  'landing.example5',
  'landing.example6',
]

export default function Landing() {
  const [idea, setIdea] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const { user } = useAuth()
  const t = useT()

  async function start(text?: string) {
    const value = (text ?? idea).trim()
    if (!value || busy) return
    setBusy(true)
    try {
      const { id } = await api<{ id: string }>('/api/projects', { method: 'POST', body: { idea: value } })
      nav(`/workspace/${id}?idea=${encodeURIComponent(value)}`)
    } catch (err) {
      const e = err as Error & { status?: number }
      if (e.status === 401) nav(`/login?idea=${encodeURIComponent(value)}`)
      else alert(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <PublicHeader />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-10 text-center sm:pb-20 sm:pt-20">
        <h1 className="text-3xl font-bold leading-tight sm:text-5xl">
          {t('landing.heroPrefix')}
          <span className="bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-transparent">
            {t('landing.heroHighlight')}
          </span>
        </h1>
        <p className="mt-4 text-gray-400">{t('landing.subtitle')}</p>

        <div className="mt-10 rounded-2xl border border-gray-800 bg-gray-900 p-4 text-left shadow-xl">
          <textarea
            className="min-h-[120px] w-full resize-none bg-transparent px-2 py-1 text-base outline-none placeholder:text-gray-600"
            placeholder={t('landing.placeholder')}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start()
            }}
          />
          <div className="flex items-center justify-between border-t border-gray-800 pt-3">
            <span className="text-xs text-gray-500">
              {t('landing.creditHint', { cost: JOB_COST, signup: SIGNUP_CREDITS })}
            </span>
            <button
              onClick={() => start()}
              disabled={busy || !idea.trim()}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {busy ? t('landing.creating') : t('landing.start')}
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {EXAMPLE_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => {
                const value = t(key)
                setIdea(value)
                start(value)
              }}
              className="rounded-full border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:border-indigo-500 hover:text-indigo-300"
            >
              {t(key)}
            </button>
          ))}
        </div>

        {/* 公开价格:Creem 复审要求注册前就能看到充值包与订阅的价格 */}
        <section className="mt-16 border-t border-gray-800 pt-12">
          <h2 className="text-xl font-semibold sm:text-2xl">{t('pricing.title')}</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-gray-400">{t('pricing.subtitle')}</p>
          <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-900/40 p-5 text-left sm:p-6">
            <PricingSection />
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-sm">
            <Link
              to={user ? '/billing' : '/login'}
              className="rounded-xl bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-500"
            >
              {t('pricing.cta')}
            </Link>
            <Link to="/pricing" className="text-gray-400 hover:text-gray-200">
              {t('pricing.viewFull')}
            </Link>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  )
}
