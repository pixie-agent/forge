import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import { api } from '../lib/api'
import { JOB_COST, SIGNUP_CREDITS } from '../lib/billing'
import { useT } from '../lib/i18n'
import type { DictKey } from '../lib/i18n/dict.zh'
import type { ShowcaseItem } from '../lib/types'
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
  const [showcase, setShowcase] = useState<ShowcaseItem[]>([])
  const [cloningId, setCloningId] = useState('')
  const nav = useNavigate()
  const { user } = useAuth()
  const t = useT()

  // 精选案例是运营在后台勾选的,为空时整块不渲染(不占首页空间)
  useEffect(() => {
    api<{ projects: ShowcaseItem[] }>('/api/showcase')
      .then((d) => setShowcase(d.projects ?? []))
      .catch(() => setShowcase([]))
  }, [])

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

  /**
   * 克隆精选案例:服务端把线上版本的源码与构建产物复制到新项目的草稿,不扣积分。
   * 未登录时把案例 id 带到登录页,登录成功后自动续跑(见 Login.tsx)。
   */
  async function clone(item: ShowcaseItem) {
    if (cloningId) return
    setCloningId(item.id)
    try {
      const { id } = await api<{ id: string }>(`/api/showcase/${item.id}/clone`, { method: 'POST' })
      nav(`/workspace/${id}`)
    } catch (err) {
      const e = err as Error & { status?: number }
      if (e.status === 401) nav(`/login?clone=${item.id}`)
      else alert(e.message)
    } finally {
      setCloningId('')
    }
  }


  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <PublicHeader />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-12 pt-8 text-center sm:pb-20 sm:pt-20">
        {/* Atelier:标题上方一道短金线,serif 大标题 + 金色斜体高亮 */}
        <div className="mx-auto mb-7 h-0.5 w-11 bg-indigo-600" aria-hidden="true" />
        <h1 className="font-serif text-4xl font-medium leading-[1.12] tracking-[-0.01em] sm:text-6xl">
          {t('landing.heroPrefix')}
          {/* 词与词之间的空格由词典决定:中日文不需要,拉丁/西里尔/谚文需要 */}
          {t('landing.heroSep')}
          <em className="italic text-indigo-300">{t('landing.heroHighlight')}</em>
        </h1>
        <p className="mx-auto mt-5 max-w-xl leading-relaxed text-gray-400">{t('landing.subtitle')}</p>

        <div className="mt-10 rounded-lg border border-gray-800 bg-gray-900 p-4 text-left shadow-sm transition-colors focus-within:border-indigo-500">
          <textarea
            className="min-h-[120px] w-full resize-none bg-transparent px-2 py-1 text-base outline-none placeholder:text-gray-600"
            placeholder={t('landing.placeholder')}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start()
            }}
          />
          <div className="flex flex-col gap-2 border-t border-gray-800 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-gray-500">
              {t('landing.creditHint', { cost: JOB_COST, signup: SIGNUP_CREDITS })}
            </span>
            <button
              onClick={() => start()}
              disabled={busy || !idea.trim()}
              className="w-full rounded-md bg-indigo-600 px-6 py-2.5 text-sm font-medium tracking-[0.04em] text-white transition-colors hover:bg-indigo-500 disabled:opacity-40 sm:w-auto sm:py-2"
            >
              {busy ? t('landing.creating') : t('landing.start')}
            </button>
          </div>
        </div>

        {/* 手机上横向滑动一行展示示例,避免 6 个胶囊堆成三行把首屏拉长 */}
        <div className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:mt-6 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0">
          {EXAMPLE_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => {
                const value = t(key)
                setIdea(value)
                start(value)
              }}
              className="shrink-0 whitespace-nowrap rounded-sm px-0.5 pb-0.5 text-xs text-gray-400 underline decoration-gray-600 underline-offset-4 transition-colors hover:text-indigo-300 hover:decoration-indigo-500 sm:px-1"
            >
              {t(key)}
            </button>
          ))}
        </div>

        {/* 精选案例:后台勾选 + 打标签后才出现;未登录点克隆会带上案例 id 去登录 */}
        {showcase.length > 0 && (
          <section className="mt-12 border-t border-gray-800 pt-10 sm:mt-16 sm:pt-12">
            <h2 className="font-serif text-xl font-medium sm:text-2xl">{t('landing.showcaseTitle')}</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-gray-400">{t('landing.showcaseSubtitle')}</p>
            <div className="mt-5 grid gap-3 text-left sm:mt-6 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {showcase.map((item) => (
                <article
                  key={item.id}
                  className="group overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50 transition hover:border-gray-700"
                >
                  {/*
                    封面是线上站点的实时预览:iframe 以 400% 尺寸挂载再缩到 1/4,
                    等价于 1200px 宽的桌面视口截图,内容随站点更新,无需截图服务。
                    loading="lazy":滚到附近才加载,首屏不多拉十几个生成应用的资源。
                    站点本身由服务端 CSP sandbox(opaque origin)下发,嵌入不会拿到本页 origin。
                  */}
                  <a
                    href={`/s/${item.slug}/`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={item.name || t('projects.untitled')}
                    className="relative block aspect-[16/10] overflow-hidden bg-gray-950"
                  >
                    <iframe
                      src={`/s/${item.slug}/`}
                      title=""
                      aria-hidden="true"
                      tabIndex={-1}
                      loading="lazy"
                      scrolling="no"
                      className="pointer-events-none absolute left-0 top-0 h-[400%] w-[400%] origin-top-left scale-[0.25] border-0"
                    />
                  </a>
                  <div className="flex items-start gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-medium text-gray-100">
                        {item.name || t('projects.untitled')}
                      </h3>
                      <p className="mt-0.5 truncate text-xs text-gray-500">
                        {item.tags.length > 0 ? item.tags.join(' · ') : item.description}
                      </p>
                    </div>
                    <button
                      onClick={() => clone(item)}
                      disabled={cloningId === item.id}
                      className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-indigo-400 hover:bg-indigo-500/10 hover:text-indigo-300 disabled:opacity-50"
                    >
                      {cloningId === item.id ? t('landing.showcaseCloning') : t('landing.showcaseClone')}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* 公开价格:Creem 复审要求注册前就能看到充值包与订阅的价格 */}
        <section className="mt-12 border-t border-gray-800 pt-10 sm:mt-16 sm:pt-12">
          <h2 className="font-serif text-xl font-medium sm:text-2xl">{t('pricing.title')}</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-gray-400">{t('pricing.subtitle')}</p>
          <div className="mt-5 rounded-2xl border border-gray-800 bg-gray-900/40 p-4 text-left sm:mt-6 sm:p-6">
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
