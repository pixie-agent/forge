import { useState } from 'react'
import CodeEditor from './CodeEditor'
import DataPanel from './DataPanel'
import RichText from './RichText'
import { formatShortTime as formatTime } from '../lib/format'
import { useT, getActiveLang } from '../lib/i18n'
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
  const [showHelp, setShowHelp] = useState(false)
  // 移动端:次要操作(版本切换/连接器/帮助)收进「更多」菜单,工具栏只留标签与主操作
  const [showMore, setShowMore] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedPreview, setCopiedPreview] = useState(false)
  const published = project?.status === 'published'
  /** 线上正在服务的版本号(与「当前工作版本」currentVersion 相互独立) */
  const publishedVersion = project?.published_version ?? 0
  const publicUrl = project ? `${location.origin}/s/${project.slug}` : ''
  // 多文件产物:源码经平台构建为 dist 存 R2,iframe 用草稿令牌访问 /p/:token/
  // ?lang= 告诉服务端用哪种语言渲染平台自己的角标(「测试环境 · 草稿预览」)
  const previewUrl = previewToken ? `/p/${previewToken}/?lang=${getActiveLang()}` : null
  // 最新正式版本号 = 版本列表里的最大号(versions 按 version_no 倒序,版本号越大越新,无需额外标「最新」)。
  // 不依赖 currentVersion,避免服务端历史数据漂移时"最新"判断出错;用于推下一个版本号与历史版本提示。
  const latestVersion = versions[0]?.version_no ?? 0
  // 下一个正式版本号(草稿生成正式版本时的编号):现有正式版本最大号 +1
  const nextVersion = latestVersion + 1
  // 当前展示的是草稿(工作副本)而非正式版本
  const viewingDraft = hasDraft && viewVersion === 0
  // 版本切换器:有草稿或多个正式版本时才需要
  const showVersionPicker = versions.length > 1 || hasDraft
  const versionPicker = showVersionPicker ? (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-xs text-gray-500">{t('preview.viewVersion')}</span>
      <select
        value={viewVersion}
        onChange={(e) => onSelectVersion(Number(e.target.value))}
        disabled={streaming || switchingVersion}
        title={t('preview.versionTitle')}
        className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 disabled:opacity-40 md:flex-none"
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
  ) : null
  // 版本能力说明:桌面端浮层与移动端「更多」菜单共用同一份内容
  const helpContent = (
    <>
      <p className="mb-2 font-medium text-gray-100">{t('preview.help.heading')}</p>
      <ul className="list-disc space-y-1.5 pl-4">
        {(['preview.help.1', 'preview.help.2', 'preview.help.3', 'preview.help.4', 'preview.help.5', 'preview.help.6', 'preview.help.7'] as const).map((k) => (
          <li key={k}>
            <RichText text={t(k)} />
          </li>
        ))}
      </ul>
    </>
  )

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
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-800 px-2 py-1.5 md:h-12 md:px-3 md:py-0">
        <div className="flex shrink-0 gap-0.5 md:gap-1">
          {(['preview', 'code', 'data'] as const).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`rounded-lg px-2.5 py-1.5 text-sm md:px-3 ${
                tab === tabKey ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {tabKey === 'preview' ? t('nav.preview') : tabKey === 'code' ? t('nav.code') : t('nav.data')}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 items-center justify-end gap-1.5 md:gap-2">
          {/* 主操作:草稿→生成版本 / 发布上线。手机上始终可见,不埋进菜单 */}
          {viewingDraft && !streaming && (
            <button
              onClick={onCommit}
              disabled={committing}
              title={t('preview.commitTitle')}
              className="whitespace-nowrap rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40 md:px-3"
            >
              {committing ? t('preview.committing') : t('preview.commitVersion', { version: nextVersion })}
            </button>
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
                className="whitespace-nowrap rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 md:px-3"
              >
                {published ? t('preview.switchLive', { version: target }) : t('preview.publishVersion', { version: target })}
              </button>
            )
          })()}

          {/* 桌面端:版本切换 / 设备预览 / 连接器 / 帮助 常驻 */}
          <div className="hidden items-center gap-2 md:flex">
            {versionPicker}
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
            <button
              onClick={onOpenConnectors}
              title={t('conn.openTitle')}
              className="flex items-center gap-1 rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300 hover:border-indigo-500 hover:text-gray-100"
            >
              <span>🔌</span>
              <span className="hidden lg:inline">{t('conn.title')}</span>
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
                  {helpContent}
                </div>
              )}
            </div>
          </div>

          {/* 移动端:次要操作收进「更多」,工具栏只留标签与主操作 */}
          <div className="relative md:hidden">
            <button
              onClick={() => setShowMore((v) => !v)}
              title={t('common.more')}
              aria-label={t('common.more')}
              aria-expanded={showMore}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border text-base leading-none ${
                showMore ? 'border-indigo-500 bg-gray-800 text-gray-100' : 'border-gray-700 text-gray-300'
              }`}
            >
              ⋯
            </button>
            {showMore && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMore(false)} />
                <div className="absolute right-0 top-10 z-50 max-h-[70dvh] w-64 max-w-[calc(100vw-1rem)] overflow-auto overscroll-contain rounded-xl border border-gray-700 bg-gray-900 p-2 text-xs shadow-xl">
                  {versionPicker && <div className="border-b border-gray-800 px-1 pb-2">{versionPicker}</div>}
                  <button
                    onClick={() => {
                      setShowMore(false)
                      onOpenConnectors()
                    }}
                    className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-gray-300 hover:bg-gray-800"
                  >
                    <span>🔌</span>
                    <span>{t('conn.title')}</span>
                    {connectorCount > 0 && (
                      <span className="rounded-full bg-indigo-500/20 px-1.5 text-[10px] text-indigo-300">{connectorCount}</span>
                    )}
                  </button>
                  {/* 环境条的「复制 / 下线」在手机上收进菜单,功能不丢 */}
                  {previewUrl && (
                    <button
                      onClick={copyPreviewLink}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-gray-300 hover:bg-gray-800"
                    >
                      <span>⧉</span>
                      <span>{copiedPreview ? t('common.copied') : t('preview.copyTest')}</span>
                    </button>
                  )}
                  {published && (
                    <button
                      onClick={copyLink}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-gray-300 hover:bg-gray-800"
                    >
                      <span>⧉</span>
                      <span>{copied ? t('common.copied') : t('preview.copyLive')}</span>
                    </button>
                  )}
                  {published && (
                    <button
                      onClick={() => {
                        setShowMore(false)
                        onUnpublish()
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-amber-300 hover:bg-amber-500/10"
                    >
                      <span>⏻</span>
                      <span>{t('projects.unpublish')}</span>
                    </button>
                  )}
                  <button
                    onClick={() => setShowHelp((v) => !v)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-gray-300 hover:bg-gray-800"
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-gray-600 text-[10px]">?</span>
                    <span>{t('preview.helpTitle')}</span>
                    <span className="ml-auto text-gray-600">{showHelp ? '▾' : '▸'}</span>
                  </button>
                  {showHelp && (
                    <div className="rounded-lg bg-gray-950/60 p-2.5 leading-relaxed text-gray-400">{helpContent}</div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 环境条:测试 / 线上各一个紧凑胶囊,单行呈现,不占篇幅 */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-gray-800 bg-gray-950/50 px-2.5 py-1.5 text-xs sm:px-3 md:gap-x-3">
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
                className="hidden rounded-md border border-amber-500/40 px-2 py-0.5 hover:bg-amber-500/10 md:inline-block"
              >
                {copiedPreview ? t('common.copied') : t('common.copy')}
              </button>
            </>
          )}
        </span>

        <span className="hidden h-3.5 w-px bg-gray-700 md:block" />

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
              className="hidden rounded-md border border-emerald-500/40 px-2 py-0.5 hover:bg-emerald-500/10 md:inline-block"
            >
              {copied ? t('common.copied') : t('common.copy')}
            </button>
            <button
              onClick={onUnpublish}
              title={t('preview.unpublishTitle')}
              className="hidden rounded-md border border-amber-500/40 px-2 py-0.5 text-amber-300 hover:bg-amber-500/10 md:inline-block"
            >
              {t('projects.unpublish')}
            </button>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-gray-500">
            <span className="h-1.5 w-1.5 rounded-full bg-gray-600" />
            {t('preview.liveNotPublished')}
            <span className="hidden text-gray-600 sm:inline">{t('preview.publishHint')}</span>
          </span>
        )}
      </div>

      {/* 草稿说明:手机上「生成新版本」按钮已经表达同一件事,隐藏整条避免重复占屏 */}
      {viewingDraft && !streaming && (
        <div className="hidden shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-xs text-indigo-300 md:flex">
          <span>{t('preview.draftBanner')}</span>
          <span className="text-indigo-400/70">{t('preview.draftBanner2', { version: nextVersion })}</span>
        </div>
      )}

      {/* 生成中:已有预览 iframe 时也把进度(含免费通道的排队提示)显式挂在顶部,避免只看得到旧预览 */}
      {streaming && progressText && previewUrl && (
        <div className="flex shrink-0 items-center gap-2 border-b border-indigo-500/20 bg-indigo-500/5 px-2.5 py-1.5 text-xs text-indigo-300 sm:px-3 sm:py-2">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-indigo-400" />
          <span className="truncate">{progressText}</span>
        </div>
      )}

      {viewVersion > 0 && viewVersion !== latestVersion && !streaming && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-300 sm:px-3 sm:py-2">
          <span>{t('preview.historyBanner', { view: viewVersion, latest: latestVersion })}</span>
          <span className="hidden text-amber-400/70 sm:inline">
            {t('preview.historyBanner2', { view: viewVersion, latest: latestVersion })}
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-2 md:p-4">
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
                className="h-full min-h-[420px] w-full rounded-xl border border-gray-700 bg-white sm:min-h-[600px]"
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

    </section>
  )
}