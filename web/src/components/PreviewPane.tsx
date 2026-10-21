import { useEffect, useRef, useState } from 'react'
import CodeEditor from './CodeEditor'
import DataPanel from './DataPanel'
import RichText from './RichText'
import { formatShortTime as formatTime } from '../lib/format'
import { useT } from '../lib/i18n'
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
  /** 打开项目级「连接器」管理面板(接入外部系统 / 换账号 / 分环境配置) */
  onOpenConnectors: () => void
  /** 已绑定的连接器数量(按草稿环境计),>0 时入口按钮上显示角标 */
  connectorCount?: number
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
  onOpenConnectors,
  connectorCount = 0,
  mobileHidden,
}: Props) {
  const t = useT()
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
          {(['preview', 'code', 'data'] as const).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                tab === tabKey ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {tabKey === 'preview' ? t('nav.preview') : tabKey === 'code' ? t('nav.code') : t('nav.data')}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {(versions.length > 1 || hasDraft) && (
            <div className="flex items-center gap-1.5">
              <span className="hidden text-xs text-gray-500 sm:inline">{t('preview.viewVersion')}</span>
              <select
                value={viewVersion}
                onChange={(e) => onSelectVersion(Number(e.target.value))}
                disabled={streaming || switchingVersion}
                title={t('preview.versionTitle')}
                className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 disabled:opacity-40"
              >
                {hasDraft && <option value={0}>{t('preview.draftOption')}</option>}
                {versions.map((v) => (
                  <option key={v.version_no} value={v.version_no}>
                    v{v.version_no} · {formatTime(v.created_at)}
                    {v.version_no === publishedVersion ? t('preview.liveSuffix') : ''}
                  </option>
                ))}
              </select>
              {switchingVersion && <span className="animate-pulse text-xs text-indigo-400">{t('common.loading')}</span>}
            </div>
          )}
          {viewingDraft && !streaming && (
            <button
              onClick={onCommit}
              disabled={committing}
              title={t('preview.commitTitle')}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {committing ? t('preview.committing') : t('preview.commitVersion', { version: nextVersion })}
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
                  {d === 'desktop' ? t('preview.device.desktop') : t('preview.device.mobile')}
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
                    ? t('preview.publishTitle')
                    : t('preview.publishSwitchTitle', { version: target })
                }
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
              >
                {published ? t('preview.switchLive', { version: target }) : t('preview.publishVersion', { version: target })}
              </button>
            )
          })()}
          <button
            onClick={onOpenConnectors}
            title={t('conn.openTitle')}
            className="flex items-center gap-1 rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300 hover:border-indigo-500 hover:text-gray-100"
          >
            <span>🔌</span>
            <span className="hidden sm:inline">{t('conn.title')}</span>
            {connectorCount > 0 && (
              <span className="rounded-full bg-indigo-500/20 px-1.5 text-[10px] text-indigo-300">{connectorCount}</span>
            )}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowHelp((v) => !v)}
              title={t('preview.helpTitle')}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-700 text-xs text-gray-300 hover:bg-gray-800"
            >
              ?
            </button>
            {showHelp && (
              <div className="absolute right-0 top-9 z-40 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-gray-700 bg-gray-900 p-3 text-xs leading-relaxed text-gray-400 shadow-xl">
                <p className="mb-2 font-medium text-gray-100">{t('preview.help.heading')}</p>
                <ul className="list-disc space-y-1.5 pl-4">
                  {(['preview.help.1', 'preview.help.2', 'preview.help.3', 'preview.help.4', 'preview.help.5', 'preview.help.6', 'preview.help.7'] as const).map((k) => (
                    <li key={k}>
                      <RichText text={t(k)} />
                    </li>
                  ))}
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
          <span className="font-medium">{t('env.test')}</span>
          {previewUrl && (
            <>
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                title={t('preview.openTestTitle')}
                className="rounded-md border border-amber-500/40 px-2 py-0.5 hover:bg-amber-500/10"
              >
                {t('common.open')}
              </a>
              <button
                onClick={copyPreviewLink}
                title={t('preview.copyTestTitle')}
                className="rounded-md border border-amber-500/40 px-2 py-0.5 hover:bg-amber-500/10"
              >
                {copiedPreview ? t('common.copied') : t('common.copy')}
              </button>
            </>
          )}
        </span>

        <span className="hidden h-3.5 w-px bg-gray-700 sm:block" />

        {published ? (
          <span className="flex items-center gap-1.5 text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="font-medium">{t('env.live')} · v{project?.published_version}</span>
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              title={t('preview.openLiveTitle', { url: publicUrl })}
              className="rounded-md border border-emerald-500/40 px-2 py-0.5 hover:bg-emerald-500/10"
            >
              {t('preview.openExternal')}
            </a>
            <button
              onClick={copyLink}
              title={publicUrl}
              className="rounded-md border border-emerald-500/40 px-2 py-0.5 hover:bg-emerald-500/10"
            >
              {copied ? t('common.copied') : t('common.copy')}
            </button>
            <button
              onClick={onUnpublish}
              title={t('preview.unpublishTitle')}
              className="rounded-md border border-amber-500/40 px-2 py-0.5 text-amber-300 hover:bg-amber-500/10"
            >
              {t('projects.unpublish')}
            </button>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-gray-500">
            <span className="h-1.5 w-1.5 rounded-full bg-gray-600" />
            {t('preview.liveNotPublished')}
            <span className="text-gray-600">{t('preview.publishHint')}</span>
          </span>
        )}
      </div>

      {viewingDraft && !streaming && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-xs text-indigo-300">
          <span>{t('preview.draftBanner')}</span>
          <span className="text-indigo-400/70">{t('preview.draftBanner2', { version: nextVersion })}</span>
        </div>
      )}

      {/* 生成中:已有预览 iframe 时也把进度(含免费通道的排队提示)显式挂在顶部,避免只看得到旧预览 */}
      {streaming && progressText && previewUrl && (
        <div className="flex shrink-0 items-center gap-2 border-b border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-xs text-indigo-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
          <span>{progressText}</span>
        </div>
      )}

      {viewVersion > 0 && viewVersion !== latestVersion && !streaming && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          <span>{t('preview.historyBanner', { view: viewVersion, latest: latestVersion })}</span>
          <span className="text-amber-400/70">
            {t('preview.historyBanner2', { view: viewVersion, latest: latestVersion })}
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
                      {progressText || t('preview.generating')}
                    </span>
                    <span className="text-xs text-gray-600">{t('preview.generatingHint')}</span>
                  </>
                ) : (
                  t('preview.empty')
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
            <span className="font-medium">{t('preview.agentOutput')}</span>
            <span className="text-gray-600">{streaming ? t('preview.logRunning') : t('preview.logDone')}</span>
            <span className="ml-auto text-gray-600">{showLog ? t('chat.collapse') : t('preview.logExpand')}</span>
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