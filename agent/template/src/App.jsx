/**
 * 示例应用(留言墙):展示本模板的做法与质量基线,生成新应用时按需求重写本文件。
 *
 * 这个示例用了:导航 / Hero / 统计卡 / 表单提交落库 / 列表与统计联动 / 空态与骨架 /
 * 删除二次确认 / 进场动效 / 页脚 —— 新应用按自己的领域内容替换即可,结构可以照搬。
 * 只允许改 src/ 下的文件;src/components/ui/** 与 src/lib/** 是平台提供的,不要改。
 */
import { useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Container,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  Section,
  SectionTitle,
  SkeletonCard,
  Stat,
  StatGrid,
  Stagger,
  StaggerItem,
  Textarea,
  ToastProvider,
  useToast,
} from './components/ui/index.js'
import { useCollection } from './lib/store.js'

const NAV = [
  { href: '#top', label: '首页' },
  { href: '#board', label: '留言墙' },
  { href: '#about', label: '关于' },
]

function NavBar() {
  const [open, setOpen] = useState(false)
  return (
    <header className="glass sticky top-0 z-40 border-b border-line">
      <Container className="flex h-16 items-center justify-between">
        <a href="#top" className="flex items-center gap-2 text-[17px] font-semibold text-ink">
          <span className="flex h-8 w-8 items-center justify-center rounded-field bg-brand text-white">
            <Icon name="Megaphone" size={17} />
          </span>
          留言墙
        </a>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="rounded-field px-3.5 py-2 text-[15px] text-muted transition-colors duration-200 ease-soft hover:bg-panel-2 hover:text-ink"
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="hidden md:block">
          <Button size="sm" icon={<Icon name="PenLine" size={15} />} onClick={() => document.getElementById('form')?.scrollIntoView()}>
            写留言
          </Button>
        </div>
        <button
          type="button"
          aria-label="打开菜单"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="rounded-field p-2 text-ink transition-colors hover:bg-panel-2 md:hidden"
        >
          <Icon name={open ? 'X' : 'Menu'} />
        </button>
      </Container>
      {open ? (
        <nav className="border-t border-line bg-panel px-5 py-3 md:hidden">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className="block rounded-field px-3 py-2.5 text-[15px] text-muted hover:bg-panel-2 hover:text-ink"
            >
              {n.label}
            </a>
          ))}
        </nav>
      ) : null}
    </header>
  )
}

function Hero({ count }) {
  return (
    <section id="top" className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, var(--brand), transparent 70%)' }}
      />
      <Container className="relative py-20 text-center md:py-28">
        <Badge tone="brand" icon="Sparkles">
          已收到 {count} 条留言
        </Badge>
        <h1 className="display-1 anim-fade-up mx-auto mt-6 max-w-3xl text-ink">把想说的话,留在这里</h1>
        <p className="anim-fade-up mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-muted md:text-[19px]">
          无需注册,写下来就会立刻出现在留言墙上,所有人可见。你的每一句都会被认真对待。
        </p>
        <div className="anim-fade-up mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" onClick={() => document.getElementById('form')?.scrollIntoView()}>
            写一条留言
          </Button>
          <Button size="lg" variant="secondary" onClick={() => document.getElementById('board')?.scrollIntoView()}>
            看看大家说了什么
          </Button>
        </div>
      </Container>
    </section>
  )
}

