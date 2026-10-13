import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AdminBar from '../components/AdminBar'
import { api } from '../lib/api'
import { formatTime } from '../lib/format'
import type { AdminProjectDetail, AdminVersionDetail, SiteDataItem } from '../lib/types'

type Tab = 'versions' | 'chat' | 'jobs' | 'data'

/** 单个产物详情:全部版本源码+预览、对话、任务与 agent 日志、站点数据(全量只读) */
export default function AdminProject() {
  const { id = '' } = useParams()
  const [detail, setDetail] = useState<AdminProjectDetail | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('versions')

  // 版本
  const [versionNo, setVersionNo] = useState<number | null>(null)
  const [versionSrc, setVersionSrc] = useState<Record<string, string>>({})
  const [versionManifest, setVersionManifest] = useState<AdminVersionDetail['manifest']>(null)
  const [versionPreviewToken, setVersionPreviewToken] = useState<string | null>(null)
  const [versionPrompt, setVersionPrompt] = useState('')
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(false)

  // 数据
  const [collection, setCollection] = useState<string | null>(null)
  const [dataEnv, setDataEnv] = useState<'draft' | 'live'>('live')
  const [rows, setRows] = useState<SiteDataItem[]>([])

  const loadDetail = useCallback(async () => {
    setError('')
    try {
      const d = await api<AdminProjectDetail>(`/api/admin/projects/${id}`)
      setDetail(d)
      if (d.versions[0]) setVersionNo(d.versions[0].version_no)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [id])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  // 选中的版本 → 拉完整源码树 + 产物清单
  useEffect(() => {
    if (versionNo === null) return
    setVersionSrc({})
    setVersionManifest(null)
    setVersionPreviewToken(null)
    setActiveFile(null)
    api<{ version: AdminVersionDetail }>(`/api/admin/projects/${id}/versions/${versionNo}`)
      .then((d) => {
        setVersionSrc(d.version.src ?? {})
        setVersionManifest(d.version.manifest)
        setVersionPreviewToken(d.version.previewToken)
        setVersionPrompt(d.version.prompt)
        setActiveFile(Object.keys(d.version.src ?? {})[0] ?? null)
      })
      .catch((err) => setError((err as Error).message))
  }, [id, versionNo])

  const openCollection = useCallback(
    async (name: string) => {
      setCollection(name)
      try {
        const d = await api<{ items: SiteDataItem[] }>(`/api/admin/projects/${id}/data/${dataEnv}/${name}`)
        setRows(d.items)
      } catch (err) {
        setRows([])
        setError((err as Error).message)
      }
    },
    [id, dataEnv]
  )

  useEffect(() => {
    setCollection(null)
    setRows([])
  }, [dataEnv])

  const project = detail?.project
  // 每个版本都签发草稿令牌,后台可直接预览该版本(与线上/当前版本解耦)
  const previewUrl = versionPreviewToken ? `/p/${versionPreviewToken}/` : null
  const envCollections = (detail?.collections ?? []).filter((c) => c.env === dataEnv)

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <AdminBar subtitle={project ? `${project.name || '未命名'} · ${project.slug}` : undefined} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}
        {!detail || !project ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : (
          <>
            {/* 概要 */}
            <div className="mb-5 rounded-2xl border border-gray-800 bg-gray-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-lg font-semibold">{project.name || '未命名项目'}</h1>
                  <p className="mt-1 text-sm text-gray-500">{project.description || '暂无描述'}</p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      project.status === 'published' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-700/60 text-gray-400'
                    }`}
                  >
                    {project.status === 'published' ? '已发布' : '草稿'}
                  </span>
                  <a
                    href={`/s/${project.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10"
                  >
                    打开公开页 ↗
                  </a>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-y-1 text-xs text-gray-500 sm:grid-cols-4">
                <span>属主:{project.owner_email}</span>
                <span>项目 ID:{project.id.slice(0, 8)}</span>
                <span>当前版本:v{project.current_version}</span>
                <span>更新:{formatTime(project.updated_at)}</span>
              </div>
              <div className="mt-1 text-xs text-gray-600">
                公开链接:<span className="font-mono">{location.origin}/s/{project.slug}</span>
                {project.status !== 'published' && <span className="ml-2 text-amber-400/80">(未发布,公开页需先发布)</span>}
              </div>
            </div>

            {/* 标签 */}
            <div className="mb-4 flex gap-1">
              {(
                [
                  ['versions', `版本 (${detail.versions.length})`],
                  ['chat', `对话 (${detail.messages.length})`],
                  ['jobs', `任务 (${detail.jobs.length})`],
                  ['data', `站点数据 (${detail.collections.reduce((s, c) => s + c.count, 0)})`],
                ] as const
              ).map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-lg px-3 py-1.5 text-sm ${tab === t ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'versions' && (
              <div className="flex gap-4">
                <div className="w-56 shrink-0 space-y-1">
                  {detail.versions.map((v) => (
                    <button
                      key={v.version_no}
                      onClick={() => setVersionNo(v.version_no)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                        versionNo === v.version_no ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:bg-gray-800/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">v{v.version_no}</span>
                        <span className="text-xs text-gray-600">{(v.bytes / 1024).toFixed(1)} KB</span>
                      </div>
                      <div className="truncate text-xs text-gray-600">{formatTime(v.created_at)}</div>
                    </button>
                  ))}
                </div>

                <div className="min-w-0 flex-1">
                  {versionNo === null ? (
                    <div className="rounded-xl border border-dashed border-gray-700 p-8 text-center text-sm text-gray-500">选择左侧版本</div>
                  ) : (
                    <>
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex gap-1 rounded-lg border border-gray-700 p-0.5 text-xs">
                          {(
                            [
                              [false, '预览'],
                              [true, '源码'],
                            ] as const
                          ).map(([s, label]) => (
                            <button
                              key={label}
                              onClick={() => setShowSource(s)}
                              className={`rounded-md px-3 py-1 ${showSource === s ? 'bg-gray-700 text-gray-100' : 'text-gray-400'}`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-3">
                          {versionManifest && (
                            <span className="text-xs text-gray-600">构建产物 {versionManifest.files.length} 个文件</span>
                          )}
                          {versionPrompt && <span className="max-w-[40%] truncate text-xs text-gray-600">需求:{versionPrompt}</span>}
                        </div>
                      </div>
                      {showSource ? (
                        <div className="flex gap-3">
                          <div className="w-56 shrink-0 max-h-[70vh] overflow-auto rounded-xl border border-gray-800 bg-gray-900 p-1">
                            {Object.keys(versionSrc).length === 0 && <p className="px-3 py-2 text-xs text-gray-600">无源码</p>}
                            {Object.keys(versionSrc)
                              .sort()
                              .map((p) => (
                                <button
                                  key={p}
                                  onClick={() => setActiveFile(p)}
                                  className={`block w-full truncate rounded-lg px-3 py-1.5 text-left font-mono text-xs ${
                                    activeFile === p ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:bg-gray-800/50'
                                  }`}
                                  title={p}
                                >
                                  {p}
                                </button>
                              ))}
                          </div>
                          <pre className="min-w-0 max-h-[70vh] flex-1 overflow-auto rounded-xl border border-gray-800 bg-gray-950 p-3 font-mono text-xs leading-relaxed text-gray-300">
                            {activeFile ? versionSrc[activeFile] : '选择左侧文件查看内容'}
                          </pre>
                        </div>
                      ) : previewUrl ? (
                        <iframe
                          title="admin-preview"
                          src={previewUrl}
                          sandbox="allow-scripts allow-forms allow-popups"
                          className="h-[70vh] w-full rounded-xl border border-gray-700 bg-white"
                        />
                      ) : (
                        <div className="flex h-[70vh] items-center justify-center rounded-xl border border-dashed border-gray-700 text-sm text-gray-500">
                          该版本暂无构建产物
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {tab === 'chat' && (
              <div className="space-y-3">
                {detail.messages.length === 0 && <p className="text-sm text-gray-500">暂无对话</p>}
                {detail.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                        m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-200'
                      }`}
                    >
                      <div className="mb-1 text-xs opacity-60">{m.role === 'user' ? '用户' : '助手'} · {formatTime(m.created_at)}</div>
                      <div className="whitespace-pre-wrap break-words">{m.content}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'jobs' && (
              <div className="space-y-3">
                {detail.jobs.length === 0 && <p className="text-sm text-gray-500">暂无任务</p>}
                {detail.jobs.map((j) => (
                  <details key={j.id} className="rounded-xl border border-gray-800 bg-gray-900 p-3">
                    <summary className="cursor-pointer text-sm">
                      <span className="font-medium">{j.type}</span>
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                        j.status === 'succeeded' ? 'bg-emerald-500/15 text-emerald-400'
                          : j.status === 'failed' ? 'bg-red-500/15 text-red-400'
                          : 'bg-gray-700/60 text-gray-300'
                      }`}>{j.status}</span>
                      <span className="ml-2 text-xs text-gray-500">{j.stage} · {j.progress ?? ''}</span>
                      {j.result_version && <span className="ml-2 text-xs text-gray-500">→ v{j.result_version}</span>}
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

            {tab === 'data' && (
              <div>
                <div className="mb-3 flex rounded-lg border border-gray-700 p-0.5 text-xs">
                  {(
                    [
                      ['draft', '草稿'],
                      ['live', '线上'],
                    ] as const
                  ).map(([e, label]) => (
                    <button
                      key={e}
                      onClick={() => setDataEnv(e)}
                      className={`rounded-md px-3 py-1.5 ${dataEnv === e ? 'bg-gray-700 text-gray-100' : 'text-gray-400'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {envCollections.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-700 p-8 text-center text-sm text-gray-500">该环境下暂无数据</div>
                ) : (
                  <div className="flex gap-4">
                    <div className="w-48 shrink-0 space-y-1">
                      {envCollections.map((col) => (
                        <button
                          key={`${col.env}/${col.collection}`}
                          onClick={() => openCollection(col.collection)}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm ${
                            collection === col.collection ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:bg-gray-800/50'
                          }`}
                        >
                          <span className="truncate font-mono text-xs">{col.collection}</span>
                          <span className="ml-2 rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">{col.count}</span>
                        </button>
                      ))}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      {collection === null ? (
                        <div className="rounded-xl border border-dashed border-gray-700 p-6 text-center text-xs text-gray-500">选择左侧集合查看数据</div>
                      ) : rows.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-gray-700 p-6 text-center text-xs text-gray-500">暂无数据</div>
                      ) : (
                        rows.map((r) => (
                          <div key={r.id} className="rounded-xl border border-gray-800 bg-gray-950 p-3 text-xs">
                            <div className="mb-1 text-gray-600">{formatTime(r.created_at)}</div>
                            <pre className="overflow-auto whitespace-pre-wrap break-all font-mono leading-5 text-gray-300">
                              {JSON.stringify(r.data, null, 2)}
                            </pre>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 text-xs text-gray-600">
              <Link to="/admin" className="hover:text-gray-400">← 返回产物列表</Link>
            </div>
          </>
        )}
      </main>
    </div>
  )
}