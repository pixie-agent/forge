import { useEffect, useRef, useState } from 'react'
import CodeEditor from './CodeEditor'
import DataPanel from './DataPanel'
import { formatShortTime as formatTime } from '../lib/format'
import type { ArtifactManifest, Project, VersionMeta } from '../lib/types'

interface Props {
  /** 草稿预览令牌:非空时用 /p/:token/ iframe 打开当前版本(env=draft) */
  previewToken: string | null
  /** 当前展示版本的构建产物清单(文件列表) */
  manifest: ArtifactManifest | null
  /** 当前展示版本的源码树(路径→内容),代码页展示用 */
  src: Record<string, string> | null
  streaming: boolean
  /** 生成进行中的阶段文案(含已用时间),如"正在编写 src/App.jsx · 已 45s" */
  progressText: string
  /** agent(pi)的流式输出:thinking/正文/工具调用,随生成实时追加 */
  agentLog: string
  /** agent 最近写入的源文件,流式看代码用 */
  filesPreview: { path: string; content: string } | null
  project: Project | null
  /** 全部正式版本(倒序);不含草稿。有草稿或版本 >1 时显示版本切换器 */
  versions: VersionMeta[]
  /** 当前展示的内容:0 表示草稿(工作副本),>0 为正式版本号 */
  viewVersion: number
  /** 项目当前生效的正式版本号;0 表示还没有正式版本 */
  currentVersion: number
  /** 是否存在未确认的草稿(有则可「生成新版本」,此时预览的是草稿内容) */
  hasDraft: boolean
  /** 正在把草稿生成为新版本 */
  committing: boolean
  onSelectVersion: (n: number) => void
  onCommit: () => void
  /** 正在拉取历史版本内容:禁用切换并给出反馈 */
  switchingVersion: boolean
  /** 发布上线指定版本(线上固定在该版本,后续生成不会自动上线) */
  onPublish: (version: number) => void
  /** 下线:撤回公开发布页(公开链接随即 404) */
  onUnpublish: () => void
  /** 移动端是否隐藏(工作台用顶部标签在对话/预览间切换;桌面端始终显示) */
  mobileHidden?: boolean
}

