import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import AdminBar from '../components/AdminBar'
import OrchestrationGraph, { PanelTitle, RESOURCE_LABEL } from '../components/admin/OrchestrationGraph'
import {
  AGENTS_EXAMPLE,
  AgentsHints,
  JsonResourceEditor,
  McpHints,
  MCP_EXAMPLE,
  PipelineHints,
  PromptsEditor,
  SkillsEditor,
  StatusChips,
} from '../components/admin/ResourceEditors'
import SuggestPanel, { type AdoptValue } from '../components/admin/SuggestPanel'
import { api } from '../lib/api'
import {
  BUILTIN_AGENT_TOOLS,
  buildGraph,
  PIPELINE_EXAMPLE,
  type AgentDef,
  type FileEntry,
  type Graph,
  type McpConfig,
  type Resource,
} from '../lib/orchestrationGraph'

/**
 * 编排(单页,见 docs/FORGE2.md §17.9–§17.15):关系图在上、编辑器在下,五类资源共用一份状态 ——
 * 任一编辑器的改动即时反映到关系图与引用检查,保存后下一次任务派发才生效。
 * 中文界面是刻意的:后台面向中文运营,不接 i18n(AGENTS.md §6)。
 */

type View = Resource | 'assistant'
const VIEWS: View[] = ['pipeline', 'agents', 'prompts', 'skills', 'mcp', 'assistant']
const RESOURCES: Resource[] = VIEWS.filter((v): v is Resource => v !== 'assistant')

/** 编辑器里的当前内容(JSON 资源存字符串文本,空串 = 清空回落默认) */
interface State {
  pipeline: string
  agents: string
  mcp: string
  prompts: FileEntry[]
  skills: FileEntry[]
}
type Meta = Record<Resource, { active: boolean; updated_at: string | null }>

const EMPTY: State = { pipeline: '', agents: '', mcp: '', prompts: [], skills: [] }

const VIEW_DOC: Record<View, string> = {
  pipeline: '全平台一份,与模型配置解耦;留空 = agent 内置默认编排。',
  agents: '流水线节点用 "agent": "<name>" 引用;留空 = 只用内置 planner / coder / reviewer。',
  prompts: 'shared/ system/ user/ 下的 .md 模板;保存即归档为新版本。',
  skills: 'skills/<name>/SKILL.md 文件树;要被某个 agent 的 skills 字段引用才会注入。',
  mcp: '声明 agent 可用的外部工具服务;留空 = 不启用。凭证只写 ${NAME} 引用,绝不写明文。',
  assistant: '自然语言 → 编排改动建议。',
}

/** 对象 → 编辑器文本;空对象 = 清空(回落默认) */
function objToJson(v: unknown, emptyCheck: unknown): string {
  return emptyCheck ? JSON.stringify(v, null, 2) : ''
}

/** 编辑器文本 → 对象;解析失败抛错(保存时统一提示) */
function parseObject(text: string, label: string): Record<string, unknown> {
  if (!text.trim()) return {}
  try {
    const v = JSON.parse(text) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object')
    return v as Record<string, unknown>
  } catch {
    throw new Error(`${label}不是合法的 JSON 对象`)
  }
}

function tryParse(text: string): Record<string, unknown> {
  try {
    return parseObject(text, '')
  } catch {
    return {}
  }
}

const sameFiles = (a: FileEntry[], b: FileEntry[]) =>
  a.length === b.length && a.every((f, i) => f.path === b[i]?.path && f.content === b[i]?.content)

