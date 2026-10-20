import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../App'
import ChatPanel from '../components/ChatPanel'
import ConnectorCard from '../components/ConnectorCard'
import ConnectorChips, { type ConnectorChip } from '../components/ConnectorChips'
import ConnectorsPanel from '../components/ConnectorsPanel'
import PreviewPane from '../components/PreviewPane'
import TopBar from '../components/TopBar'
import { api, cancelJob, getActiveJob, startJob, steerJob, subscribeJob } from '../lib/api'
import { attachmentMarker, type OutgoingAttachment } from '../lib/attachments'
import { useT } from '../lib/i18n'
import type { ArtifactManifest, JobSnapshot, Message, Plan, Project, ProjectConnectorsResponse, ProjectDetail, ProjectDraft, ProjectVersionDetail, SiteDataEnv, VersionMeta } from '../lib/types'

type FilePreview = { path: string; content: string }

export default function Workspace() {
  const { id } = useParams()
  const [sp, setSp] = useSearchParams()
  const { refresh } = useAuth()
  const t = useT()

  const [project, setProject] = useState<Project | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  // 当前展示版本的可预览状态:构建产物清单 + 源码树 + 草稿预览令牌(iframe 用 /p/:token/)
  const [manifest, setManifest] = useState<ArtifactManifest | null>(null)
  const [src, setSrc] = useState<Record<string, string> | null>(null)
  const [previewToken, setPreviewToken] = useState<string | null>(null)
  // 版本切换:全部正式版本 + 当前展示的版本号(0=草稿,默认有草稿看草稿,否则=当前生效版本)+ 切换中的加载态
  const [versions, setVersions] = useState<VersionMeta[]>([])
  const [viewVersion, setViewVersion] = useState(0)
  // 未确认的草稿(工作副本):非空表示有未生成版本的修改
  const [draft, setDraft] = useState<ProjectDraft | null>(null)
  const [committing, setCommitting] = useState(false)
  // 切换查看历史版本时的加载态(禁用下拉,给出反馈)
  const [switchingVersion, setSwitchingVersion] = useState(false)
  // 轻量成功提示(如"已恢复 v1 为当前版本"),几秒后自动消失
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<'ok' | 'err'>('ok')
  // 生成过程中 agent 实时写入的源文件
  const [filesPreview, setFilesPreview] = useState<FilePreview | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [job, setJob] = useState<JobSnapshot | null>(null)
  const [error, setError] = useState('')
  const [resumeIdea, setResumeIdea] = useState<string | null>(null)
  // 最近一次失败的任务(本次会话内失败,或刷新后从服务端还原):用于渲染"未完成卡片 + 重试"
  const [failedJob, setFailedJob] = useState<JobSnapshot | null>(null)
  // 「停止」请求在途(禁用按钮,避免连点)
  const [stopping, setStopping] = useState(false)
  const started = useRef(false)
  // 移动端:用顶部标签在「对话 / 预览」间切换(桌面端始终左右分栏,该状态不生效)
  const [mobileTab, setMobileTab] = useState<'chat' | 'preview'>('chat')
  // 连接器:两个环境的绑定状态(草稿优先于线上生效)、本轮临时开关(不落库)、管理面板开关
  const [connectorData, setConnectorData] = useState<{ draft: ProjectConnectorsResponse; live: ProjectConnectorsResponse } | null>(null)
  const [connectorOff, setConnectorOff] = useState<string[]>([])
  const [connectorOn, setConnectorOn] = useState<string[]>([])
  const [showConnectors, setShowConnectors] = useState(false)
  /** 正在对话流里展开凭证卡片的 provider(见 ConnectorCard);null = 没有卡片 */
  const [addingProvider, setAddingProvider] = useState<string | null>(null)

  const streaming = !!job && (job.status === 'pending' || job.status === 'running')
  const runningAction = job?.type ?? null
  const elapsed = job?.elapsed ?? 0

  // 成功提示几秒后自动消失
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 3200)
    return () => clearTimeout(t)
  }, [notice])

  /** 拉取项目详情,同步服务端最新状态(版本、消息、预览令牌);返回是否成功,由调用方决定如何提示 */
  const reloadDetail = useCallback(async (): Promise<boolean> => {
    if (!id) return false
    try {
      const detail = await api<ProjectDetail>(`/api/projects/${id}`)
      setProject(detail.project)
      setMessages(detail.messages)
      setVersions(detail.versions ?? [])
      setManifest(detail.manifest)
      setSrc(detail.src)
      setPreviewToken(detail.previewToken)
      setDraft(detail.draft ?? null)
      // 有草稿则默认看草稿(工作副本),否则看当前生效版本
      setViewVersion(detail.draft ? 0 : detail.project.current_version)
      return true
    } catch {
      return false
    }
  }, [id])

  /**
   * 拉取连接器绑定状态(draft 与 live 各一次)。
   * 生成链路是「优先草稿绑定,没有才回落到线上」(见 routes/generate.ts 的 jobConnectorGrants),
   * 所以能力条按同一口径取"草稿优先"的并集,保证用户看到的就是本轮真的会生效的。
   */
  const loadConnectors = useCallback(async (): Promise<{ draft: ProjectConnectorsResponse; live: ProjectConnectorsResponse } | null> => {
    if (!id) return null
    try {
      const [draft, live] = await Promise.all([
        api<ProjectConnectorsResponse>(`/api/projects/${id}/connectors?env=draft`),
        api<ProjectConnectorsResponse>(`/api/projects/${id}/connectors?env=live`),
      ])
      setConnectorData({ draft, live })
      return { draft, live }
    } catch {
      // 连接器是增强能力:拉取失败不影响生成,静默降级为"没有连接器"
      setConnectorData(null)
      return null
    }
  }, [id])

  useEffect(() => {
    void loadConnectors()
  }, [loadConnectors])

  /** 能力条上的 chip:草稿有绑定用草稿,否则用线上的;只读默认亮、可写默认关(见 CONNECTORS.md §7) */
  const connectorChips = useMemo<ConnectorChip[]>(() => {
    if (!connectorData) return []
    const byEnv: Record<SiteDataEnv, Map<string, ProjectConnectorsResponse['providers'][number]>> = {
      draft: new Map(connectorData.draft.providers.map((p) => [p.id, p])),
      live: new Map(connectorData.live.providers.map((p) => [p.id, p])),
    }
    /** 只有"绑定且授权/密钥可用"才算本轮真能生效:绑定在但凭证缺失/撤销的不上能力条(与 resolveGrants 同口径) */
    const usable = (p: ProjectConnectorsResponse['providers'][number]) =>
      Boolean(p.binding) && (p.auth === 'config' || p.binding?.connectionStatus === 'active')
    const chips: ConnectorChip[] = []
    for (const p of connectorData.draft.providers) {
      const boundEnv: SiteDataEnv | null = usable(p) ? 'draft' : byEnv.live.get(p.id) && usable(byEnv.live.get(p.id)!) ? 'live' : null
      if (!boundEnv) continue
      const on = p.writable ? connectorOn.includes(p.id) : !connectorOff.includes(p.id)
      chips.push({ id: p.id, name: p.name, writable: p.writable, env: boundEnv, on })
    }
    return chips
  }, [connectorData, connectorOff, connectorOn])

  const connectorsEnabled = Boolean(connectorData?.draft.enabled && connectorData?.live.enabled)

  /** 「+ 连接」里可选的 provider 列表(草稿环境的定义为准,两环境同一份 provider 定义) */
  const connectorProviders = useMemo(() => connectorData?.draft.providers ?? [], [connectorData])

  /** 当前要展开凭证卡片的 provider 定义;找不到(如 KEK 未配置)就当作没有卡片 */
  const addingProfile = useMemo(
    () => (addingProvider ? connectorProviders.find((p) => p.id === addingProvider) ?? null : null),
    [addingProvider, connectorProviders],
  )

  /**
   * 账号下**已保存过**的该 provider 凭证(跨项目复用)。
   * 连接是账号级的(见 routes/connections.ts),draft / live 两个响应拿到的是同一份列表,取任一份即可。
   * 卡片据此先给「点一下直接接入」,省掉重复贴 key / 重复走授权页。
   */
  const addingReusable = useMemo(() => {
    if (!addingProvider || !connectorData) return []
    return connectorData.draft.connections.filter((c) => c.provider === addingProvider && c.status === 'active')
  }, [addingProvider, connectorData])

  /** 本轮开关 → 请求体:只读的"关掉"进 disabled,可写的"点亮"进 enabled;两者都是本轮的,不落库 */
  const connectorOptions = useMemo(() => {
    if (!connectorChips.length) return undefined
    const ids = new Set(connectorChips.map((c) => c.id))
    return {
      disabled: connectorOff.filter((x) => ids.has(x)),
      enabled: connectorOn.filter((x) => ids.has(x)),
    }
  }, [connectorChips, connectorOff, connectorOn])

  /** 任务收尾:成功则刷新详情与积分,失败则展示错误(幂等:同一任务只结算一次) */
  const settled = useRef(new Set<string>())
  const settle = useCallback(
    async (finished: JobSnapshot) => {
      if (settled.current.has(finished.id)) return
      settled.current.add(finished.id)
      // 本轮结束:连接器的临时开关复位回默认(绑定仍然生效,无需用户重选)
      setConnectorOff([])
      setConnectorOn([])
      if (finished.status === 'failed') {
        // 失败但有产物:记下原想法,后续消息作为补充要求继续该任务;同时保留失败任务用于重试
        if (finished.idea) setResumeIdea(finished.idea)
        setFailedJob(finished)
        setError(finished.error ?? t('ws.generateFailed'))
        return
      }
      if (finished.status === 'cancelled') {
        // 用户主动停止:不是失败,不弹"未完成卡片"。清掉任务态的临时视图(半成品预览、过程中的
        // 规划卡片与执行路径),否则会定格成"三步全打勾"的假成功;再拉一次详情补上服务端写的
        // "已停止"消息。积分未扣,不用 refresh。
        setResumeIdea(null)
        setFailedJob(null)
        setError('')
        setJob(null)
        setPlan(null)
        setFilesPreview(null)
        void reloadDetail()
        return
      }
      setResumeIdea(null)
      setFailedJob(null)
      setPlan((p) => (finished.type === 'generate' && finished.plan ? finished.plan : p))
      // 结果落定依赖这次拉取:瞬时失败退避重试,避免“积分已扣但界面显示失败”
      for (let attempt = 0; ; attempt++) {
        if (await reloadDetail()) break
        if (attempt >= 2) {
          setError(t('ws.syncFailed'))
          return
        }
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
      // 新版本已就绪:清掉流式的临时源码视图,改用已构建产物的预览
      setFilesPreview(null)
      refresh()
    },
    [reloadDetail, refresh, t]
  )

  /** 创建后台任务;服务端已落用户消息,前端本地补一条保证即时反馈 */
  const run = useCallback(
    async (action: 'generate' | 'chat', body: Record<string, unknown>, userText: string) => {
      setError('')
      setFailedJob(null)
      // 新任务开始:凭证卡片(含「已接入」完成态)收起来,它是单轮的一次性痕迹
      setAddingProvider(null)
      const localId = crypto.randomUUID()
      setMessages((m) => [...m, { id: localId, role: 'user', content: userText, created_at: '' }])
      if (action === 'generate') {
        setPlan(null)
        setManifest(null)
        setSrc(null)
        setPreviewToken(null)
        setFilesPreview(null)
      }
      try {
        const { jobId } = await startJob(`/api/projects/${id}/${action}`, body)
        setResumeIdea(null)
        setJob({
          id: jobId,
          type: action,
          status: 'pending',
          stage: 'planning',
          progress: null,
          files_preview: null,
          agent_log: null,
          idea: action === 'generate' ? String(body.idea ?? '') || null : null,
          prompt: String(body.idea ?? body.message ?? '') || null,
          plan: null,
          error: null,
          version: null,
          elapsed: 0,
        })
      } catch (err) {
        setError((err as Error).message)
        // 只按 id 回滚刚插入的本地消息,不影响历史里同文的消息
        setMessages((m) => m.filter((x) => x.id !== localId))
      }
    },
    [id]
  )

  /** 订阅任务进度:SSE 推送、断线自动降级轮询都在 subscribeJob 内部处理;终态时结算 */
  useEffect(() => {
    if (!job || !streaming) return
    const apply = (next: JobSnapshot) => {
      setJob(next)
      if (next.plan) setPlan(next.plan)
      // 流式看代码:agent 每写完一个文件就更新这里
      if (next.files_preview) setFilesPreview(next.files_preview)
      if (next.status === 'succeeded' || next.status === 'failed' || next.status === 'cancelled') void settle(next)
    }
    // 进度彻底拿不到(会话过期/持续断网):结束任务态并提示,避免输入被永久禁用
    return subscribeJob(job.id, apply, (message) => {
      setJob(null)
      setError(message)
    })
  }, [job?.id, streaming, settle])

  /** 当前生成阶段的用户可读文案:优先展示 agent 写入的分段进度,无则按 stage 推导 */
  const stageText = !streaming || !runningAction
    ? ''
    : job?.progress
      ? job.progress
      : runningAction === 'chat'
        ? t('ws.stage.chat')
        : job?.stage === 'coding' || plan
          ? t('ws.stage.coding')
          : job?.stage === 'building'
            ? t('ws.stage.building')
            : t('ws.stage.planning')

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const [detail, { job: active, resume }] = await Promise.all([
          api<ProjectDetail>(`/api/projects/${id}`),
          getActiveJob(id),
        ])
        if (cancelled) return
        setProject(detail.project)
        setMessages(detail.messages)
        setVersions(detail.versions ?? [])
        setManifest(detail.manifest)
        setSrc(detail.src)
        setPreviewToken(detail.previewToken)
        setDraft(detail.draft ?? null)
        setViewVersion(detail.draft ? 0 : detail.project.current_version)
        // 断线/刷新恢复:有进行中的任务则接管订阅;此时项目被任务占用,?idea 自动重发只会 409,故跳过
        if (active) {
          setJob(active)
          if (active.plan) setPlan(active.plan)
          if (active.files_preview) setFilesPreview(active.files_preview)
          return
        }
        // 失败续聊恢复:上次任务失败但有产物,恢复卡片与半成品预览,后续消息将继续该任务
        if (resume) {
          setResumeIdea(resume.idea)
          setFailedJob(resume)
          if (resume.error) setError(resume.error)
          if (resume.plan) setPlan(resume.plan)
          if (resume.files_preview) setFilesPreview(resume.files_preview)
        }
        // 连接器 OAuth 回调回来时带的结果提示(见 routes/connections.ts 的 backToWorkspace)
        const connected = sp.get('connected')
        const connectorError = sp.get('connector_error')
        if (connected || connectorError) {
          const fresh = await loadConnectors()
          if (connected) {
            const profile = fresh?.draft.providers.find((p) => p.id === connected) ?? fresh?.live.providers.find((p) => p.id === connected)
            const name = profile?.name ?? connected
            const missing = profile?.binding?.missing ?? []
            if (missing.length) {
              // 授权成功但必填配置还差(如 GA4 的 propertyId):半截能力递下去只会让 agent 白跑,
              // 所以这里直接把面板打开,让用户补完再生成(与 resolveGrants 的跳过口径一致)
              setNoticeTone('err')
              setNotice(t('ws.conn.missing', { name, fields: missing.join(t('chat.listSep')) }))
              setShowConnectors(true)
            } else if (profile?.writable) {
              setNoticeTone('ok')
              setNotice(t('ws.conn.writable', { name }))
            } else {
              setNoticeTone('ok')
              setNotice(t('ws.conn.readonly', { name }))
            }
          } else {
            setNoticeTone('err')
            setNotice(t('ws.conn.failed', { reason: connectorError ?? '' }))
          }
        }
        const idea = sp.get('idea')
        if (idea && detail.project.current_version === 0 && !started.current) {
          started.current = true
          setSp({}, { replace: true })
          void run('generate', { idea }, idea)
        } else if (connected || connectorError) {
          setSp({}, { replace: true })
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  /** 发布指定版本上线(默认传入当前预览的版本);生成不会自动上线,必须经此确认 */
  async function publish(version: number) {
    if (!id || !project || version < 1) return
    try {
      const data = await api<{ slug: string; url: string; published_version: number }>(
        `/api/projects/${id}/publish`,
        { method: 'POST', body: { version } }
      )
      setProject((p) => (p ? { ...p, status: 'published', slug: data.slug, published_version: data.published_version } : p))
      setNoticeTone('ok')
      setNotice(t('ws.published', { version: data.published_version }))
      window.open(data.url, '_blank')
    } catch (err) {
      setNoticeTone('err')
      setNotice((err as Error).message)
    }
  }

  /** 下线:公开页立即 404,版本/源码/数据保留,可随时重新发布 */
  async function unpublish() {
    if (!id || !project) return
    if (!confirm(t('ws.confirmUnpublish'))) return
    try {
      await api(`/api/projects/${id}/unpublish`, { method: 'POST' })
      setProject((p) => (p ? { ...p, status: 'draft' } : p))
      setNoticeTone('ok')
      setNotice(t('ws.unpublished'))
    } catch (err) {
      setNoticeTone('err')
      setNotice((err as Error).message)
    }
  }

  /** 统一的发送入口:有内容(草稿或正式版本)→对话修改;失败但有产物→带补充说明续跑;否则全新生成 */
  const send = useCallback(
    (text: string, attachments?: OutgoingAttachment[]) => {
      // 允许「只发附件」:后端要求 idea/message 非空,这里补一句默认说明
      const finalText = text || (attachments?.length ? t('ws.attachmentDefault') : '')
      if (!finalText) return
      const body = { attachments: attachments?.length ? attachments : undefined, connectors: connectorOptions }
      // 本地消息与服务端落库用同一段附件清单,刷新前后显示一致
      const userText = finalText + attachmentMarker(attachments)
      if (draft || (project?.current_version ?? 0) > 0) void run('chat', { message: finalText, ...body }, userText)
      else if (resumeIdea) void run('generate', { idea: resumeIdea, note: finalText, ...body }, userText)
      else void run('generate', { idea: finalText, ...body }, userText)
    },
    [draft, project?.current_version, resumeIdea, run, connectorOptions, t]
  )

  /**
   * 生成中追加要求(steering):任务还在跑时输入的内容不再排队等下一个任务,而是投给正在执行的
   * agent,由它在下一次 LLM 调用前注入(见 docs/FORGE2.md §5.2)。服务端只对活动任务受理,
   * 任务刚好结束时返回 409 —— 这时退化成正常发送,别让用户白打一段话。
   */
  const steer = useCallback(
    async (text: string, attachments?: OutgoingAttachment[]) => {
      if (!id || !job) return
      const finalText = text || (attachments?.length ? t('ws.attachmentDefault') : '')
      if (!finalText) return
      try {
        await steerJob(id, { jobId: job.id, message: finalText, attachments })
      } catch (err) {
        if ((err as Error & { status?: number }).status === 409) {
          send(finalText, attachments)
          return
        }
        throw err
      }
      // 本地补一条用户消息即时反馈;任务收尾时 reloadDetail 会用服务端记录整体替换,不会重复
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: 'user', content: finalText + attachmentMarker(attachments), created_at: '' },
      ])
    },
    [id, job, send, t]
  )

  /** 一键重试:原样重发上一次失败任务的输入(chat→再对话,generate→重新生成) */
  const retry = useCallback(() => {
    const text = failedJob?.prompt?.trim()
    if (!failedJob || !text) return
    if (failedJob.type === 'chat') void run('chat', { message: text }, text)
    else void run('generate', { idea: text }, text)
  }, [failedJob, run])

  /**
   * 停止当前任务。成功后不用自己改状态:服务端已落成 cancelled,SSE/轮询马上会把终态推来,
   * 由 settle 统一收尾(清任务态视图 + 补"已停止"消息)。调用失败(任务刚好已结束)只提示。
   */
  const stopTask = useCallback(async () => {
    if (!id || stopping) return
    setStopping(true)
    try {
      await cancelJob(id)
      setNoticeTone('ok')
      setNotice(t('ws.stopped'))
    } catch (err) {
      setNoticeTone('err')
      setNotice((err as Error).message)
    } finally {
      setStopping(false)
    }
  }, [id, stopping, t])

  /** 切换查看内容:0=草稿(工作副本),>0=历史正式版本(按需拉取源码树+产物清单+预览令牌) */
  async function selectVersion(no: number) {
    if (!id || streaming) return
    setSwitchingVersion(true)
    try {
      if (no === 0 || (project && no === project.current_version)) {
        await reloadDetail()
        return
      }
      const d = await api<{ version: ProjectVersionDetail }>(`/api/projects/${id}/versions/${no}`)
      setManifest(d.version.manifest)
      setSrc(d.version.src)
      setPreviewToken(d.version.previewToken)
      setViewVersion(d.version.version_no)
      setFilesPreview(null)
    } catch (err) {
      setNoticeTone('err')
      setNotice((err as Error).message)
    } finally {
      setSwitchingVersion(false)
    }
  }

  /** 生成新版本(人工确认):把当前草稿快照为正式版本;这是「生成版本需人工确认」的确认动作 */
  async function commitVersion() {
    if (!id || !draft) return
    setCommitting(true)
    try {
      const data = await api<{ version: number }>(`/api/projects/${id}/commit`, { method: 'POST' })
      await reloadDetail()
      setNoticeTone('ok')
      setNotice(t('ws.versionCommitted', { version: data.version }))
    } catch (err) {
      setNoticeTone('err')
      setNotice((err as Error).message)
    } finally {
      setCommitting(false)
    }
  }

  const currentVersion = project?.current_version ?? 0
  // 有草稿:在草稿上继续改;否则有正式版本:基于它改草稿;都没有:全新生成
  const idlePlaceholder = draft
    ? t('ws.idleDraft')
    : currentVersion > 0
      ? t('ws.idleVersion', { version: currentVersion })
      : undefined

  return (
    <div className="flex h-dvh flex-col bg-gray-950 text-gray-100">
      <TopBar />
      {notice && (
        <div
          className={`pointer-events-none fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg ${
            noticeTone === 'err' ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          {notice}
        </div>
      )}
      {/* 移动端:对话 / 预览 切换标签(桌面端隐藏,两块并排显示) */}
      <div className="flex shrink-0 border-b border-gray-800 bg-gray-950 md:hidden">
        {(['chat', 'preview'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium ${
              mobileTab === tab ? 'border-b-2 border-indigo-500 text-gray-100' : 'text-gray-400'
            }`}
          >
            {tab === 'chat' ? t('nav.chat') : t('nav.preview')}
            {tab === 'chat' && streaming && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        <ChatPanel
          mobileHidden={mobileTab !== 'chat'}
          messages={messages}
          plan={plan}
          streaming={streaming}
          error={error}
          stage={job?.stage ?? failedJob?.stage ?? null}
          elapsed={elapsed}
          agentLog={job?.agent_log ?? failedJob?.agent_log ?? ''}
          jobType={job?.type ?? failedJob?.type ?? null}
          idlePlaceholder={idlePlaceholder}
          onSend={send}
          onRetry={failedJob && !streaming ? retry : undefined}
          onStop={streaming ? () => void stopTask() : undefined}
          stopping={stopping}
          connectorsBar={
            <ConnectorChips
              chips={connectorChips}
              providers={connectorProviders}
              enabled={connectorsEnabled}
              locked={streaming}
              onToggle={(pid, next) => {
                // 可写:点亮 = 进 enabled(默认关);只读:默认亮,关掉 = 进 disabled
                const writable = connectorChips.find((c) => c.id === pid)?.writable
                if (writable) {
                  setConnectorOn((l) => (next ? (l.includes(pid) ? l : [...l, pid]) : l.filter((x) => x !== pid)))
                } else {
                  setConnectorOff((l) => (next ? l.filter((x) => x !== pid) : l.includes(pid) ? l : [...l, pid]))
                }
              }}
              onPick={(pid) => setAddingProvider(pid)}
              onOpenPanel={() => setShowConnectors(true)}
            />
          }
          credentialCard={
            addingProfile ? (
              <ConnectorCard
                key={addingProfile.id}
                projectId={id ?? ''}
                provider={addingProfile}
                reusable={addingReusable}
                jobRunning={streaming}
                onSaved={async (providerName) => {
                  const writable = addingProfile?.writable ?? false
                  await loadConnectors()
                  setNoticeTone('ok')
                  setNotice(
                    writable
                      ? t('ws.conn.writable', { name: providerName })
                      : t('ws.conn.readonly', { name: providerName }),
                  )
                }}
                onClose={() => setAddingProvider(null)}
              />
            ) : null
          }
        />
        <PreviewPane
          mobileHidden={mobileTab !== 'preview'}
          previewToken={previewToken}
          manifest={manifest}
          src={src}
          streaming={streaming}
          progressText={stageText ? `${stageText} · ${t('chat.elapsed', { seconds: elapsed })}` : ''}
          agentLog={job?.agent_log ?? ''}
          filesPreview={filesPreview}
          project={project}
          versions={versions}
          viewVersion={viewVersion}
          currentVersion={currentVersion}
          hasDraft={!!draft}
          committing={committing}
          switchingVersion={switchingVersion}
          onSelectVersion={(n) => void selectVersion(n)}
          onCommit={() => void commitVersion()}
          onPublish={(v) => void publish(v)}
          onUnpublish={unpublish}
          onOpenConnectors={() => setShowConnectors(true)}
          connectorCount={connectorChips.length}
        />
      </div>
      {showConnectors && (
        <ConnectorsPanel
          projectId={id ?? ''}
          data={connectorData}
          onClose={() => setShowConnectors(false)}
          onChanged={loadConnectors}
        />
      )}
    </div>
  )
}