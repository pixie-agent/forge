import { useState, type ReactNode } from 'react'
import {
  refKey,
  type AgentSource,
  type Graph,
  type GraphStep,
  type Issue,
  type Ref,
  type Resource,
} from '../../lib/orchestrationGraph'

/**
 * 编排关系图:按执行顺序把每个节点摊成一行 —— 节点 → 执行的 Agent → 用到的提示词 → 技能 / MCP。
 * 悬停任一资源,高亮用到它的节点;点击,跳到对应编辑器。右侧是引用检查(缺失 / 未定义 / 没人用)。
 * 配色只用产品主题里已有的色阶(灰 / 香槟金 / 琥珀 / 翠绿 / 天蓝):主题会把 indigo 重映射成香槟金。
 * 中文界面是刻意的:后台面向中文运营,不接 i18n(AGENTS.md §6)。
 */

interface Props {
  graph: Graph
  dirty: Record<Resource, boolean>
  onOpen: (resource: Resource, focus?: string) => void
}

const TONE: Record<string, string> = {
  builtin: 'border-gray-600 bg-gray-800 text-gray-300',
  registry: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200',
  inline: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  prompt: 'border-gray-700 bg-gray-900 text-gray-300',
  skill: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  mcp: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  neutral: 'border-gray-700 bg-gray-800/60 text-gray-400',
  bad: 'border-red-500/40 bg-red-500/10 text-red-300',
}

const KIND_LABEL: Record<GraphStep['kind'], string> = { agent: 'agent 节点', build: '构建节点', gate: '人门节点' }
const SOURCE_LABEL: Record<AgentSource, string> = {
  builtin: '内置',
  registry: '注册表',
  inline: '内联',
  unknown: '未定义',
}

function toneOf(ref: Ref): string {
  if (ref.missing) return TONE.bad
  if (ref.kind === 'agent') return ref.id.startsWith('inline:') ? TONE.inline : TONE.registry
  return TONE[ref.kind] ?? TONE.neutral
}

interface ChipProps {
  tone: string
  label: string
  note?: string
  title?: string
  mono?: boolean
  active?: boolean
  onClick?: () => void
  onEnter?: () => void
  onLeave?: () => void
}

