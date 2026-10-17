import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar'
import { api } from '../lib/api'
import { formatTime } from '../lib/format'
import type { Project } from '../lib/types'

export default function Projects() {
  const [items, setItems] = useState<Project[] | null>(null)
  const [busyId, setBusyId] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const nav = useNavigate()

  useEffect(() => {
    api<{ projects: Project[] }>('/api/projects')
      .then((data) => setItems(data.projects))
      .catch(() => setItems([]))
  }, [])

  function patch(id: string, patch: Partial<Project>) {
    setItems((list) => (list ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  async function remove(id: string) {
    if (!confirm('删除后不可恢复,确定删除该项目?')) return
    await api(`/api/projects/${id}`, { method: 'DELETE' })
    setItems((list) => (list ?? []).filter((p) => p.id !== id))
  }

  async function unpublish(id: string) {
    if (!confirm('下线后公开链接会立即失效(404),版本与数据保留,可随时重新发布。确定下线?')) return
    setBusyId(id)
    try {
      await api(`/api/projects/${id}/unpublish`, { method: 'POST' })
      patch(id, { status: 'draft' })
    } finally {
      setBusyId('')
    }
  }

  async function publish(id: string) {
    setBusyId(id)
    try {
      await api(`/api/projects/${id}/publish`, { method: 'POST' })
      patch(id, { status: 'published' })
    } finally {
      setBusyId('')
    }
  }

  async function copyLink(p: Project) {
    try {
      await navigator.clipboard.writeText(`${location.origin}/s/${p.slug}`)
    } catch {
      // 剪贴板不可用时忽略
    }
    setCopiedId(p.id)
    setTimeout(() => setCopiedId(''), 1600)
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <TopBar />
      <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-6 sm:px-4 sm:py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">我的项目</h1>
          <button
            onClick={() => nav('/')}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            新建项目
          </button>
        </div>

        {items === null ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-800 py-20 text-center text-sm text-gray-500">
            还没有项目,去首页描述一个想法开始创建吧。
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <div key={p.id} className="flex flex-col rounded-2xl border border-gray-800 bg-gray-900 p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h2 className="line-clamp-1 font-medium">{p.name || '未命名项目'}</h2>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                      p.status === 'published' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-700/60 text-gray-400'
                    }`}
                  >
                    {p.status === 'published' ? '已发布' : '草稿'}
                  </span>
                </div>
                <p className="mb-4 line-clamp-2 min-h-8 flex-1 text-sm text-gray-500">{p.description || '暂无描述'}</p>
                <div className="mb-3 flex items-center justify-between text-xs text-gray-600">
                  <span>
                    {p.current_version > 0 ? `v${p.current_version}` : p.has_draft ? '草稿(未生成版本)' : '尚未生成'}
                  </span>
                  <span>{formatTime(p.updated_at)}</span>
                </div>

                {p.status === 'published' ? (
                  <div className="mb-3 flex items-center gap-1.5">
                    <a
                      href={`/s/${p.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10"
                      title={`/s/${p.slug}`}
                    >
                      🔗 /s/{p.slug}
                    </a>
                    <button
                      onClick={() => copyLink(p)}
                      className="shrink-0 rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
                    >
                      {copiedId === p.id ? '已复制 ✓' : '复制'}
                    </button>
                    <button
                      onClick={() => unpublish(p.id)}
                      disabled={busyId === p.id}
                      className="shrink-0 rounded-lg border border-amber-500/40 px-2.5 py-1.5 text-xs text-amber-400 hover:bg-amber-500/10 disabled:opacity-40"
                    >
                      {busyId === p.id ? '…' : '下线'}
                    </button>
                  </div>
                ) : p.current_version > 0 ? (
                  <div className="mb-3">
                    <button
                      onClick={() => publish(p.id)}
                      disabled={busyId === p.id}
                      className="rounded-lg border border-emerald-500/40 px-2.5 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40"
                    >
                      {busyId === p.id ? '发布中…' : '发布上线'}
                    </button>
                  </div>
                ) : (
                  <div className="mb-3 text-xs text-gray-600">
                    {p.has_draft ? '有草稿未生成版本,打开后可生成版本并发布' : '尚未生成,打开后描述想法即可创建'}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => nav(`/workspace/${p.id}`)}
                    className="flex-1 rounded-xl bg-indigo-600 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
                  >
                    打开
                  </button>
                  <button
                    onClick={() => remove(p.id)}
                    className="rounded-xl border border-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:border-red-500/50 hover:text-red-400"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
