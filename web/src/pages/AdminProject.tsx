import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AdminBar from '../components/AdminBar'
import AdminJobLog from '../components/AdminJobLog'
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

  // 首页展示(唯一可写区域):标签输入 + 上下首页
  const [featuredTags, setFeaturedTags] = useState('')
  const [featuredBusy, setFeaturedBusy] = useState(false)
  const [featuredMsg, setFeaturedMsg] = useState('')
  const [featuredMsgTone, setFeaturedMsgTone] = useState<'ok' | 'err'>('ok')

  const loadDetail = useCallback(async () => {
    setError('')
    try {
      const d = await api<AdminProjectDetail>(`/api/admin/projects/${id}`)
      setDetail(d)
      setFeaturedTags(d.project.featured_tags ?? '')
      // 默认看草稿(工作副本):它就是用户此刻看到的样子;没有草稿才回退到最新正式版本
      if (d.draft) setVersionNo(0)
      else if (d.versions[0]) setVersionNo(d.versions[0].version_no)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [id])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  // 本地环境:存在活动任务时轮询刷新详情,让完整日志实时滚动(线上不轮询,只显示里程碑尾部)
  const local = detail?.environment === 'local'
  const hasActiveJob = detail?.jobs.some((j) => j.status === 'pending' || j.status === 'running') ?? false
  useEffect(() => {
    if (!local || !hasActiveJob) return
    const timer = setInterval(() => void loadDetail(), 2000)
    return () => clearInterval(timer)
  }, [local, hasActiveJob, loadDetail])

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
  const draft = detail?.draft ?? null
  // 每个版本都签发草稿令牌,后台可直接预览该版本(与线上/当前版本解耦);无构建产物时不签发,previewUrl 为 null
  const previewUrl = versionPreviewToken ? `/p/${versionPreviewToken}/` : null
  const envCollections = (detail?.collections ?? []).filter((c) => c.env === dataEnv)

  /**
   * 保存首页展示设置。next 省略 = 只保存标签(不动展示状态);
   * 传 true/false = 同时上/下首页。是否已发布由服务端再校验一次。
   */
  async function saveFeatured(next?: boolean) {
    if (!project || featuredBusy) return
    setFeaturedBusy(true)
    setFeaturedMsg('')
    try {
      const d = await api<{ featured: number; featured_tags: string }>(`/api/admin/projects/${project.id}/featured`, {
        method: 'POST',
        body: next === undefined ? { tags: featuredTags } : { featured: next, tags: featuredTags },
      })
      setDetail((prev) =>
        prev ? { ...prev, project: { ...prev.project, featured: d.featured, featured_tags: d.featured_tags } } : prev
      )
      setFeaturedTags(d.featured_tags)
      setFeaturedMsgTone('ok')
      setFeaturedMsg(next === undefined ? '标签已保存' : d.featured ? '已上首页' : '已下首页')
    } catch (err) {
      setFeaturedMsgTone('err')
      setFeaturedMsg((err as Error).message)
    } finally {
      setFeaturedBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <AdminBar subtitle={project ? `${project.name || '未命名'} · ${project.slug}` : undefined} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-5 sm:px-4 sm:py-6">
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
                  {draft?.preview_token && (
                    <a
                      href={`/p/${draft.preview_token}/`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-500/10"
                    >
                      预览草稿 ↗
                    </a>
                  )}
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
                <span>草稿:{draft ? formatTime(draft.created_at) : '无'}</span>
                <span>更新:{formatTime(project.updated_at)}</span>
              </div>
              <div className="mt-1 text-xs text-gray-600">
                公开链接:<span className="font-mono">{location.origin}/s/{project.slug}</span>
                {project.status !== 'published' && <span className="ml-2 text-amber-400/80">(未发布,公开页需先发布)</span>}
              </div>
            </div>

            {/* 首页展示:打标签 + 上下首页(唯一会写产物元数据的后台区域) */}
            <div className="mb-5 rounded-2xl border border-gray-800 bg-gray-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">首页展示</h2>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-gray-500">
                    勾选后出现在首页「精选案例」。只有已发布项目能上首页;用户克隆时会复制当前线上版本的源码与构建产物,
                    不包含站点数据、连接器与对话记录。
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    project.featured ? 'bg-fuchsia-500/15 text-fuchsia-300' : 'bg-gray-700/60 text-gray-400'
                  }`}
                >
                  {project.featured ? '已上首页' : '未上首页'}
                </span>
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={featuredTags}
                  onChange={(e) => setFeaturedTags(e.target.value)}
                  placeholder="标签,用逗号分隔(最多 5 个,如:电商, 作品集)"
                  className="w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-indigo-500 sm:max-w-md"
                />
                <button
                  onClick={() => saveFeatured()}
                  disabled={featuredBusy}
                  className="rounded-xl border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-40"
                >
                  保存标签
                </button>
                <button
                  onClick={() => saveFeatured(!project.featured)}
                  disabled={featuredBusy || (!project.featured && project.status !== 'published')}
                  title={!project.featured && project.status !== 'published' ? '先发布该版本才能上首页' : undefined}
                  className={`rounded-xl px-3 py-2 text-sm font-medium text-white disabled:opacity-40 ${
                    project.featured ? 'bg-gray-700 hover:bg-gray-600' : 'bg-indigo-600 hover:bg-indigo-500'
                  }`}
                >
                  {featuredBusy ? '保存中…' : project.featured ? '下首页' : '上首页'}
                </button>
              </div>
              {featuredMsg && (
                <p className={`mt-2 text-xs ${featuredMsgTone === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{featuredMsg}</p>
              )}
              {project.status !== 'published' && (
                <p className="mt-2 text-xs text-amber-400/80">当前项目未发布:可以先编辑标签,发布会后才能上首页。</p>
              )}
            </div>

            {/* 标签 */}
            <div className="mb-4 flex flex-wrap gap-1">
              {(
                [
                  ['versions', `版本 (${detail.versions.length}${draft ? ' + 草稿' : ''})`],
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
              <div className="flex flex-col gap-4 md:flex-row">
                <div className="w-full shrink-0 space-y-1 md:w-56">
                  {/* 草稿(工作副本)固定置顶:它不在正式版本序列里,但正是用户当下看到的样子 */}
                  {draft && (
                    <button
                      onClick={() => setVersionNo(0)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                        versionNo === 0 ? 'bg-amber-500/15 text-amber-200' : 'text-amber-400/80 hover:bg-gray-800/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">草稿</span>
                        <span className="text-xs text-amber-400/50">{(draft.bytes / 1024).toFixed(1)} KB</span>
                      </div>
                      <div className="truncate text-xs text-amber-400/50">{formatTime(draft.created_at)}</div>
                    </button>
                  )}
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
                  {!draft && detail.versions.length === 0 && (
                    <div className="rounded-lg border border-dashed border-gray-700 px-3 py-4 text-center text-xs text-gray-600">
                      暂无草稿与版本
                    </div>
                  )}
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
                          {versionNo === 0 && (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400">草稿 · 工作副本</span>
                          )}
                          {versionManifest && (
                            <span className="text-xs text-gray-600">构建产物 {versionManifest.files.length} 个文件</span>
                          )}
                          {versionPrompt && <span className="max-w-[40%] truncate text-xs text-gray-600">需求:{versionPrompt}</span>}
                        </div>
                      </div>
                      {showSource ? (
                        <div className="flex flex-col gap-3 md:flex-row">
                          <div className="max-h-40 w-full shrink-0 overflow-auto rounded-xl border border-gray-800 bg-gray-900 p-1 md:max-h-[70vh] md:w-56">
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
                          {versionNo === 0 ? '草稿暂无构建产物(可能生成失败或从未构建)' : '该版本暂无构建产物'}
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
                      <AdminJobLog
                        text={j.agent_log}
                        live={local && (j.status === 'pending' || j.status === 'running')}
                      />
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
                  <div className="flex flex-col gap-4 md:flex-row">
                    <div className="w-full shrink-0 space-y-1 md:w-48">
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