function Chip({ tone, label, note, title, mono, active, onClick, onEnter, onLeave }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      title={title ?? (onClick ? `${label}${note ? ` — ${note}` : ''}(点击打开编辑器)` : label)}
      className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-xs leading-5 transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
        onClick ? 'cursor-pointer hover:brightness-125' : 'cursor-default'
      } ${tone} ${active ? 'ring-2 ring-indigo-400' : ''}`}
    >
      <span className={`truncate ${mono ? 'font-mono' : ''}`}>{label}</span>
      {note && <span className="shrink-0 text-[11px] opacity-70">{note}</span>}
    </button>
  )
}

function RefChip({ ref, active, onOpen, onEnter, onLeave }: {
  ref: Ref
  active: boolean
  onOpen: () => void
  onEnter: () => void
  onLeave: () => void
}) {
  return (
    <Chip
      tone={toneOf(ref)}
      label={ref.label}
      note={ref.note}
      mono={ref.kind !== 'agent'}
      active={active}
      onClick={onOpen}
      onEnter={onEnter}
      onLeave={onLeave}
    />
  )
}

const COLUMNS = 'grid-cols-[2.25rem_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)]'

export default function OrchestrationGraph({ graph, dirty, onOpen }: Props) {
  const [active, setActive] = useState<string | null>(null)
  const clear = () => setActive(null)

  /** 悬停资源 → 高亮用到它的节点;悬停节点 → 只留它自己 */
  const lit = (step: GraphStep): boolean => {
    if (!active) return true
    if (active.startsWith('step:')) return active === `step:${step.id}`
    return step.refs.some((r) => refKey(r) === active)
  }

  const counts = { error: 0, warn: 0, info: 0 }
  for (const i of graph.issues) counts[i.level]++
  const dirtyAny = Object.values(dirty).some(Boolean)

  return (
    <section aria-labelledby="orch-graph-title" className="rounded-2xl border border-gray-800 bg-gray-900/30">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-800 p-4">
        <div>
          <h2 id="orch-graph-title" className="text-base font-semibold text-gray-100">
            执行关系
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            {graph.usingDefault ? '流水线为空,当前按 agent 内置默认编排执行' : `自定义流水线,共 ${graph.steps.length} 个节点`}
            {dirtyAny && <span className="ml-2 text-amber-300">(含未保存的修改)</span>}
          </p>
          {graph.usingDefault && (
            <p className="mt-1 text-xs text-gray-600">改稿(chat)任务不跑 planner;关闭复查或剩余预算不足时不跑 reviewer → rebuild。</p>
          )}
        </div>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500" aria-label="图例">
          {(['builtin', 'registry', 'inline', 'prompt', 'skill', 'mcp'] as const).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-sm border ${TONE[k]}`} />
              {{ builtin: '内置 agent', registry: '注册表 agent', inline: '内联 agent', prompt: '提示词', skill: '技能', mcp: 'MCP' }[k]}
            </li>
          ))}
          <li className="text-gray-600">悬停高亮用到它的节点,点击打开编辑器</li>
        </ul>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="overflow-x-auto" onMouseLeave={clear}>
          <div className="min-w-[56rem]">
            <div className={`grid gap-x-4 border-b border-gray-800/70 px-1 pb-2 text-[11px] uppercase tracking-wide text-gray-500 ${COLUMNS}`}>
              <span aria-hidden="true" />
              <span>节点(按执行顺序)</span>
              <span>执行的 Agent</span>
              <span>用到的提示词</span>
              <span>技能 / MCP</span>
            </div>

            {graph.steps.map((step, i) => {
              const prev = graph.steps[i - 1]
              const next = graph.steps[i + 1]
              const fromPrev = !!prev && step.needs.includes(prev.id)
              const toNext = !!next && next.needs.includes(step.id)
              const dim = !lit(step)
              return (
                <div key={step.id} className={`grid gap-x-4 py-2 transition-opacity ${COLUMNS} ${dim ? 'opacity-30' : ''}`}>
                  {/* 序号 + 依赖连线 */}
                  <div className="relative flex justify-center">
                    {fromPrev && <span className="absolute top-0 h-1/2 w-px bg-gray-700" />}
                    {!fromPrev && i > 0 && <span className="absolute top-0 h-1/2 w-px bg-gray-800/60" />}
                    <span
                      className={`relative z-10 mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border text-[11px] ${
                        step.kind === 'gate' ? 'border-amber-500/50 bg-amber-500/15 text-amber-300' : 'border-gray-700 bg-gray-950 text-gray-400'
                      }`}
                    >
                      {i + 1}
                    </span>
                    {i < graph.steps.length - 1 && (
                      <span className={`absolute bottom-0 h-[calc(50%-0.875rem)] w-px ${toNext ? 'bg-gray-700' : 'bg-gray-800/60'}`}>
                        {toNext && <span className="absolute -bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 border-b border-r border-gray-500" />}
                      </span>
                    )}
                  </div>

                  {/* 节点 */}
                  <div
                    className="min-w-0"
                    onMouseEnter={() => setActive(`step:${step.id}`)}
                    onMouseLeave={clear}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-sm font-semibold text-gray-100">{step.id}</span>
                      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-400">{KIND_LABEL[step.kind]}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-gray-500">
                      依赖:{step.needs.length ? step.needs.join('、') : '起点'}
                    </p>
                    {step.detail && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-gray-400" title={step.detail}>
                        {step.detail}
                      </p>
                    )}
                  </div>

                  {/* Agent */}
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {step.kind === 'agent' && step.refs[0] && (
                      <>
                        <RefChip
                          ref={step.refs[0]}
                          active={active === refKey(step.refs[0])}
                          onOpen={() => onOpen('agents', step.agentName ?? undefined)}
                          onEnter={() => setActive(refKey(step.refs[0]))}
                          onLeave={clear}
                        />
                        <span className="text-[11px] text-gray-600">{SOURCE_LABEL[step.agentSource]}</span>
                        {step.tools && (
                          <span className="w-full text-[11px] text-gray-500" title="该 agent 的工具集">
                            工具:{step.tools.join(' · ')}
                          </span>
                        )}
                      </>
                    )}
                    {step.kind === 'build' && <Chip tone={TONE.neutral} label="平台构建" note="vite build" />}
                    {step.kind === 'gate' && (
                      <Chip tone={TONE.inline} label="等待用户确认" note={typeof step.raw.choose === 'object' ? '选择' : '确认'} />
                    )}
                  </div>

                  {/* 提示词 */}
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {step.systemPromptFile && (
                      <RefChip
                        ref={step.systemPromptFile}
                        active={active === refKey(step.systemPromptFile)}
                        onOpen={() => onOpen('prompts', step.systemPromptFile?.id)}
                        onEnter={() => step.systemPromptFile && setActive(refKey(step.systemPromptFile))}
                        onLeave={clear}
                      />
                    )}
                    {step.promptFiles.map((r) => (
                      <RefChip
                        key={refKey(r)}
                        ref={r}
                        active={active === refKey(r)}
                        onOpen={() => onOpen('prompts', r.id)}
                        onEnter={() => setActive(refKey(r))}
                        onLeave={clear}
                      />
                    ))}
                    {step.kind !== 'agent' && <Dash />}
                  </div>

                  {/* 技能 / MCP */}
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {step.skills.length + step.mcp.length === 0 ? (
                      <Dash />
                    ) : (
                      [...step.skills, ...step.mcp].map((r) => (
                        <RefChip
                          key={refKey(r)}
                          ref={r}
                          active={active === refKey(r)}
                          onOpen={() => onOpen(r.kind === 'skill' ? 'skills' : 'mcp', r.id)}
                          onEnter={() => setActive(refKey(r))}
                          onLeave={clear}
                        />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <Issues issues={graph.issues} counts={counts} onOpen={onOpen} />
      </div>
    </section>
  )
}

function Dash() {
  return <span className="text-xs text-gray-700">—</span>
}

const LEVEL_STYLE: Record<Issue['level'], { dot: string; label: string }> = {
  error: { dot: 'bg-red-400', label: '错误' },
  warn: { dot: 'bg-amber-400', label: '告警' },
  info: { dot: 'bg-gray-500', label: '未使用' },
}

function Issues({ issues, counts, onOpen }: { issues: Issue[]; counts: Record<Issue['level'], number>; onOpen: Props['onOpen'] }) {
  const [filter, setFilter] = useState<'all' | Issue['level']>('all')
  const shown = issues.filter((i) => filter === 'all' || i.level === filter)
  const filterBtn = (key: 'all' | Issue['level'], label: string, n: number) => (
    <button
      type="button"
      onClick={() => setFilter(key)}
      aria-pressed={filter === key}
      className={`rounded-md px-2 py-0.5 text-xs ${
        filter === key ? 'bg-gray-800 text-gray-100' : n === 0 ? 'cursor-default text-gray-700' : 'text-gray-500 hover:text-gray-300'
      }`}
    >
      {label} {n}
    </button>
  )

  return (
    <aside className="self-start rounded-xl border border-gray-800 bg-gray-950/40 p-3" aria-labelledby="orch-issues-title">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id="orch-issues-title" className="text-sm font-semibold text-gray-200">
          引用检查
        </h3>
        <div className="flex items-center gap-0.5">
          {filterBtn('all', '全部', issues.length)}
          {filterBtn('error', '错误', counts.error)}
          {filterBtn('warn', '告警', counts.warn)}
          {filterBtn('info', '未使用', counts.info)}
        </div>
      </div>
      {issues.length === 0 ? (
        <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">所有引用都能解析,没有闲置资源。</p>
      ) : (
        <ul className="max-h-[26rem] space-y-1.5 overflow-y-auto pr-1">
          {shown.map((issue, i) => (
            <li key={`${issue.level}-${i}`} className="flex items-start gap-2 rounded-lg bg-gray-900/70 px-2.5 py-2">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL_STYLE[issue.level].dot}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-5 text-gray-300">{issue.message}</p>
                {issue.target && (
                  <button
                    type="button"
                    onClick={() => onOpen(issue.target!.resource, issue.target!.focus)}
                    className="mt-0.5 text-[11px] text-indigo-300 hover:text-indigo-200 hover:underline"
                  >
                    定位到{RESOURCE_LABEL[issue.target.resource]}
                  </button>
                )}
              </div>
            </li>
          ))}
          {shown.length === 0 && <li className="px-2 py-3 text-xs text-gray-600">这一类没有条目。</li>}
        </ul>
      )}
    </aside>
  )
}

export const RESOURCE_LABEL: Record<Resource | 'assistant', string> = {
  pipeline: '流水线',
  agents: 'Agent',
  prompts: '提示词',
  skills: '技能',
  mcp: 'MCP',
  assistant: 'AI 助手',
}

/** 编辑器里文件上方的上下游关系条:列出它用到谁、被谁用 */
export function LinkStrip({ title, items }: { title: string; items: { label: string; onClick?: () => void }[] }) {
  return (
    <p className="mb-2 text-[11px] leading-5 text-gray-500">
      <span className="text-gray-600">{title}:</span>{' '}
      {items.length === 0 ? (
        <span className="text-gray-600">—</span>
      ) : (
        items.map((it, i) => (
          <span key={`${it.label}-${i}`}>
            {i > 0 && <span className="text-gray-700"> · </span>}
            {it.onClick ? (
              <button type="button" onClick={it.onClick} className="font-mono text-indigo-300 hover:underline">
                {it.label}
              </button>
            ) : (
              <span className="font-mono text-gray-400">{it.label}</span>
            )}
          </span>
        ))
      )}
    </p>
  )
}

export function PanelTitle({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold text-gray-100">{title}</h2>
      {children && <p className="mt-1 text-xs leading-5 text-gray-500">{children}</p>}
    </div>
  )
}
