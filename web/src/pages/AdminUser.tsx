import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AdminBar from '../components/AdminBar'
import { api } from '../lib/api'
import { formatBytes, formatTime } from '../lib/format'
import type { AdminUserDetail } from '../lib/types'

/** 单个用户详情:用量聚合 + 该用户的项目 + 最近任务时间线(全量只读) */
export default function AdminUser() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      setDetail(await api<AdminUserDetail>(`/api/admin/users/${id}`))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const user = detail?.user
  const usage: [string, string][] = user
    ? [
        ['项目', String(user.projects_count)],
        ['正式版本', String(user.versions_count)],
        ['对话消息', String(user.messages_count)],
        ['任务总数', String(user.jobs_total)],
        ['生成任务', String(user.jobs_generate)],
        ['对话任务', String(user.jobs_chat)],
        ['成功任务', String(user.jobs_succeeded)],
        ['失败任务', String(user.jobs_failed)],
        ['近 7 天任务', String(user.jobs_7d)],
        ['近 30 天任务', String(user.jobs_30d)],
        ['构建产物', formatBytes(user.bytes_total)],
        ['积分余额', String(user.credits)],
      ]
    : []

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <AdminBar subtitle={user?.email} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-5 sm:px-4 sm:py-6">
        {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}
        {!detail || !user ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : (
          <>
            {/* 概要 + 用量 */}
            <div className="mb-5 rounded-2xl border border-gray-800 bg-gray-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-lg font-semibold">{user.email}</h1>
                  <p className="mt-1 text-xs text-gray-500">
                    用户 ID:<span className="font-mono">{user.id}</span>
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>注册:{formatTime(user.created_at)}</span>
                  <span>最近活跃:{formatTime(user.last_active_at)}</span>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {usage.map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-gray-800 bg-gray-950 px-3 py-2">
                    <div className="text-xs text-gray-500">{label}</div>
                    <div className="mt-0.5 text-lg font-semibold text-gray-100">{value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 项目 */}
            <div className="mb-5">
              <h2 className="mb-2 text-sm font-medium text-gray-300">项目（{detail.projects.length}）</h2>
              {detail.projects.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-800 py-10 text-center text-sm text-gray-500">该用户暂无项目</div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-gray-800">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-900 text-xs text-gray-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">名称</th>
                        <th className="px-4 py-2.5 font-medium">状态</th>
                        <th className="px-4 py-2.5 font-medium">版本</th>
                        <th className="px-4 py-2.5 font-medium">对话</th>
                        <th className="px-4 py-2.5 font-medium">产物</th>
                        <th className="px-4 py-2.5 font-medium">数据</th>
                        <th className="px-4 py-2.5 font-medium">公开链接</th>
                        <th className="px-4 py-2.5 font-medium">更新时间</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {detail.projects.map((p) => (
                        <tr key={p.id} className="cursor-pointer bg-gray-950 hover:bg-gray-900" onClick={() => nav(`/admin/projects/${p.id}`)}>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-gray-100">{p.name || '未命名项目'}</div>
                            <div className="font-mono text-xs text-gray-600">{p.slug}</div>
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
                          <td className="px-4 py-2.5 text-gray-400">{formatBytes(p.bytes)}</td>
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
            </div>

            {/* 任务时间线 */}
            <div>
              <h2 className="mb-2 text-sm font-medium text-gray-300">最近任务（{detail.jobs.length}）</h2>
              {detail.jobs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-800 py-10 text-center text-sm text-gray-500">该用户暂无任务</div>
              ) : (
                <div className="space-y-3">
                  {detail.jobs.map((j) => (
                    <details key={j.id} className="rounded-xl border border-gray-800 bg-gray-900 p-3">
                      <summary className="cursor-pointer text-sm">
                        <span className="font-medium">{j.type}</span>
                        <span
                          className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                            j.status === 'succeeded'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : j.status === 'failed'
                                ? 'bg-red-500/15 text-red-400'
                                : 'bg-gray-700/60 text-gray-300'
                          }`}
                        >
                          {j.status}
                        </span>
                        {j.project_slug && (
                          <span className="ml-2 text-xs text-gray-500">
                            {j.project_name || '未命名'} · <span className="font-mono">{j.project_slug}</span>
                          </span>
                        )}
                        <span className="ml-2 text-xs text-gray-500">{j.stage} · {j.progress ?? ''}</span>
                        {j.result_version ? <span className="ml-2 text-xs text-gray-500">→ v{j.result_version}</span> : null}
                        <span className="ml-2 text-xs text-gray-600">{formatTime(j.created_at)}</span>
                      </summary>
                      {j.error && <div className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{j.error}</div>}
                      {j.agent_log && (
                        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-950 p-3 font-mono text-xs leading-relaxed text-gray-400">
                          {j.agent_log}
                        </pre>
                      )}
                    </details>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 text-xs text-gray-600">
              <Link to="/admin/users" className="hover:text-gray-400">← 返回用户列表</Link>
            </div>
          </>
        )}
      </main>
    </div>
  )
}