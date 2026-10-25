import { useEffect, useRef, useState } from 'react'
import Markdown from './Markdown'
import {
  ACCEPT_ATTR,
  SEND_LIMITS,
  STEER_LIMITS,
  formatBytes,
  rejectReason,
  releasePreview,
  toPending,
  totalBytes,
  withPastedName,
  type AttachmentLimits,
  type OutgoingAttachment,
  type PendingAttachment,
} from '../lib/attachments'
import { formatElapsed } from '../lib/format'
import { useT, type DictKey } from '../lib/i18n'
import type { Message, Plan } from '../lib/types'

type StageKey = 'planning' | 'coding' | 'building'

interface Props {
  messages: Message[]
  plan: Plan | null
  streaming: boolean
  error: string
  /** 当前生成阶段(规划/编写/构建),驱动「执行路径」实时走到哪一步 */
  stage: StageKey | null
  elapsed: number
  /** 当前阶段的用户可读进度(如「正在编写 src/App.jsx · 已改动 3 个文件」),只展示关键节点 */
  progressText?: string
  /** 本次任务类型:chat 跳过规划,展示「修改代码 → 构建产物」 */
  jobType: 'generate' | 'chat' | null
  /** 空闲时输入框的提示文案(默认描述想法);用于说明本次修改基于哪个版本 */
  idlePlaceholder?: string
  /** 移动端是否隐藏(工作台用顶部标签在对话/预览间切换;桌面端始终显示) */
  mobileHidden?: boolean
  onSend: (text: string, attachments?: OutgoingAttachment[]) => void
  /**
   * 生成过程中追加要求(steering):任务还在跑时输入的内容走这里,由服务端投递给正在执行的 agent。
   * 不传则生成中输入框保持禁用(旧的纯等待行为)。
   */
  onSteer?: (text: string, attachments?: OutgoingAttachment[]) => Promise<void>
  /** 失败后的一键重试(重发上一次任务的输入);无失败任务时不传 */
  onRetry?: () => void
  /** 从断点继续(仅失败/停止的任务留有快照);不传则卡片上没有该入口 */
  onResume?: () => void
  /** 断点快照里的源码文件数(展示在「从断点继续」按钮旁) */
  resumeFiles?: number | null
  /** 上次任务被用户手动停止且留有断点:展示一张轻量「已停止,可继续」卡片 */
  stoppedResumable?: boolean
  /** 停止当前任务(仅任务进行中传入);不传则发送按钮旁不出现停止入口 */
  onStop?: () => void
  /** 停止请求在途 */
  stopping?: boolean
  /** 输入框上方的「本轮可用外部系统」能力条(由 Workspace 组装成 chip,见 ConnectorChips) */
  connectorsBar?: React.ReactNode
  /**
   * 对话流末尾的「接入外部系统」凭证卡片(由 Workspace 在用户选了某个 provider 后传入)。
   * 卡片自带滚动定位;不传则什么都不渲染。
   */
  credentialCard?: React.ReactNode
}

/** generate 的执行路径(三步) */
const STAGES: { key: StageKey; label: DictKey }[] = [
  { key: 'planning', label: 'chat.stage.planning' },
  { key: 'coding', label: 'chat.stage.coding' },
  { key: 'building', label: 'chat.stage.building' },
]

/** chat 不做规划,执行路径只有两步 */
const CHAT_STAGES: { key: StageKey; label: DictKey }[] = [
  { key: 'coding', label: 'chat.stage.modify' },
  { key: 'building', label: 'chat.stage.building' },
]

/** 对话栏宽度(桌面端):默认比原来的 380px 宽一些,可拖右边缘调节,双击复位 */
const CHAT_WIDTH_KEY = 'forge.chatWidth'
const DEFAULT_CHAT_WIDTH = 460
const MIN_CHAT_WIDTH = 340
const MAX_CHAT_WIDTH = 760
/** 预览区至少留这么宽,拖到边缘也不把右边挤没 */
const PREVIEW_MIN_WIDTH = 360
const DESKTOP_MQ = '(min-width: 768px)'

function clampWidth(w: number): number {
  const maxByViewport = Math.max(MIN_CHAT_WIDTH, window.innerWidth - PREVIEW_MIN_WIDTH)
  return Math.round(Math.min(Math.min(MAX_CHAT_WIDTH, maxByViewport), Math.max(MIN_CHAT_WIDTH, w)))
}

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(CHAT_WIDTH_KEY)
    if (!raw) return DEFAULT_CHAT_WIDTH
    const n = Number(raw)
    return Number.isFinite(n) ? clampWidth(n) : DEFAULT_CHAT_WIDTH
  } catch {
    return DEFAULT_CHAT_WIDTH
  }
}

