import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AdminBar from '../components/AdminBar'
import { api } from '../lib/api'
import { formatBytes, formatTime } from '../lib/format'
import type { AdminStats, AdminUser } from '../lib/types'

const LIMIT = 20

/** 用户使用情况:跨用户列表,每行一个注册用户的使用量(项目/版本/对话/任务/积分/活跃/产物体量) */
export default function AdminUsers() {
  const [items, setItems] = useState<AdminUser[]>([])
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
      const data = await api<{ users: AdminUser[]; total: number }>(
        `/api/admin/users?q=${encodeURIComponent(query)}&page=${page}&limit=${LIMIT}`
      )
      setItems(data.users)
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
            <h1 className="text-xl font-semibold">用户使用情况</h1>
            {stats && (
              <p className="mt-1 text-xs text-gray-500">
                共 {stats.users} 个用户 · 近 7 天活跃 {stats.active_users_7d} · 任务 {stats.jobs}（成功 {stats.jobs_succeeded} / 失败{' '}
                {stats.jobs_failed}）· 近 7 天任务 {stats.jobs_7d}
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
              placeholder="搜索邮箱"
              className="w-64 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <button className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">搜索</button>
          </form>
        </div>

        {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}

        {loading ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-800 py-20 text-center text-sm text-gray-500">没有匹配的用户</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-900 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">邮箱</th>
                  <th className="px-4 py-2.5 font-medium">积分</th>
                  <th className="px-4 py-2.5 font-medium">项目</th>
                  <th className="px-4 py-2.5 font-medium">版本</th>
                  <th className="px-4 py-2.5 font-medium">对话</th>
                  <th className="px-4 py-2.5 font-medium">任务</th>
                  <th className="px-4 py-2.5 font-medium">成功 / 失败</th>
                  <th className="px-4 py-2.5 font-medium">近 7 天</th>
                  <th className="px-4 py-2.5 font-medium">产物</th>
                  <th className="px-4 py-2.5 font-medium">注册</th>
                  <th className="px-4 py-2.5 font-medium">最近活跃</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {items.map((u) => (
                  <tr key={u.id} className="cursor-pointer bg-gray-950 hover:bg-gray-900" onClick={() => nav(`/admin/users/${u.id}`)}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-100">{u.email}</div>
                      <div className="font-mono text-xs text-gray-600">{u.id.slice(0, 8)}</div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-300">{u.credits}</td>
                    <td className="px-4 py-2.5 text-gray-400">{u.projects_count}</td>
                    <td className="px-4 py-2.5 text-gray-400">{u.versions_count}</td>
                    <td className="px-4 py-2.5 text-gray-400">{u.messages_count}</td>
                    <td className="px-4 py-2.5">
                      <div className="text-gray-300">{u.jobs_total}</div>
                      <div className="text-xs text-gray-600">
                        生成 {u.jobs_generate} · 对话 {u.jobs_chat}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-emerald-400">{u.jobs_succeeded}</span>
                      <span className="mx-1 text-gray-600">/</span>
                      <span className={u.jobs_failed ? 'text-red-400' : 'text-gray-500'}>{u.jobs_failed}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400">{u.jobs_7d}</td>
                    <td className="px-4 py-2.5 text-gray-400">{formatBytes(u.bytes_total)}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">{formatTime(u.created_at)}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">{formatTime(u.last_active_at)}</td>
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

        <div className="mt-6 text-xs text-gray-600">
          <Link to="/admin" className="hover:text-gray-400">← 返回产物列表</Link>
        </div>
      </main>
    </div>
  )
}