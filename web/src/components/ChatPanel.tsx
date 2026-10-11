import { useEffect, useMemo, useRef, useState } from 'react'
import Markdown from './Markdown'
import { collectChangedFiles, parseAgentLog, toolVerb, type AgentToolEvent } from '../lib/agentLog'
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
  /** agent 的原始流式输出(thinking/正文/工具调用),解析成过程事件后友好展示 */
  agentLog: string
  /** 本次任务类型:chat 跳过规划,展示「修改代码 → 构建产物」 */
  jobType: 'generate' | 'chat' | null
  /** 空闲时输入框的提示文案(默认描述想法);用于说明本次修改基于哪个版本 */
  idlePlaceholder?: string
  onSend: (text: string) => void
  /** 失败后的一键重试(重发上一次任务的输入);无失败任务时不传 */
  onRetry?: () => void
}

/** generate 的执行路径(三步) */
const STAGES: { key: StageKey; label: string }[] = [
  { key: 'planning', label: '规划方案' },
  { key: 'coding', label: '编写应用' },
  { key: 'building', label: '构建产物' },
]

/** chat 不做规划,执行路径只有两步 */
const CHAT_STAGES: { key: StageKey; label: string }[] = [
  { key: 'coding', label: '修改代码' },
  { key: 'building', label: '构建产物' },
]

export default function ChatPanel({ messages, plan, streaming, error, stage, elapsed, agentLog, jobType, idlePlaceholder, onSend, onRetry }: Props) {
  const [input, setInput] = useState('')
  const [showProcess, setShowProcess] = useState(false)
  const [showThinking, setShowThinking] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // agent 原始日志 → 结构化过程事件(叙述 / 工具调用 / 思考),纯展示
  const events = useMemo(() => parseAgentLog(agentLog), [agentLog])
  const tools = useMemo(() => events.filter((e): e is AgentToolEvent => e.kind === 'tool'), [events])
  const thinkings = useMemo(
    () => events.filter((e): e is { kind: 'thinking'; text: string } => e.kind === 'thinking').map((e) => e.text),
    [events],
  )
  const changedFiles = useMemo(() => collectChangedFiles(events), [events])
  const lastSay = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.kind === 'say') return e.text
    }
    return ''
  }, [events])
  // 最近一步仍在思考(还没有产生工具调用/正文)→ 显示「思考中…」
  const stillThinking = streaming && events.length > 0 && events[events.length - 1].kind === 'thinking'

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages.length, plan, streaming, error, agentLog])

  function submit() {
    const text = input.trim()
    if (!text || streaming) return
    onSend(text)
    setInput('')
  }

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
    <aside className="flex w-[380px] shrink-0 flex-col border-r border-gray-800 bg-gray-950">
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
        {(streaming || plan || events.length > 0) && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-indigo-200">
                {streaming && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-indigo-400" />}
                <span className="truncate">{plan ? `规划:${plan.name}` : streaming ? '处理中' : '生成过程'}</span>
              </span>
              {streaming ? (
                <span className="shrink-0 text-xs text-gray-400">已 {elapsed}s</span>
              ) : (
                events.length > 0 && (
                  <button
                    onClick={() => setShowProcess((v) => !v)}
                    className="shrink-0 text-xs text-gray-400 hover:text-gray-200"
                  >
                    {showProcess ? '收起 ▾' : '查看生成过程 ▸'}
                  </button>
                )
              )}
            </div>
            {plan?.tagline && <div className="mb-2 text-xs text-gray-400">{plan.tagline}</div>}

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
                      {s.label}
                    </span>
                    {st === 'active' && <span className="text-gray-500">进行中…</span>}
                  </li>
                )
              })}
            </ul>

            {/* agent 过程:叙述气泡 + 工具动作行 + 已改动文件(进行中实时;结束后折叠) */}
            {(streaming || showProcess) && (
              <>
                {lastSay && (
                  <div className="mt-2.5 whitespace-pre-wrap break-words rounded-lg bg-gray-800/60 px-3 py-2 text-xs leading-relaxed text-gray-200">
                    {lastSay}
                  </div>
                )}
                {thinkings.length > 0 && (
                  <div className="mt-2">
                    <button
                      onClick={() => setShowThinking((v) => !v)}
                      className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300"
                    >
                      <span>💭</span>
                      <span>思考过程</span>
                      <span>{showThinking ? '▾' : '▸'}</span>
                      {stillThinking && (
                        <span className="flex items-center gap-1 text-gray-600">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-500" />思考中…
                        </span>
                      )}
                    </button>
                    {showThinking && (
                      <div className="mt-1.5 max-h-40 space-y-1.5 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2 text-xs leading-relaxed text-gray-500">
                        {thinkings.slice(-3).map((t, i) => (
                          <p key={i}>{t}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {tools.length > 0 && (
                  <ul className="mt-2 space-y-1.5 text-xs">
                    {tools.slice(-6).map((t, i) => (
                      <li key={i} className="flex items-center gap-1.5 text-gray-400">
                        {t.status === 'running' ? (
                          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-indigo-400/70 border-t-transparent" />
                        ) : (
                          <span className={`shrink-0 ${t.status === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                            {t.status === 'ok' ? '✓' : '✗'}
                          </span>
                        )}
                        <span className="truncate">
                          {t.status === 'running' ? '正在' : ''}
                          {toolVerb(t.name)}
                          {t.arg ? <span className="text-gray-500"> {t.arg}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {changedFiles.length > 0 && (
                  <div className="mt-2 border-t border-indigo-500/20 pt-1.5 text-xs text-gray-500">
                    已改动 {changedFiles.length} 个文件:<span className="text-gray-400">{changedFiles.slice(-4).join('、')}</span>
                  </div>
                )}
              </>
            )}

            {plan && plan.sections.length > 0 && (
              <div className="mt-3 border-t border-indigo-500/20 pt-2">
                <div className="mb-1.5 text-xs text-gray-400">本次包含的功能</div>
                <ul className="space-y-1 text-xs">
                  {plan.sections.map((s, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className={finishedOk ? 'text-emerald-400' : 'text-indigo-300'}>{finishedOk ? '✓' : '•'}</span>
                      <span className="text-gray-300">
                        <span className="font-medium">{s.title}</span>
                        {s.summary ? <span className="text-gray-500"> · {s.summary}</span> : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {plan && plan.palette.length > 0 && (
              <div className="mt-2 flex gap-1">
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
              <span>本次未完成</span>
            </div>
            <p className="mb-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-red-200/90">{error}</p>
            <p className="mb-2.5 text-xs text-gray-400">积分未扣除。可一键重试,或在下方补充说明后继续。</p>
            {onRetry && !streaming && (
              <button
                onClick={onRetry}
                className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-200 hover:bg-red-500/20"
              >
                ↻ 重试
              </button>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-gray-800 p-3">
        <div className="flex items-end gap-2">
          <textarea
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:opacity-50"
            placeholder={streaming ? '生成中…' : idlePlaceholder ?? '描述你的想法,或提出修改要求…'}
            value={input}
            disabled={streaming}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <button
            onClick={submit}
            disabled={streaming || !input.trim()}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </aside>
  )
}