export default function PreviewPane({
  previewToken,
  manifest,
  src,
  streaming,
  progressText,
  agentLog,
  filesPreview,
  project,
  versions,
  viewVersion,
  currentVersion,
  hasDraft,
  committing,
  onSelectVersion,
  onCommit,
  switchingVersion,
  onPublish,
  onUnpublish,
  mobileHidden,
}: Props) {
  const [tab, setTab] = useState<'preview' | 'code' | 'data'>('preview')
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [showLog, setShowLog] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedPreview, setCopiedPreview] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)
  // 新输出到达时贴住底部,像终端一样跟随
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [agentLog])
  const published = project?.status === 'published'
  /** 线上正在服务的版本号(与「当前工作版本」currentVersion 相互独立) */
  const publishedVersion = project?.published_version ?? 0
  const publicUrl = project ? `${location.origin}/s/${project.slug}` : ''
  // 多文件产物:源码经平台构建为 dist 存 R2,iframe 用草稿令牌访问 /p/:token/
  const previewUrl = previewToken ? `/p/${previewToken}/` : null
  // 最新正式版本号 = 版本列表里的最大号(versions 按 version_no 倒序,版本号越大越新,无需额外标「最新」)。
  // 不依赖 currentVersion,避免服务端历史数据漂移时"最新"判断出错;用于推下一个版本号与历史版本提示。
  const latestVersion = versions[0]?.version_no ?? 0
  // 下一个正式版本号(草稿生成正式版本时的编号):现有正式版本最大号 +1
  const nextVersion = latestVersion + 1
  // 当前展示的是草稿(工作副本)而非正式版本
  const viewingDraft = hasDraft && viewVersion === 0

  async function copyLink() {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
    } catch {
      // 剪贴板不可用(非安全上下文等)时退化为选中提示,不阻断
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  /** 复制测试环境链接(草稿预览 URL);打开者看到的是带「测试环境」角标的草稿,不是线上公开页 */
  async function copyPreviewLink() {
    if (!previewUrl) return
    try {
      await navigator.clipboard.writeText(new URL(previewUrl, location.origin).toString())
    } catch {
      // 剪贴板不可用时忽略,不阻断
    }
    setCopiedPreview(true)
    setTimeout(() => setCopiedPreview(false), 1600)
  }

  return (
    <section className={`${mobileHidden ? 'hidden md:flex' : 'flex'} min-w-0 flex-1 flex-col bg-gray-900`}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-gray-800 px-3 py-2 md:h-12 md:flex-nowrap md:py-0">
        <div className="flex shrink-0 gap-1">
          {(['preview', 'code', 'data'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                tab === t ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t === 'preview' ? '预览' : t === 'code' ? '代码' : '数据'}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {(versions.length > 1 || hasDraft) && (
            <div className="flex items-center gap-1.5">
              <span className="hidden text-xs text-gray-500 sm:inline">查看版本</span>
              <select
                value={viewVersion}
                onChange={(e) => onSelectVersion(Number(e.target.value))}
                disabled={streaming || switchingVersion}
                title="切换查看草稿或历史版本(仅切换查看,不改变线上)"
                className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 disabled:opacity-40"
              >
                {hasDraft && <option value={0}>草稿 · 未生成版本</option>}
                {versions.map((v) => (
                  <option key={v.version_no} value={v.version_no}>
                    v{v.version_no} · {formatTime(v.created_at)}
                    {v.version_no === publishedVersion ? ' (线上)' : ''}
                  </option>
                ))}
              </select>
              {switchingVersion && <span className="animate-pulse text-xs text-indigo-400">加载中…</span>}
            </div>
          )}
          {viewingDraft && !streaming && (
            <button
              onClick={onCommit}
              disabled={committing}
              title="把当前草稿保存为一个正式版本;之后可发布上线"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {committing ? '生成中…' : `生成新版本 v${nextVersion}`}
            </button>
          )}
          {tab === 'preview' && (
            <div className="flex rounded-lg border border-gray-700 p-0.5 text-xs">
              {(['desktop', 'mobile'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDevice(d)}
                  className={`rounded-md px-2 py-1 ${device === d ? 'bg-gray-700 text-gray-100' : 'text-gray-400'}`}
                >
                  {d === 'desktop' ? '桌面' : '移动'}
                </button>
              ))}
            </div>
          )}
          {(() => {
            // 发布目标 = 正在查看的正式版本;查看的是草稿/无版本则不发布
            const target = !viewingDraft && viewVersion > 0 ? viewVersion : currentVersion
            if (viewingDraft || target < 1) return null
            // 该版本已经是线上版本 → 无需发布
            if (published && target === publishedVersion) return null
            return (
              <button
                onClick={() => onPublish(target)}
                title={
                  target === currentVersion
                    ? '把当前工作版本发布上线(生成公开链接,任何人可访问)'
                    : `把 v${target} 直接发布上线,切换线上版本;不改动当前工作版本`
                }
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
              >
                {published ? `切换线上到 v${target}` : `发布 v${target}`}
              </button>
            )
          })()}
          <div className="relative">
            <button
              onClick={() => setShowHelp((v) => !v)}
              title="版本能力说明"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-700 text-xs text-gray-300 hover:bg-gray-800"
            >
              ?
            </button>
            {showHelp && (
              <div className="absolute right-0 top-9 z-40 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-gray-700 bg-gray-900 p-3 text-xs leading-relaxed text-gray-400 shadow-xl">
                <p className="mb-2 font-medium text-gray-100">版本与交付说明</p>
                <ul className="list-disc space-y-1.5 pl-4">
                  <li>「预览」标签里看到的是<b>测试环境</b>:即草稿内容,与线上公开页是两套环境、数据互不影响;页面左下角带「测试环境」角标,方便区分。</li>
                  <li>生成与对话修改都写入「草稿」,可反复修改,<b>不影响线上、也不会自动产生版本</b>。</li>
                  <li>满意后点「生成新版本 vN」把草稿保存为一个正式版本;正式版本永久保留、互不覆盖,聊天会继续在这个最新版本上改。</li>
                  <li>上方「查看版本」下拉只是切换<b>查看</b>哪个版本(不改任何东西)。</li>
                  <li><b>改线上只有一件事</b>:下拉选中要上线的版本 → 点「切换线上到 vN」。想上线最新版就选最新版,想回退就选旧版本,动作完全一样。</li>
                  <li>交付:「代码」标签左侧栏的「↓ 下载项目」导出该版本完整源码(zip,含源码不含数据),可本地运行或另存。</li>
                  <li>「下线」立即撤回公开链接(版本与数据都保留,可随时再发布)。</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 环境条:测试 / 线上各一个紧凑胶囊,单行呈现,不占篇幅 */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-gray-800 bg-gray-950/50 px-3 py-1.5 text-xs">
        <span className="flex items-center gap-1.5 text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          <span className="font-medium">测试环境</span>
          {previewUrl && (
            <>
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                title="新标签打开测试环境,可用真机/全屏体验"
                className="rounded-md border border-amber-500/40 px-2 py-0.5 hover:bg-amber-500/10"
              >
                打开
              </a>
              <button
                onClick={copyPreviewLink}
                title="复制测试环境链接;打开者看到的是带「测试环境」角标的草稿,不是线上"
                className="rounded-md border border-amber-500/40 px-2 py-0.5 hover:bg-amber-500/10"
              >
                {copiedPreview ? '已复制 ✓' : '复制'}
              </button>
            </>
          )}
        </span>

        <span className="hidden h-3.5 w-px bg-gray-700 sm:block" />

        {published ? (
          <span className="flex items-center gap-1.5 text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="font-medium">线上 · v{project?.published_version}</span>
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              title={`打开线上公开页 ${publicUrl}(任何人可访问)`}
              className="rounded-md border border-emerald-500/40 px-2 py-0.5 hover:bg-emerald-500/10"
            >
              打开 ↗
            </a>
            <button
              onClick={copyLink}
              title={publicUrl}
              className="rounded-md border border-emerald-500/40 px-2 py-0.5 hover:bg-emerald-500/10"
            >
              {copied ? '已复制 ✓' : '复制'}
            </button>
            <button
              onClick={onUnpublish}
              title="下线后公开链接立即失效(版本与数据保留)"
              className="rounded-md border border-amber-500/40 px-2 py-0.5 text-amber-300 hover:bg-amber-500/10"
            >
              下线
            </button>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-gray-500">
            <span className="h-1.5 w-1.5 rounded-full bg-gray-600" />
            线上 · 未发布
            <span className="text-gray-600">生成版本后点「发布」即上线</span>
          </span>
        )}
      </div>

      {viewingDraft && !streaming && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-xs text-indigo-300">
          <span>当前为草稿(尚未生成版本),生成与对话修改都写入这里,可反复修改。</span>
          <span className="text-indigo-400/70">满意后点右上角「生成新版本 v{nextVersion}」保存为正式版本;正式版本才可发布上线。</span>
        </div>
      )}

      {viewVersion > 0 && viewVersion !== latestVersion && !streaming && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          <span>正在查看历史版本 v{viewVersion},最新版本为 v{latestVersion}。</span>
          <span className="text-amber-400/70">
            继续对话会在最新版本 v{latestVersion} 的草稿上修改;要把 v{viewVersion} 设为线上,点右上角「切换线上到 v{viewVersion}」。
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-2 md:p-4">
        {tab === 'data' ? (
          project ? (
            <DataPanel projectId={project.id} />
          ) : null
        ) : tab === 'code' ? (
          <CodeEditor
            filesPreview={filesPreview}
            src={src}
            manifest={manifest}
            streaming={streaming}
            exportHref={project && viewVersion > 0 ? `/api/projects/${project.id}/versions/${viewVersion}/export` : undefined}
          />
        ) : (
          <div className={`mx-auto h-full ${device === 'mobile' ? 'w-full max-w-[390px]' : 'w-full'}`}>
            {previewUrl ? (
              <iframe
                title="preview"
                src={previewUrl}
                sandbox="allow-scripts allow-forms allow-popups"
                className="h-full min-h-[600px] w-full rounded-xl border border-gray-700 bg-white"
              />
            ) : (
              <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-2 text-sm text-gray-500">
                {streaming ? (
                  <>
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
                      {progressText || '正在生成应用…'}
                    </span>
                    <span className="text-xs text-gray-600">生成完成后自动构建产物;可离开页面,云端会继续完成</span>
                  </>
                ) : (
                  '暂无预览,在左侧描述你的想法开始生成'
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {agentLog && (
        <div className="flex max-h-[45%] shrink-0 flex-col border-t border-gray-800 bg-gray-950">
          <button
            onClick={() => setShowLog((v) => !v)}
            className="flex h-9 shrink-0 items-center gap-2 px-3 text-xs text-gray-400 hover:text-gray-200"
          >
            {streaming ? (
              <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
            ) : (
              <span className="h-2 w-2 rounded-full bg-gray-600" />
            )}
            <span className="font-medium">Agent 原始输出</span>
            <span className="text-gray-600">{streaming ? '· 生成中' : '· 已结束'}</span>
            <span className="ml-auto text-gray-600">{showLog ? '收起 ▾' : '展开查看工具调用/思考 ▸'}</span>
          </button>
          {showLog && (
            <pre
              ref={logRef}
              className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 font-mono text-xs leading-relaxed text-gray-400"
            >
              {agentLog}
              {streaming && <span className="animate-pulse text-indigo-400">▋</span>}
            </pre>
          )}
        </div>
      )}
    </section>
  )
}