export default function AdminOrchestration() {
  const [params, setParams] = useSearchParams()
  const paramView = params.get('r')
  const view: View = VIEWS.includes(paramView as View) ? (paramView as View) : 'pipeline'

  const [state, setState] = useState<State>(EMPTY)
  const [saved, setSaved] = useState<State>(EMPTY)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<Resource | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [promptSel, setPromptSel] = useState<string | null>(null)
  const [skillSel, setSkillSel] = useState<string | null>(null)
  const [adopted, setAdopted] = useState<Resource[]>([])
  const editorRef = useRef<HTMLDivElement>(null)

  const loadAll = useCallback(async () => {
    const [p, a, m, pr, sk] = await Promise.all([
      api<{ pipeline_json: string; updated_at: string | null }>('/api/admin/pipeline'),
      api<{ active: boolean; updated_at: string | null; agents: Record<string, AgentDef> }>('/api/admin/agents'),
      api<{ active: boolean; updated_at: string | null; mcp: McpConfig }>('/api/admin/mcp'),
      api<{ active: boolean; updated_at: string | null; files: FileEntry[] }>('/api/admin/prompts'),
      api<{ active: boolean; updated_at: string | null; files: FileEntry[] }>('/api/admin/skills'),
    ])
    const next: State = {
      pipeline: p.pipeline_json ?? '',
      agents: objToJson(a.agents, Object.keys(a.agents ?? {}).length),
      mcp: objToJson(m.mcp, Object.keys(m.mcp?.servers ?? {}).length),
      prompts: pr.files,
      skills: sk.files,
    }
    setState(next)
    setSaved(next)
    setPromptSel((prev) => prev ?? pr.files[0]?.path ?? null)
    setSkillSel((prev) => prev ?? sk.files[0]?.path ?? null)
    setMeta({
      pipeline: { active: !!p.pipeline_json?.trim(), updated_at: p.updated_at },
      agents: { active: a.active, updated_at: a.updated_at },
      mcp: { active: m.active, updated_at: m.updated_at },
      prompts: { active: pr.active, updated_at: pr.updated_at },
      skills: { active: sk.active, updated_at: sk.updated_at },
    })
  }, [])

  useEffect(() => {
    loadAll()
      .catch((err) => setNotice({ kind: 'error', text: (err as Error).message }))
      .finally(() => setLoading(false))
  }, [loadAll])

  const agents = useMemo(() => tryParse(state.agents) as Record<string, AgentDef>, [state.agents])
  const mcp = useMemo(() => tryParse(state.mcp) as unknown as McpConfig, [state.mcp])
  const graph = useMemo(
    () => buildGraph({ pipeline: state.pipeline, agents, prompts: state.prompts, skills: state.skills, mcp }),
    [state.pipeline, agents, state.prompts, state.skills, mcp]
  )

  const dirty: Record<Resource, boolean> = {
    pipeline: state.pipeline !== saved.pipeline,
    agents: state.agents !== saved.agents,
    mcp: state.mcp !== saved.mcp,
    prompts: !sameFiles(state.prompts, saved.prompts),
    skills: !sameFiles(state.skills, saved.skills),
  }
  const dirtyList = RESOURCES.filter((r) => dirty[r])

  const setView = (next: View) => setParams(next === 'pipeline' ? {} : { r: next }, { replace: true })

  /** 关系图 / 引用检查的「定位」:切到对应编辑器、选中目标、滚到编辑区 */
  const open = (resource: Resource, focus?: string) => {
    setView(resource)
    if (resource === 'prompts' && focus && state.prompts.some((f) => f.path === focus)) setPromptSel(focus)
    if (resource === 'skills' && focus) {
      const path = state.skills.find((f) => f.path === focus || f.path.startsWith(`skills/${focus}/`))?.path
      if (path) setSkillSel(path)
    }
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  /** 保存单个资源;成功后只更新该资源的基线(其它资源未保存的修改不动) */
  const save = async (resource: Resource): Promise<boolean> => {
    setSaving(resource)
    setNotice(null)
    try {
      if (resource === 'pipeline') {
        await api('/api/admin/pipeline', { method: 'PUT', body: { pipeline_json: state.pipeline } })
        setSaved((s) => ({ ...s, pipeline: state.pipeline }))
      } else if (resource === 'agents') {
        await api('/api/admin/agents', { method: 'PUT', body: { agents: parseObject(state.agents, 'agents ') } })
        setSaved((s) => ({ ...s, agents: state.agents }))
      } else if (resource === 'mcp') {
        const parsed = parseObject(state.mcp, 'mcp ')
        await api('/api/admin/mcp', { method: 'PUT', body: { mcp: parsed } })
        setSaved((s) => ({ ...s, mcp: state.mcp }))
      } else {
        const map = Object.fromEntries(state[resource].map((f) => [f.path, f.content]))
        const data = await api<{ active: boolean; updated_at: string | null; files: FileEntry[] }>(`/api/admin/${resource}/save`, {
          method: 'POST',
          body: { files: map },
        })
        setSaved((s) => ({ ...s, [resource]: data.files }))
        setState((s) => ({ ...s, [resource]: data.files }))
        setMeta((m) => (m ? { ...m, [resource]: { active: data.active, updated_at: data.updated_at } } : m))
      }
      if (resource !== 'prompts' && resource !== 'skills') {
        const res = await api<{ active: boolean; updated_at: string | null }>(`/api/admin/${resource}`)
        setMeta((m) => (m ? { ...m, [resource]: { active: res.active, updated_at: res.updated_at } } : m))
      }
      setNotice({ kind: 'ok', text: `${RESOURCE_LABEL[resource]}已保存,下一次任务派发即生效` })
      return true
    } catch (err) {
      setNotice({ kind: 'error', text: `${RESOURCE_LABEL[resource]}保存失败:${(err as Error).message}` })
      return false
    } finally {
      setSaving(null)
    }
  }

  const saveAll = async () => {
    for (const r of dirtyList) {
      if (!(await save(r))) return
    }
  }

  const adopt = (resource: Resource, value: AdoptValue) => {
    if (resource === 'prompts' || resource === 'skills') {
      const map = value as Record<string, string>
      setState((s) => ({ ...s, [resource]: Object.entries(map).map(([path, content]) => ({ path, content })) }))
    } else {
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      setState((s) => ({ ...s, [resource]: text }))
    }
    setAdopted((a) => (a.includes(resource) ? a : [...a, resource]))
  }

  const upsertFile = (resource: 'prompts' | 'skills', path: string, content: string) =>
    setState((s) => {
      const others = s[resource].filter((f) => f.path !== path)
      return { ...s, [resource]: [...others, { path, content }].sort((a, b) => a.path.localeCompare(b.path)) }
    })
  const removeFile = (resource: 'prompts' | 'skills', path: string) =>
    setState((s) => ({ ...s, [resource]: s[resource].filter((f) => f.path !== path) }))

  const discard = () => {
    setState(saved)
    setAdopted([])
    setNotice(null)
  }

  const skillCount = new Set(state.skills.map((f) => f.path.split('/')[1])).size
  const serverCount = Object.keys(mcp?.servers ?? {}).length
  const sub: Record<View, string> = {
    pipeline: graph.usingDefault ? '内置默认' : `${graph.steps.length} 个节点`,
    agents: `${Object.keys(agents).length} 个自定义 + 3 内置`,
    prompts: `${state.prompts.length} 个文件`,
    skills: skillCount ? `${skillCount} 个技能` : '未启用',
    mcp: serverCount ? `${serverCount} 个服务` : '未启用',
    assistant: '一句话改编排',
  }

  const agentSteps = (name: string) => graph.steps.filter((s) => s.agentName === name).map((s) => s.id)

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <AdminBar subtitle="流水线 · Agent · 提示词 · 技能 · MCP" />
      <main className="mx-auto w-full max-w-[96rem] flex-1 space-y-5 px-3 py-5 sm:px-4 sm:py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">编排</h1>
            <p className="mt-1 text-xs text-gray-500">
              流水线、Agent、提示词、技能、MCP 之间的引用关系一目了然;改任意一项,关系图即时更新。保存后下一次任务派发即生效。
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              void loadAll()
                .catch((err) => setNotice({ kind: 'error', text: (err as Error).message }))
                .finally(() => setLoading(false))
            }}
            disabled={loading || !!saving}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:border-gray-500 disabled:opacity-40"
          >
            {loading ? '加载中…' : '刷新'}
          </button>
        </div>

        {notice && (
          <div
            role="status"
            className={`rounded-lg px-3 py-2 text-xs ${notice.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}
          >
            {notice.text}
          </div>
        )}

        {dirtyList.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-2.5">
            <p className="text-xs text-amber-200">
              未保存:{dirtyList.map((r) => RESOURCE_LABEL[r]).join('、')}
              <span className="ml-2 text-amber-200/60">下面的关系图已经反映了这些修改</span>
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={discard} disabled={!!saving} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:border-gray-500 disabled:opacity-40">
                放弃修改
              </button>
              <button type="button" onClick={() => void saveAll()} disabled={!!saving} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-gray-950 hover:bg-amber-400 disabled:opacity-40">
                {saving ? `保存${RESOURCE_LABEL[saving]}中…` : '保存全部'}
              </button>
            </div>
          </div>
        )}

        {loading && state === EMPTY ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : (
          <>
            <OrchestrationGraph graph={graph} dirty={dirty} onOpen={open} />

            <div ref={editorRef} className="grid scroll-mt-4 gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
              <nav aria-label="编排资源" className="flex gap-1 overflow-x-auto lg:flex-col lg:self-start lg:sticky lg:top-4">
                {VIEWS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    aria-current={view === v}
                    className={`flex shrink-0 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm ${
                      view === v ? 'border-indigo-500/50 bg-indigo-500/15 text-gray-100' : 'border-gray-800 text-gray-400 hover:bg-gray-900'
                    } ${v === 'assistant' ? 'lg:mt-3 lg:border-indigo-500/20' : ''}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{RESOURCE_LABEL[v]}</span>
                      <span className="block truncate text-[11px] text-gray-600">{sub[v]}</span>
                    </span>
                    {dirty[v as Resource] && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" aria-label="未保存" />}
                  </button>
                ))}
              </nav>

              <div className="min-w-0 space-y-3">
                {view === 'pipeline' && (
                  <>
                    <PanelTitle title="流水线">{VIEW_DOC.pipeline}</PanelTitle>
                    <JsonResourceEditor
                      value={state.pipeline}
                      onChange={(v) => setState((s) => ({ ...s, pipeline: v }))}
                      onSave={() => save('pipeline')}
                      saving={saving === 'pipeline'}
                      dirty={dirty.pipeline}
                      example={PIPELINE_EXAMPLE}
                      exampleLabel="填入内置默认"
                      clearLabel="清空(内置默认)"
                      effective={PIPELINE_EXAMPLE}
                      effectiveNote="留空 = 任务按这份内置默认编排执行(来自 agent 镜像里的 pipeline.default.json)。想改就点「在此基础上修改」,保存后以你的版本为准。"
                      hints={<PipelineHints />}
                    />
                  </>
                )}

                {view === 'agents' && (
                  <>
                    <PanelTitle title="Agent 注册表">{VIEW_DOC.agents}</PanelTitle>
                    <AgentLinks agents={agents} stepsOf={agentSteps} onStep={(id) => open('pipeline', id)} />
                    <JsonResourceEditor
                      value={state.agents}
                      onChange={(v) => setState((s) => ({ ...s, agents: v }))}
                      onSave={() => save('agents')}
                      saving={saving === 'agents'}
                      dirty={dirty.agents}
                      example={AGENTS_EXAMPLE}
                      exampleLabel="填入示例"
                      clearLabel="清空(内置默认)"
                      effectiveNote="注册表为空:现在只有下面这些内置 agent 可用。这里只放额外的 agent;内置的 planner / coder / reviewer 定义在 agent 代码里,改不了(同名写进来也不会生效)。"
                      hints={<AgentsHints />}
                    />
                  </>
                )}

                {view === 'mcp' && (
                  <>
                    <PanelTitle title="MCP 服务配置">{VIEW_DOC.mcp}</PanelTitle>
                    <McpLinks servers={Object.keys(mcp?.servers ?? {})} links={graph.mcpLinks} onAgent={(a) => (a.startsWith('内联@') ? open('pipeline', a.slice(3)) : open('agents', a))} />
                    <JsonResourceEditor
                      value={state.mcp}
                      onChange={(v) => setState((s) => ({ ...s, mcp: v }))}
                      onSave={() => save('mcp')}
                      saving={saving === 'mcp'}
                      dirty={dirty.mcp}
                      example={MCP_EXAMPLE}
                      exampleLabel="填入示例"
                      clearLabel="清空(不启用)"
                      effectiveNote="未配置 MCP:所有 agent 都不挂载外部工具服务。"
                      hints={<McpHints />}
                    />
                  </>
                )}

                {view === 'prompts' && (
                  <>
                    <PanelTitle title="提示词">{VIEW_DOC.prompts}</PanelTitle>
                    <PromptsEditor
                      active={meta?.prompts.active ?? false}
                      files={state.prompts}
                      saved={saved.prompts}
                      selected={promptSel && state.prompts.some((f) => f.path === promptSel) ? promptSel : null}
                      onSelect={setPromptSel}
                      onChange={(path, content) => upsertFile('prompts', path, content)}
                      onRemove={(path) => removeFile('prompts', path)}
                      onSave={() => save('prompts')}
                      onReload={loadAll}
                      saving={saving === 'prompts'}
                      graph={graph}
                      onOpen={open}
                    />
                  </>
                )}

                {view === 'skills' && (
                  <>
                    <PanelTitle title="技能(Skills)">{VIEW_DOC.skills}</PanelTitle>
                    <SkillsEditor
                      files={state.skills}
                      saved={saved.skills}
                      selected={skillSel && state.skills.some((f) => f.path === skillSel) ? skillSel : null}
                      onSelect={setSkillSel}
                      onChange={(path, content) => upsertFile('skills', path, content)}
                      onRemove={(path) => removeFile('skills', path)}
                      onSave={() => save('skills')}
                      onReload={loadAll}
                      saving={saving === 'skills'}
                      graph={graph}
                      onOpen={open}
                    />
                  </>
                )}

                {view === 'assistant' && <SuggestPanel onAdopt={adopt} adopted={adopted} />}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )

}

