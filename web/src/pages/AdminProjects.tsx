import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AdminBar from '../components/AdminBar'
import { api } from '../lib/api'
import { formatTime } from '../lib/format'
import type { AdminProject, AdminStats } from '../lib/types'

const LIMIT = 20

/** 产物列表:跨用户展示全部项目(属主、版本数、公开链接),支持搜索与分页 */
export default function AdminProjects() {
  const [items, setItems] = useState<AdminProject[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const nav = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api<{ projects: AdminProject[]; total: number }>(
        `/api/admin/projects?q=${encodeURIComponent(query)}&page=${page}&limit=${LIMIT}`
      )
      setItems(data.projects)
      setTotal(data.total)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [query, page])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    api<{ stats: AdminStats }>('/api/admin/stats')
      .then((d) => setStats(d.stats))
      .catch(() => {})
  }, [])

  const pages = Math.max(1, Math.ceil(total / LIMIT))

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <AdminBar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">产物列表</h1>
            {stats && (
              <p className="mt-1 text-xs text-gray-500">
                共 {stats.projects} 个项目 · {stats.users} 个用户 · {stats.versions} 个版本 · 近 7 天活跃 {stats.active_users_7d} ·{' '}
                <Link to="/admin/users" className="text-indigo-400 hover:text-indigo-300">
                  查看用户使用情况 →
                </Link>
              </p>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setPage(1)
              setQuery(input.trim())
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="搜索名称 / slug / 属主邮箱"
              className="w-64 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <button className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">搜索</button>
          </form>
        </div>

        {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}

        {loading ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-800 py-20 text-center text-sm text-gray-500">
            没有匹配的产物
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-900 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">名称</th>
                  <th className="px-4 py-2.5 font-medium">属主</th>
                  <th className="px-4 py-2.5 font-medium">状态</th>
                  <th className="px-4 py-2.5 font-medium">版本</th>
                  <th className="px-4 py-2.5 font-medium">对话</th>
                  <th className="px-4 py-2.5 font-medium">数据</th>
                  <th className="px-4 py-2.5 font-medium">公开链接</th>
                  <th className="px-4 py-2.5 font-medium">更新时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {items.map((p) => (
                  <tr key={p.id} className="cursor-pointer bg-gray-950 hover:bg-gray-900" onClick={() => nav(`/admin/projects/${p.id}`)}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-100">{p.name || '未命名项目'}</div>
                      <div className="font-mono text-xs text-gray-600">{p.slug}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/admin/users/${p.user_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-gray-400 hover:text-indigo-300"
                      >
                        {p.owner_email}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          p.status === 'published' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-700/60 text-gray-400'
                        }`}
                      >
                        {p.status === 'published' ? '已发布' : '草稿'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400">v{p.current_version}（{p.versions_count}）</td>
                    <td className="px-4 py-2.5 text-gray-400">{p.messages_count}</td>
                    <td className="px-4 py-2.5 text-gray-400">{p.data_count}</td>
                    <td className="px-4 py-2.5">
                      <a
                        href={`/s/${p.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-indigo-400 hover:text-indigo-300"
                      >
                        /s/{p.slug}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">{formatTime(p.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-3 text-sm">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-gray-400 disabled:opacity-30"
            >
              上一页
            </button>
            <span className="text-gray-500">
              {page} / {pages}
            </span>
            <button
              disabled={page >= pages}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-gray-400 disabled:opacity-30"
            >
              下一页
            </button>
          </div>
        )}
      </main>
    </div>
  )
}