function storeWidth(w: number): void {
  try {
    localStorage.setItem(CHAT_WIDTH_KEY, String(clampWidth(w)))
  } catch {
    // 隐私模式/存储被禁用:调宽仍然生效,只是不记忆
  }
}

export default function ChatPanel({ messages, plan, streaming, error, stage, elapsed, progressText, jobType, idlePlaceholder, mobileHidden, onSend, onSteer, onRetry, onResume, resumeFiles, stoppedResumable, onStop, stopping, connectorsBar, credentialCard }: Props) {
  const t = useT()
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [attachError, setAttachError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // 对话栏宽度(桌面端),拖右边缘调节;双击复位。持久化到 localStorage,刷新后保持
  const [width, setWidth] = useState(readStoredWidth)
  // 桌面端才把像素宽度写进内联样式;窄屏仍是整屏宽(由 w-full 决定)
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP_MQ).matches)

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ)
    const onChange = () => setDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  /** 拖拽调宽:pointerdown 后跟随横向位移,松手落库;期间禁用文本选中避免拖出蓝底 */
  function startResize(e: React.PointerEvent) {
    if (!desktop) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    let latest = startWidth
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const onMove = (ev: PointerEvent) => {
      latest = clampWidth(startWidth + ev.clientX - startX)
      setWidth(latest)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      storeWidth(latest)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function resetWidth() {
    setWidth(DEFAULT_CHAT_WIDTH)
    storeWidth(DEFAULT_CHAT_WIDTH)
  }

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages.length, plan, streaming, error, progressText])

  /** 生成中追加走的限额更紧(要整行进 D1 投递队列);空闲发送用常规限额 */
  const limits: AttachmentLimits = streaming ? STEER_LIMITS : SEND_LIMITS

  /** 选中/粘贴文件 → 本地校验(类型/单个大小/个数/合计)→ 转 base64 待发送 */
  async function addFiles(files: ArrayLike<File> | null) {
    if (!files?.length) return
    setAttachError('')
    const next = [...attachments]
    let total = totalBytes(next)
    for (const raw of Array.from(files)) {
      const file = withPastedName(raw)
      if (next.length >= limits.maxCount) {
        setAttachError(t('attach.tooMany', { count: limits.maxCount }))
        break
      }
      const reason = rejectReason(file, limits)
      if (reason) {
        setAttachError(reason)
        continue
      }
      if (total + file.size > limits.totalBytes) {
        setAttachError(t('attach.totalTooLarge', { size: formatBytes(limits.totalBytes) }))
        break
      }
      try {
        const pending = await toPending(file)
        next.push(pending)
        total += pending.size
      } catch (err) {
        setAttachError(err instanceof Error ? err.message : t('attach.readFailed'))
      }
    }
    setAttachments(next)
  }

  /**
   * 粘贴:只接管剪贴板里的图片/文件,纯文本粘贴仍走浏览器默认行为。
   * 剪贴板同时带文本与图片时(如从 Excel/Word 复制)**优先文本** —— 那种场景用户要的是文字,
   * 顺手塞进来的截图只会干扰。
   */
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const dt = e.clipboardData
    if (!dt) return
    if (Array.from(dt.types ?? []).includes('text/plain')) return
    const files = Array.from(dt.items ?? [])
      .filter((it) => it.kind === 'file')
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f)
    if (!files.length) return
    e.preventDefault()
    void addFiles(files)
  }

  function removeAttachment(id: string) {
    setAttachments((list) => {
      const hit = list.find((a) => a.id === id)
      if (hit) releasePreview([hit])
      return list.filter((a) => a.id !== id)
    })
    setAttachError('')
  }

  /** 发送/追加:生成中走 steering(交给正在执行的 agent),空闲时走常规发送 */
  async function submit() {
    const text = input.trim()
    if (!text && attachments.length === 0) return
    const outgoing = attachments.length
      ? attachments.map(({ name, mimeType, data }) => ({ name, mimeType, data }))
      : undefined
    if (streaming) {
      if (!onSteer) return
      try {
        await onSteer(text, outgoing)
      } catch (err) {
        // 追加失败:输入与附件原样留着,用户可直接重试
        setAttachError(err instanceof Error ? err.message : t('chat.steerFailed'))
        return
      }
    } else {
      onSend(text, outgoing)
    }
    releasePreview(attachments)
    setAttachments([])
    setAttachError('')
    setInput('')
  }

  // 生成中只要支持 steering 就仍可输入;附件限额随状态切换(追加更紧)
  const canSend = (input.trim().length > 0 || attachments.length > 0) && (!streaming || !!onSteer)

  // 执行路径:chat 用两步、generate 用三步;进行中逐步点亮,失败定位在出错那步,完成后全部打勾
  const steps = jobType === 'chat' ? CHAT_STAGES : STAGES
  const curIdx = Math.max(0, steps.findIndex((s) => s.key === stage))
  function stepState(i: number): 'done' | 'active' | 'pending' | 'failed' {
    if (streaming) return i < curIdx ? 'done' : i === curIdx ? 'active' : 'pending'
    if (error) return i < curIdx ? 'done' : i === curIdx ? 'failed' : 'pending'
    return 'done'
  }
  const finishedOk = !streaming && !error

  return (
    <aside
      className={`${mobileHidden ? 'hidden md:flex' : 'flex'} relative w-full shrink-0 flex-col border-r border-gray-800 bg-gray-950`}
      style={desktop ? { width } : undefined}
    >
      {/* 拖右边缘调宽(仅桌面端);双击复位到默认宽度 */}
      {desktop && (
        <div
          onPointerDown={startResize}
          onDoubleClick={resetWidth}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('chat.resizeAria')}
          title={t('chat.resizeTitle')}
          className="absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-indigo-500/40"
        />
      )}
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' ? (
              <div className="w-full max-w-[95%] rounded-2xl rounded-bl-sm bg-gray-800/70 px-3.5 py-2.5 text-gray-200">
                <Markdown text={m.content} />
              </div>
            ) : (
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-sm text-white">
                {m.content}
              </div>
            )}
          </div>
        ))}

        {/* 执行/过程卡:分步进度 + agent 叙述 + 工具动作;进行中实时展示,结束后可折叠回看 */}
        {(streaming || plan) && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-indigo-200">
                {streaming && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-indigo-400" />}
                <span className="truncate">{plan ? t('chat.planningPrefix', { name: plan.name }) : streaming ? t('chat.processing') : t('chat.processTitle')}</span>
              </span>
              {streaming && <span className="shrink-0 text-xs text-gray-400">{formatElapsed(elapsed, t)}</span>}
            </div>
            {plan?.tagline && <div className="mb-2 hidden text-xs text-gray-400 sm:block">{plan.tagline}</div>}

            <ul className="space-y-1 text-xs">
              {steps.map((s, i) => {
                const st = stepState(i)
                return (
                  <li key={s.key} className="flex items-center gap-1.5">
                    <span
                      className={
                        st === 'done'
                          ? 'text-emerald-400'
                          : st === 'active'
                            ? 'animate-pulse text-indigo-300'
                            : st === 'failed'
                              ? 'text-red-400'
                              : 'text-gray-600'
                      }
                    >
                      {st === 'done' ? '✓' : st === 'failed' ? '✗' : st === 'active' ? '●' : '○'}
                    </span>
                    <span className={st === 'pending' ? 'text-gray-500' : st === 'failed' ? 'text-red-300' : 'text-gray-200'}>
                      {t(s.label)}
                    </span>
                    {st === 'active' && <span className="text-gray-500">{t('chat.stage.active')}</span>}
                  </li>
                )
              })}
            </ul>

            {/* 关键节点只展示「当前在做什么」:阶段 + 正在写的文件 + 已改动文件数,
                原始 thinking / 工具调用留在 Cloud Run 日志里(运维排查用,不打扰用户) */}
            {streaming && progressText && (
              <div className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-400">
                {progressText}
              </div>
            )}

            {plan && plan.sections.length > 0 && (
              <div className="mt-3 border-t border-indigo-500/20 pt-2">
                <div className="mb-1.5 text-xs text-gray-400">{t('chat.features')}</div>
                <ul className="space-y-1 text-xs">
                  {plan.sections.map((s, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className={finishedOk ? 'text-emerald-400' : 'text-indigo-300'}>{finishedOk ? '✓' : '•'}</span>
                      <span className="text-gray-300">
                        <span className="font-medium">{s.title}</span>
                        {s.summary ? <span className="hidden text-gray-500 sm:inline"> · {s.summary}</span> : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {plan && plan.palette.length > 0 && (
              <div className="mt-2 hidden gap-1 sm:flex">
                {plan.palette.map((c, i) => (
                  <span key={i} className="h-3.5 w-3.5 rounded-full border border-white/20" style={{ background: c }} />
                ))}
              </div>
            )}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-red-300">
              <span>⚠️</span>
              <span>{t('chat.jobFailed')}</span>
            </div>
            <p className="mb-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-red-200/90">{error}</p>
            <p className="mb-2.5 text-xs text-gray-400">{t('chat.jobFailedHint')}</p>
            {!streaming && (onRetry || onResume) && (
              <div className="flex flex-wrap items-center gap-2">
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-200 hover:bg-red-500/20"
                  >
                    ↻ {t('chat.retry')}
                  </button>
                )}
                {onResume && (
                  <button
                    onClick={onResume}
                    className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20"
                  >
                    ↩ {t('chat.resume')}
                  </button>
                )}
                {onResume && resumeFiles ? (
                  <span className="text-xs text-gray-400">{t('chat.resumeHint', { count: resumeFiles })}</span>
                ) : null}
              </div>
            )}
          </div>
        )}

        {/* 用户手动停止但留有断点:不判失败,给一个轻量的「接着做」入口 */}
        {stoppedResumable && !streaming && onResume && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-amber-200">
              <span>■</span>
              <span>{t('chat.stoppedTitle')}</span>
            </div>
            <p className="mb-2.5 text-xs leading-relaxed text-amber-100/80">{t('chat.stoppedHint')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={onResume}
                className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20"
              >
                ↩ {t('chat.resume')}
              </button>
              {resumeFiles ? (
                <span className="text-xs text-gray-400">{t('chat.resumeHint', { count: resumeFiles })}</span>
              ) : null}
            </div>
          </div>
        )}

        {/* 接入外部系统的凭证卡片:密钥走独立通道,不进消息、不进 prompt(见 ConnectorCard) */}
        {credentialCard}
      </div>

      <div className="border-t border-gray-800 p-2.5 pb-safe sm:p-3">
        {/* 本轮可用的外部系统(连接器能力条):绑定即默认生效,这里只是临时开关 */}
        {connectorsBar}
        {/* 已选附件:图片给缩略图、文本给图标;逐个可移除 */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="group relative flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 py-1 pl-1 pr-6"
                title={`${a.name} · ${formatBytes(a.size)}`}
              >
                {a.previewUrl ? (
                  <img src={a.previewUrl} alt={a.name} className="h-8 w-8 rounded object-cover" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded bg-gray-800 text-xs text-gray-400">📄</span>
                )}
                <span className="max-w-[140px] truncate text-xs text-gray-300">{a.name}</span>
                <span className="text-[10px] text-gray-500">{formatBytes(a.size)}</span>
                <button
                  onClick={() => removeAttachment(a.id)}
                  aria-label={t('attach.remove', { name: a.name })}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-gray-500 hover:text-red-300"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {attachError && <p className="mb-2 text-xs text-amber-300">{attachError}</p>}

        <div className="flex items-end gap-2">
          {/* 附件入口:图片供模型直接看,文本供 agent 读取;超出上限在下方给提示 */}
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => {
              void addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={(streaming && !onSteer) || attachments.length >= limits.maxCount}
            title={t('attach.addTitle', {
              count: limits.maxCount,
              imageMB: Math.round(limits.imageBytes / 1024 / 1024 * 10) / 10,
              textKB: Math.round(limits.textBytes / 1024),
            })}
            aria-label={t('attach.add')}
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl border border-gray-700 bg-gray-900 text-lg text-gray-400 hover:border-indigo-500 hover:text-gray-200 disabled:opacity-40"
          >
            📎
          </button>
          <textarea
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            placeholder={
              streaming
                ? onSteer
                  ? t('chat.placeholderStreaming')
                  : t('chat.placeholderGenerating')
                : idlePlaceholder ?? t('chat.placeholderIdle')
            }
            value={input}
            readOnly={streaming && !onSteer}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void submit()
              }
            }}
          />
          {streaming && (
            <button
              onClick={onStop}
              disabled={!onStop || stopping}
              title={t('chat.stopTitle')}
              className="rounded-xl border border-gray-600 bg-gray-800 px-3 py-2 text-sm font-medium text-gray-200 hover:border-red-400/60 hover:bg-red-500/10 hover:text-red-200 disabled:opacity-40"
            >
              {stopping ? t('chat.stopping') : `■ ${t('chat.stop')}`}
            </button>
          )}
          {(!streaming || onSteer) && (
            <button
              onClick={() => void submit()}
              disabled={!canSend}
              title={streaming ? t('chat.steerTitle') : t('chat.send')}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {streaming ? t('chat.steer') : t('chat.send')}
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
