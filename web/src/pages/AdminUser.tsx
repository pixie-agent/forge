import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AdminBar from '../components/AdminBar'
import AdminJobLog from '../components/AdminJobLog'
import { api } from '../lib/api'
import { formatBytes, formatTime } from '../lib/format'
import type { AdminUserDetail } from '../lib/types'

/** 积分流水类型文案(与服务端 credit_ledger.reason 对应,后台固定中文) */
const CREDIT_REASON_LABELS: Record<string, string> = {
  signup: '注册赠送',
  job_hold: '任务冻结',
  job_release: '任务退还',
  purchase: '充值',
  refund: '退款',
  admin_grant: '后台加积分',
  expire: '过期',
}

/** 单个用户详情:用量聚合 + 该用户的项目 + 最近任务时间线 + 积分流水,可人工加积分 */
export default function AdminUser() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [error, setError] = useState('')
  const [grantAmount, setGrantAmount] = useState('')
  const [grantNote, setGrantNote] = useState('')
  const [grantNotify, setGrantNotify] = useState(false)
  const [granting, setGranting] = useState(false)
  const [notice, setNotice] = useState('')

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

  // 本地环境:存在活动任务时轮询刷新详情,让完整日志实时滚动(线上不轮询,只显示里程碑尾部)
  const local = detail?.environment === 'local'
  const hasActiveJob = detail?.jobs.some((j) => j.status === 'pending' || j.status === 'running') ?? false
  useEffect(() => {
    if (!local || !hasActiveJob) return
    const timer = setInterval(() => void load(), 2000)
    return () => clearInterval(timer)
  }, [local, hasActiveJob, load])

  const grant = async () => {
    if (granting) return
    const amount = Math.floor(Number(grantAmount))
    if (!Number.isInteger(amount) || amount <= 0) {
      setNotice('')
      setError('积分数必须是正整数')
      return
    }
    if (!window.confirm(`给 ${detail?.user.email ?? '该用户'} 加 ${amount} 积分${grantNotify ? ',并发送邮件通知' : ''}?`)) return

    setGranting(true)
    setError('')
    setNotice('')
    try {
      const data = await api<{
        granted: number
        credits: number
        notify: { requested: boolean; status: 'skipped' | 'sent' | 'failed' | 'unverified' }
      }>(`/api/admin/users/${id}/credits`, {
        method: 'POST',
        body: { amount, note: grantNote.trim(), notify: grantNotify },
      })
      const parts = [`已加 ${data.granted} 积分,当前余额 ${data.credits}`]
      if (data.notify.requested) {
        if (data.notify.status === 'sent') parts.push('已邮件通知')
        else if (data.notify.status === 'unverified') parts.push('邮箱未验证,未发送邮件')
        else parts.push('邮件通知失败')
      }
      setNotice(parts.join('；'))
      setGrantNote('')
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setGranting(false)
    }
  }

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

              {/* 人工加积分:写入 credit_ledger(admin_grant),下方流水可直接核对 */}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-800 pt-4">
                <span className="text-sm font-medium text-gray-300">加积分</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={grantAmount}
                  onChange={(e) => setGrantAmount(e.target.value)}
                  placeholder="积分数量"
                  className="w-28 rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
                <input
                  value={grantNote}
                  onChange={(e) => setGrantNote(e.target.value)}
                  placeholder="备注（可选）"
                  maxLength={200}
                  className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-emerald-500 sm:w-56"
                />
                <label className="flex items-center gap-1.5 text-sm text-gray-400">
                  <input
                    type="checkbox"
                    checked={grantNotify}
                    onChange={(e) => setGrantNotify(e.target.checked)}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  邮件通知用户
                </label>
                <button
                  onClick={() => void grant()}
                  disabled={granting}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {granting ? '处理中…' : '加积分'}
                </button>
                {notice && <span className="text-xs text-emerald-400">{notice}</span>}
              </div>
            </div>

            {/* 积分流水 */}
            <div className="mb-5">
              <h2 className="mb-2 text-sm font-medium text-gray-300">积分流水（最近 {detail.credits_log?.length ?? 0} 条）</h2>
              {(detail.credits_log?.length ?? 0) === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-800 py-10 text-center text-sm text-gray-500">该用户暂无积分流水</div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-gray-800">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-900 text-xs text-gray-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">时间</th>
                        <th className="px-4 py-2.5 font-medium">类型</th>
                        <th className="px-4 py-2.5 font-medium">变动</th>
                        <th className="px-4 py-2.5 font-medium">余额</th>
                        <th className="px-4 py-2.5 font-medium">备注</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {detail.credits_log.map((e) => (
                        <tr key={e.id} className="bg-gray-950">
                          <td className="px-4 py-2.5 text-xs text-gray-600">{formatTime(e.created_at)}</td>
                          <td className="px-4 py-2.5 text-gray-300">{CREDIT_REASON_LABELS[e.reason] ?? e.reason}</td>
                          <td className={`px-4 py-2.5 font-medium ${e.delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {e.delta > 0 ? `+${e.delta}` : e.delta}
                          </td>
                          <td className="px-4 py-2.5 text-gray-300">{e.balance_after}</td>
                          <td className="px-4 py-2.5 text-xs text-gray-500">{e.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
                        <th className="px-4 py-2.5 font-medium">链接 / 预览</th>
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
                          <td className="px-4 py-2.5 text-gray-400">
                            v{p.current_version}（{p.versions_count}）
                            {p.draft && (
                              <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400">草稿</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-gray-400">{p.messages_count}</td>
                          <td className="px-4 py-2.5 text-gray-400">{formatBytes(p.bytes)}</td>
                          <td className="px-4 py-2.5 text-gray-400">{p.data_count}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col gap-1">
                              {p.status === 'published' && (
                                <a
                                  href={`/s/${p.slug}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-indigo-400 hover:text-indigo-300"
                                >
                                  /s/{p.slug}
                                </a>
                              )}
                              {p.draft?.preview_token && (
                                <a
                                  href={`/p/${p.draft.preview_token}/`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-amber-400 hover:text-amber-300"
                                >
                                  草稿预览 ↗
                                </a>
                              )}
                              {p.status !== 'published' && !p.draft?.preview_token && <span className="text-xs text-gray-600">—</span>}
                            </div>
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
                        <AdminJobLog
                          text={j.agent_log}
                          live={local && (j.status === 'pending' || j.status === 'running')}
                        />
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