function AgentLinks({ agents, stepsOf, onStep }: { agents: Record<string, AgentDef>; stepsOf: (name: string) => string[]; onStep: (id: string) => void }) {
  const row = (name: string, tag: string, tools: string[] | undefined, unused: ReactNode) => {
    const steps = stepsOf(name)
    return (
      <li key={name} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1">
        <span className="font-mono text-gray-200">{name}</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] ${tag === '内置' ? 'bg-gray-800 text-gray-400' : 'bg-indigo-500/15 text-indigo-300'}`}>{tag}</span>
        {tools && <span className="text-gray-600">工具:{tools.join(' · ')}</span>}
        <span className="text-gray-700">←</span>
        <span className="text-gray-500">节点</span>
        {steps.length ? (
          steps.map((id) => (
            <button key={id} type="button" onClick={() => onStep(id)} className="font-mono text-gray-300 hover:text-indigo-300 hover:underline">
              {id}
            </button>
          ))
        ) : (
          <span>{unused}</span>
        )}
      </li>
    )
  }
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-3">
      <p className="mb-1 text-xs text-gray-500">哪些节点在用哪个 agent:</p>
      <ul className="text-xs leading-5">
        {Object.entries(BUILTIN_AGENT_TOOLS).map(([name, tools]) => row(name, '内置', tools, <span className="text-gray-600">当前没有节点用它</span>))}
        {Object.keys(agents).map((name) => row(name, '注册表', agents[name]?.tools, <span className="text-amber-300/80">未被引用</span>))}
      </ul>
    </div>
  )
}

function McpLinks({ servers, links, onAgent }: { servers: string[]; links: Graph['mcpLinks']; onAgent: (a: string) => void }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-3 text-xs leading-6">
      <span className="text-gray-500">MCP 服务被哪些 agent 引用:</span>{' '}
      {servers.length === 0 ? (
        <span className="text-gray-600">未配置</span>
      ) : (
        servers.map((n) => (
          <span key={n} className="mr-3 inline-flex items-center gap-1">
            <span className="font-mono text-cyan-300">{n}</span>
            <span className="text-gray-600">←</span>
            {links[n]?.agents.length ? (
              links[n].agents.map((a) => (
                <button key={a} type="button" onClick={() => onAgent(a)} className="font-mono text-gray-400 hover:text-cyan-300 hover:underline">
                  {a}
                </button>
              ))
            ) : (
              <span className="text-amber-300/80">未被引用</span>
            )}
          </span>
        ))
      )}
    </div>
  )
}