function Board() {
  const toast = useToast()
  const { items, total, loading, error, reload, add, remove, hasMore, loadMore, loadingMore } = useCollection('messages', {
    pageSize: 12,
  })
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)

  const latest = useMemo(() => items.filter((m) => m.text), [items])

  async function submit(e) {
    e.preventDefault()
    if (!text.trim()) {
      setFormError('说点什么吧,内容不能为空')
      return
    }
    setFormError('')
    setSubmitting(true)
    try {
      await add({ name: name.trim() || '匿名访客', text: text.trim(), created_at: new Date().toISOString() })
      setName('')
      setText('')
      toast.success('留言已发布')
    } catch (err) {
      setFormError(err?.message || '发布失败,请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Section id="board" tinted>
      <SectionTitle
        eyebrow="留言墙"
        title="大家留下的声音"
        description="列表与上方统计来自同一份数据,发布或删除后会自动一起更新。"
      />

      <StatGrid cols={3} className="mt-10">
        <Stat label="留言总数" value={total} icon="MessageSquare" hint="来自服务端的真实计数" />
        <Stat label="当前页展示" value={latest.length} icon="List" />
        <Stat label="参与人数" value={new Set(latest.map((m) => m.name)).size} icon="Users" />
      </StatGrid>

      <div id="form" className="mt-12 grid gap-8 lg:grid-cols-[1fr_1.15fr]">
        <Card padding="lg" className="h-fit lg:sticky lg:top-24">
          <h3 className="text-[19px] font-semibold text-ink">写下你的留言</h3>
          <p className="mt-1.5 text-sm text-muted">提交后会真实保存,刷新页面依然在。</p>
          <form className="mt-6 space-y-5" onSubmit={submit}>
            <Input label="称呼" placeholder="留空则显示为匿名访客" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
            <Textarea
              label="内容"
              required
              rows={5}
              placeholder="想说的话…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              error={formError}
              maxLength={300}
              hint={`${text.length}/300`}
            />
            <Button type="submit" full loading={submitting} icon={<Icon name="Send" size={16} />}>
              {submitting ? '发布中…' : '发布留言'}
            </Button>
          </form>
        </Card>

        <div>
          {loading ? (
            <div className="space-y-4">
              <SkeletonCard lines={2} />
              <SkeletonCard lines={2} />
            </div>
          ) : error ? (
            <ErrorState description={error} onRetry={reload} />
          ) : latest.length === 0 ? (
            <EmptyState
              icon="MessageSquare"
              title="还没有人留言"
              description="成为第一个在这里留下声音的人吧。"
              action={<Button onClick={() => document.getElementById('form')?.scrollIntoView()}>写第一条</Button>}
            />
          ) : (
            <>
              <Stagger className="space-y-4">
                {latest.map((m) => (
                  <StaggerItem key={m.id}>
                    <Card hover className="group">
                      <div className="flex items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-brand-soft text-[15px] font-semibold text-brand">
                          {String(m.name || '访客').slice(0, 1)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-[15px] font-medium text-ink">{m.name || '匿名访客'}</p>
                            <span className="text-[13px] text-muted">刚刚</span>
                          </div>
                          <p className="mt-1.5 leading-relaxed break-words text-[15px] text-ink/90">{m.text}</p>
                        </div>
                        <button
                          type="button"
                          aria-label="删除留言"
                          onClick={() => setPendingDelete(m)}
                          className="rounded-field p-2 text-muted opacity-0 transition-opacity duration-200 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
                        >
                          <Icon name="Trash2" size={16} />
                        </button>
                      </div>
                    </Card>
                  </StaggerItem>
                ))}
              </Stagger>
              {hasMore ? (
                <div className="mt-6 flex justify-center">
                  <Button variant="secondary" loading={loadingMore} onClick={loadMore}>
                    加载更多
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除这条留言?"
        description={pendingDelete?.text?.slice(0, 40)}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          try {
            await remove(pendingDelete.id)
            toast.success('已删除')
          } catch {
            toast.error('删除失败,请重试')
          }
        }}
      />
    </Section>
  )
}

function About() {
  const points = [
    { icon: 'Database', title: '数据真实保存', text: '留言写入项目自己的数据库,刷新、换设备都还在。' },
    { icon: 'Zap', title: '即时反馈', text: '提交、删除、加载都有明确状态,不会出现卡住不动。' },
    { icon: 'ShieldCheck', title: '不收集隐私', text: '只保存你主动填写的内容,不需要账号与密码。' },
  ]
  return (
    <Section id="about">
      <SectionTitle align="center" eyebrow="关于" title="一个简单、可靠的留言墙" description="下面这些约定,每个由 Forge 生成的应用都会遵守。" />
      <Stagger className="mt-12 grid gap-6 md:grid-cols-3">
        {points.map((p) => (
          <StaggerItem key={p.title}>
            <Card hover className="h-full">
              <span className="flex h-11 w-11 items-center justify-center rounded-card bg-brand-soft text-brand">
                <Icon name={p.icon} size={20} />
              </span>
              <h3 className="mt-4 text-[17px] font-semibold text-ink">{p.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{p.text}</p>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>
    </Section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-line py-10">
      <Container className="flex flex-col items-center justify-between gap-4 text-sm text-muted md:flex-row">
        <p>© {new Date().getFullYear()} 留言墙 · 由 Forge 生成</p>
        <div className="flex items-center gap-4">
          <a href="#board" className="transition-colors hover:text-ink">
            留言墙
          </a>
          <a href="#about" className="transition-colors hover:text-ink">
            关于
          </a>
        </div>
      </Container>
    </footer>
  )
}

function Page() {
  // 顶部导航与 Hero 的计数与列表共用一份数据源(这里只取总数用于展示)
  const { total } = useCollection('messages', { pageSize: 1 })
  return (
    <div className="min-h-dvh bg-canvas">
      <NavBar />
      <main>
        <Hero count={total} />
        <Board />
        <About />
      </main>
      <Footer />
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <Page />
    </ToastProvider>
  )
}
