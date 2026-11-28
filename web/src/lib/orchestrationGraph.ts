/**
 * 编排关系模型(纯函数,见 docs/FORGE2.md §17.9–§17.15)。
 *
 * 五类资源各自是一份配置,关系只藏在字符串里:节点的 "agent": "<name>"、agent 的 skills / mcp 数组、
 * prompt 里的 {{ 变量 }}。这里把它们解析成一张「节点 → Agent → 提示词 / 技能 / MCP」的引用图,
 * 并做引用检查(引用缺失、变量未定义、定义了却没人用)。后台关系图与编辑器都用它,规则与
 * agent 侧 pipeline.ts / prompts.ts 的解析一致(两份代码不共享模块,须手动同步)。
 */

export type Resource = 'pipeline' | 'agents' | 'prompts' | 'skills' | 'mcp'

export interface AgentDef {
  systemPrompt?: string
  tools?: string[]
  skills?: string[]
  mcp?: string[]
  model?: { name?: string; effort?: string }
}

export interface McpConfig {
  servers: Record<string, Record<string, unknown>>
  autoEnableCodemode?: boolean
}

export interface FileEntry {
  path: string
  content: string
  size?: number
}

/** 内置命名 agent:无需在注册表里定义,流水线始终可引用;定义在 agent 代码里(AGENTS),后台改不了 */
export const BUILTIN_AGENT_TOOLS: Record<string, string[]> = {
  planner: ['read', 'write'],
  coder: ['read', 'bash', 'edit', 'write'],
  reviewer: ['read', 'edit', 'write'],
}
export const BUILTIN_AGENTS = Object.keys(BUILTIN_AGENT_TOOLS)

/** agent 镜像内置的默认编排;流水线留空时生效(与 agent/orchestration/pipeline.default.json 同内容) */
export const DEFAULT_PIPELINE = {
  schemaVersion: 'v1alpha1',
  name: 'forge-default',
  description: '内置默认编排(原执行流程):Planner → Coder → build → Reviewer → rebuild',
  steps: [
    { id: 'planner', agent: 'planner', prompt: '{{ plannerPrompt }}', images: true },
    { id: 'coder', needs: ['planner'], agent: 'coder', prompt: '{{ coderPrompt }}', images: true, deliver: true },
    { id: 'baseline', needs: ['coder'], command: 'build' },
    {
      id: 'reviewer',
      needs: ['baseline'],
      agent: 'reviewer',
      prompt: '{{ reviewerPrompt }}',
      min_budget_ms: 30000,
      continue_on_failure: true,
    },
    { id: 'rebuild', needs: ['reviewer'], command: 'build', rollback: true },
  ],
}

export const PIPELINE_EXAMPLE = JSON.stringify(DEFAULT_PIPELINE, null, 2)

export type RefKind = 'agent' | 'prompt' | 'skill' | 'mcp'

/** 节点直接用到的一项资源;悬停高亮与「点击打开编辑器」都以它为单位 */
export interface Ref {
  kind: RefKind
  id: string
  label: string
  /** 引用了但配置里不存在 */
  missing?: boolean
  /** 补充说明,如「chat 时用 user/chat.md」 */
  note?: string
}

export type AgentSource = 'builtin' | 'registry' | 'inline' | 'unknown'

export interface GraphStep {
  id: string
  needs: string[]
  kind: 'agent' | 'build' | 'gate'
  /** agent 节点引用的 agent 名;内联定义为 null */
  agentName: string | null
  agentSource: AgentSource
  /** 该 agent 的 tools(显式配置才显示;缺省由 agent 侧决定) */
  tools: string[] | null
  /** 没有文件可回落时为 true(system prompt 完全来自内联或回落 coder) */
  systemPromptFile: Ref | null
  /** 节点模板里直接引用的提示词文件(user/*.md 与 shared/*.md) */
  promptFiles: Ref[]
  /** 模板里引用的上游节点输出 steps.<id>.outputs.* */
  stepRefs: string[]
  skills: Ref[]
  mcp: Ref[]
  /** 本节点用到的全部资源(含 agent 本身),悬停高亮用 */
  refs: Ref[]
  /** 给人看的附加信息:门节点的问题、构建回滚、节点开关等 */
  detail: string
  raw: Record<string, unknown>
}

export type IssueLevel = 'error' | 'warn' | 'info'

export interface Issue {
  level: IssueLevel
  /** 出问题的资源 */
  resource: Resource
  message: string
  /** 点击「定位」跳到哪里 */
  target?: { resource: Resource; focus?: string }
}

export interface Graph {
  usingDefault: boolean
  steps: GraphStep[]
  issues: Issue[]
  /** 提示词文件的上下游:uses = 它引用的文件,usedBy = 引用它的文件,steps = 用到它的节点 */
  promptLinks: Record<string, { uses: string[]; usedBy: string[]; steps: string[] }>
  /** 技能被哪些 agent / 节点用到 */
  skillLinks: Record<string, { agents: string[]; steps: string[] }>
  /** MCP 服务被哪些 agent / 节点用到 */
  mcpLinks: Record<string, { agents: string[]; steps: string[] }>
}

const TEMPLATE_RE = /\{\{\s*([\w.]+)\s*\}\}/g

/** 文本里的模板变量名(去重,按出现顺序) */
export function templateVars(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(TEMPLATE_RE)) out.add(m[1])
  return [...out]
}

/** 文件名 → 变量名:data-sdk → dataSdk;lang-block.generate → langBlockGenerate(与 agent 侧 varName 一致) */
function sharedVarName(path: string): string {
  return path
    .slice('shared/'.length)
    .replace(/\.md$/, '')
    .replace(/[-.]([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

/** 成品提示词变量 → 提示词文件(coderPrompt 按任务类型二选一) */
const PROMPT_VAR_FILES: Record<string, string[]> = {
  plannerPrompt: ['user/planner.md'],
  coderPrompt: ['user/generate.md', 'user/chat.md'],
  reviewerPrompt: ['user/polish.md'],
}

/** agent 侧 prompts.ts 提供给 system/ user/ 模板的全部变量 */
const BASE_VARS = [
  'langName', 'langCode', 'localeCode', 'idea', 'note', 'message', 'ideaWithNote', 'requirement',
  'history', 'connectors', 'attachments', 'briefs',
]
/** 模式变量 → 两份 shared 片段(agent 侧按 generate / chat 二选一) */
const MODE_VAR_FILES: Record<string, string[]> = {
  langBlock: ['shared/lang-block.generate.md', 'shared/lang-block.chat.md'],
  reviewerLang: ['shared/reviewer-lang.generate.md', 'shared/reviewer-lang.chat.md'],
  polishLang: ['shared/polish-lang.generate.md', 'shared/polish-lang.chat.md'],
}
const MODE_VARS = Object.keys(MODE_VAR_FILES)
const RUNTIME_VARS = ['answer', 'answerChoice', ...Object.keys(PROMPT_VAR_FILES)]
/** runner 内部直接使用(不经流水线引用)的提示词文件 */
const INTERNAL_PROMPT_FILES = new Set(['user/delivery-note.md'])

interface RawStep {
  id: string
  needs: string[]
  kind: 'agent' | 'build' | 'gate'
  raw: Record<string, unknown>
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : []
}

/** 拓扑序(Kahn,同层按定义顺序);返回 cycle = true 表示有环,此时原样返回定义顺序 */
function sortSteps(steps: RawStep[]): { order: RawStep[]; cycle: boolean } {
  const ids = new Set(steps.map((s) => s.id))
  const pending = new Map(steps.map((s) => [s.id, s.needs.filter((n) => ids.has(n)).length]))
  const order: RawStep[] = []
  const done = new Set<string>()
  let progressed = true
  while (progressed) {
    progressed = false
    for (const s of steps) {
      if (done.has(s.id) || (pending.get(s.id) ?? 0) > 0) continue
      done.add(s.id)
      order.push(s)
      progressed = true
      for (const t of steps) {
        if (!done.has(t.id) && t.needs.includes(s.id)) pending.set(t.id, (pending.get(t.id) ?? 0) - 1)
      }
    }
  }
  // 成环的节点排在最后:照常展示并高亮,不因为环就消失
  if (done.size !== steps.length) order.push(...steps.filter((s) => !done.has(s.id)))
  return { order, cycle: done.size !== steps.length }
}

function parseSteps(pipeline: string): { steps: RawStep[]; error: string | null } {
  if (!pipeline.trim()) return { steps: [], error: null }
  let def: unknown
  try {
    def = JSON.parse(pipeline)
  } catch {
    return { steps: [], error: '流水线不是合法 JSON,关系图暂按内置默认展示' }
  }
  const rawSteps = (def as { steps?: unknown })?.steps
  if (!Array.isArray(rawSteps)) return { steps: [], error: '流水线缺少 steps 数组,关系图暂按内置默认展示' }
  const steps: RawStep[] = []
  for (const item of rawSteps) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    if (!id) continue
    const isGate = o.approve !== undefined || o.choose !== undefined
    const isBuild = o.command !== undefined
    const kind: RawStep['kind'] = isGate ? 'gate' : isBuild ? 'build' : 'agent'
    steps.push({ id, needs: strArray(o.needs).map((n) => n.trim()), kind, raw: o })
  }
  return { steps, error: null }
}

function gateDetail(raw: Record<string, unknown>): string {
  if (typeof raw.approve === 'string') return raw.approve.trim()
  const ch = raw.choose as { question?: unknown; options?: unknown } | undefined
  if (typeof ch?.question === 'string') {
    const opts = Array.isArray(ch.options) ? ch.options.join(' / ') : ''
    return `${ch.question.trim()}${opts ? `(${opts})` : ''}`
  }
  return ''
}

/** 节点上除主字段外的开关,拼成一句说明 */
function agentDetail(raw: Record<string, unknown>): string {
  const parts: string[] = []
  if (raw.images === true) parts.push('带图片')
  if (raw.deliver === true) parts.push('产出交付说明')
  if (raw.continue_on_failure === true) parts.push('失败不判任务失败')
  if (typeof raw.if === 'string' && raw.if.trim()) parts.push(`条件:${raw.if.trim()}`)
  if (typeof raw.min_budget_ms === 'number') parts.push(`剩余预算 < ${Math.round(raw.min_budget_ms / 1000)}s 跳过`)
  if (Array.isArray(raw.output) && raw.output.length) parts.push(`输出:${raw.output.join(', ')}`)
  return parts.join(' · ')
}

export function buildGraph(input: {
  pipeline: string
  agents: Record<string, AgentDef>
  prompts: FileEntry[]
  skills: FileEntry[]
  mcp: McpConfig
}): Graph {
  const promptPaths = new Set(input.prompts.map((f) => f.path))
  const promptText = new Map(input.prompts.map((f) => [f.path, f.content]))
  const sharedVars = new Map<string, string>()
  for (const path of promptPaths) {
    if (!path.startsWith('shared/')) continue
    const v = sharedVarName(path)
    if (!/^(langBlock|reviewerLang|polishLang)/.test(v)) sharedVars.set(v, path)
  }
  const skillNames = new Set(
    input.skills.map((f) => /^skills\/([^/]+)\//.exec(f.path)?.[1]).filter((n): n is string => !!n)
  )
  const mcpNames = new Set(Object.keys(input.mcp?.servers ?? {}))

  const issues: Issue[] = []
  const parsed = parseSteps(input.pipeline)
  const usingDefault = !input.pipeline.trim()
  if (parsed.error) issues.push({ level: 'error', resource: 'pipeline', message: parsed.error })
  const source: RawStep[] = usingDefault || parsed.error ? parseSteps(JSON.stringify(DEFAULT_PIPELINE)).steps : parsed.steps
  const { order: sorted, cycle } = sortSteps(source)
  if (cycle) {
    issues.push({
      level: 'error',
      resource: 'pipeline',
      message: '流水线的 needs 成环,保存会被拒绝',
      target: { resource: 'pipeline' },
    })
  }
  const ids = new Set(source.map((s) => s.id))
  for (const s of source) {
    for (const n of s.needs) {
      if (!ids.has(n)) {
        issues.push({
          level: 'error',
          resource: 'pipeline',
          message: `节点 ${s.id} 依赖的「${n}」不存在`,
          target: { resource: 'pipeline' },
        })
      }
    }
  }

  /** 解析 agent 引用:名字 → 来源;注册表定义优先于同名提示词文件 */
  const resolve = (s: RawStep): { name: string | null; source: AgentSource; def: AgentDef | null } => {
    const ref = s.raw.agent
    if (typeof ref === 'string' && ref.trim()) {
      const name = ref.trim()
      if ((BUILTIN_AGENTS as readonly string[]).includes(name)) return { name, source: 'builtin', def: null }
      const custom = input.agents[name]
      if (custom) return { name, source: 'registry', def: custom }
      return { name, source: 'unknown', def: null }
    }
    if (ref && typeof ref === 'object') return { name: null, source: 'inline', def: ref as AgentDef }
    return { name: null, source: 'unknown', def: null }
  }

  const steps: GraphStep[] = sorted.map((s) => {
    const refs: Ref[] = []
    let agentName: string | null = null
    let agentSource: AgentSource = 'builtin'
    let tools: string[] | null = null
    let systemPromptFile: Ref | null = null
    const promptFiles: Ref[] = []
    const stepRefs: string[] = []
    const skills: Ref[] = []
    const mcp: Ref[] = []
    let detail = ''

    if (s.kind === 'build') {
      detail = s.raw.rollback === true ? '失败时回滚到最近一次成功构建' : ''
    } else if (s.kind === 'gate') {
      detail = gateDetail(s.raw)
    } else {
      const r = resolve(s)
      agentName = r.name
      agentSource = r.source
      refs.push({
        kind: 'agent',
        id: r.name ?? `inline:${s.id}`,
        label: r.name ?? '内联定义',
        missing: r.source === 'unknown',
        note: r.source === 'unknown' ? '未定义,运行时回落 coder' : undefined,
      })
      if (r.source === 'unknown') {
        issues.push({
          level: 'warn',
          resource: 'pipeline',
          message: `节点 ${s.id} 引用的 agent「${s.raw.agent ?? ''}」没有定义,运行时会回落 coder 默认`,
          target: { resource: 'agents', focus: String(s.raw.agent ?? '') },
        })
      }
      const def = r.def
      if (def?.tools?.length) tools = def.tools
      if (Array.isArray(s.raw.tools)) tools = strArray(s.raw.tools)
      if (!tools && r.source === 'builtin') tools = BUILTIN_AGENT_TOOLS[r.name ?? ''] ?? null

      // system prompt 来源:内联 systemPrompt > system/<name>.md > 回落 coder
      if (!def?.systemPrompt && r.name && promptPaths.has(`system/${r.name}.md`)) {
        systemPromptFile = { kind: 'prompt', id: `system/${r.name}.md`, label: `system/${r.name}.md` }
      } else if (!def?.systemPrompt && promptPaths.has('system/coder.md')) {
        systemPromptFile = {
          kind: 'prompt',
          id: 'system/coder.md',
          label: 'system/coder.md',
          note: r.name ? '未找到同名文件,回落 coder' : undefined,
        }
      }
      if (systemPromptFile) refs.push(systemPromptFile)

      // 节点模板里的变量:成品提示词 / shared 片段 / 上游输出
      const templates = [s.raw.prompt, s.raw.if, s.raw.progress]
        .filter((x): x is string => typeof x === 'string')
        .map(templateVars)
        .flat()
      for (const v of new Set(templates)) {
        const files = PROMPT_VAR_FILES[v]
        if (files) {
          for (const p of files) {
            if (!promptPaths.has(p)) {
              issues.push({
                level: 'warn',
                resource: 'prompts',
                message: `缺少提示词文件 ${p},节点 ${s.id} 的 {{ ${v} }} 会原样保留`,
                target: { resource: 'prompts' },
              })
              continue
            }
            promptFiles.push({
              kind: 'prompt',
              id: p,
              label: p,
              note: files.length > 1 ? (p === 'user/chat.md' ? 'chat 任务' : 'generate 任务') : undefined,
            })
          }
          continue
        }
        const shared = sharedVars.get(v)
        if (shared) {
          promptFiles.push({ kind: 'prompt', id: shared, label: shared, note: `{{ ${v} }}` })
          continue
        }
        const stepVar = /^steps\.([^.]+)\.outputs\./.exec(v)
        if (stepVar) {
          stepRefs.push(stepVar[1])
          if (!ids.has(stepVar[1])) {
            issues.push({
              level: 'warn',
              resource: 'pipeline',
              message: `节点 ${s.id} 引用了不存在节点的输出 steps.${stepVar[1]}`,
              target: { resource: 'pipeline' },
            })
          }
          continue
        }
        if (BASE_VARS.includes(v) || MODE_VARS.includes(v) || RUNTIME_VARS.includes(v)) continue
        issues.push({
          level: 'warn',
          resource: 'pipeline',
          message: `节点 ${s.id} 里的 {{ ${v} }} 不是可用变量,运行时原样保留`,
          target: { resource: 'pipeline' },
        })
      }
      for (const p of promptFiles) refs.push(p)

      // 技能 / MCP:来自 agent 定义(注册表或内联)
      const skillRefs = strArray(def?.skills)
      for (const n of new Set(skillRefs)) {
        const missing = !skillNames.has(n)
        skills.push({ kind: 'skill', id: n, label: n, missing })
      }
      const mcpRefs = strArray(def?.mcp)
      for (const n of new Set(mcpRefs)) {
        const missing = !mcpNames.has(n)
        mcp.push({ kind: 'mcp', id: n, label: n, missing })
      }
      refs.push(...skills, ...mcp)
      // 内联 agent 没有注册表条目,它缺失的技能 / MCP 引用在这里查(注册表的在下面单独查)
      if (r.source === 'inline') {
        for (const ref of [...skills, ...mcp].filter((x) => x.missing)) {
          issues.push({
            level: 'warn',
            resource: ref.kind === 'skill' ? 'skills' : 'mcp',
            message: `节点 ${s.id} 的内联 agent 引用的${ref.kind === 'skill' ? '技能' : 'MCP 服务'}「${ref.id}」不存在,运行时不注入`,
            target: { resource: ref.kind === 'skill' ? 'skills' : 'mcp', focus: ref.id },
          })
        }
      }
      detail = agentDetail(s.raw)
    }
    return {
      id: s.id,
      needs: s.needs,
      kind: s.kind,
      agentName,
      agentSource,
      tools,
      systemPromptFile,
      promptFiles,
      stepRefs,
      skills,
      mcp,
      refs,
      detail,
      raw: s.raw,
    }
  })

  // 注册表 agent 的技能 / MCP 引用(没被流水线用到的也查:定义了就该是对的)
  for (const [name, def] of Object.entries(input.agents)) {
    for (const n of new Set(strArray(def.skills))) {
      if (!skillNames.has(n)) {
        issues.push({
          level: 'warn',
          resource: 'agents',
          message: `agent「${name}」引用的技能「${n}」不存在,运行时不注入`,
          target: { resource: 'agents', focus: name },
        })
      }
    }
    for (const n of new Set(strArray(def.mcp))) {
      if (!mcpNames.has(n)) {
        issues.push({
          level: 'warn',
          resource: 'agents',
          message: `agent「${name}」引用的 MCP 服务「${n}」不存在,运行时不挂载`,
          target: { resource: 'agents', focus: name },
        })
      }
    }
  }

  // 提示词文件之间的上下游 + 变量检查
  const promptLinks: Graph['promptLinks'] = {}
  for (const path of promptPaths) {
    const text = promptText.get(path) ?? ''
    const vars = templateVars(text)
    const uses: string[] = []
    const known = path.startsWith('shared/') ? BASE_VARS : [...BASE_VARS, ...MODE_VARS, ...RUNTIME_VARS, ...sharedVars.keys()]
    for (const v of vars) {
      const shared = [...(sharedVars.has(v) ? [sharedVars.get(v)] : []), ...(MODE_VAR_FILES[v] ?? [])]
      for (const p of shared) if (p && p !== path && promptPaths.has(p)) uses.push(p)
      if (!known.includes(v) && !/^steps\.[^.]+\.outputs\./.test(v)) {
        issues.push({
          level: 'warn',
          resource: 'prompts',
          message: `${path} 里的 {{ ${v} }} 不是可用变量,运行时原样保留`,
          target: { resource: 'prompts', focus: path },
        })
      }
    }
    promptLinks[path] = { uses, usedBy: [], steps: [] }
  }
  for (const [path, link] of Object.entries(promptLinks)) {
    for (const u of link.uses) promptLinks[u]?.usedBy.push(path)
  }
  for (const step of steps) {
    const files = new Set<string>([step.systemPromptFile?.id, ...step.promptFiles.map((p) => p.id)].filter((f): f is string => !!f))
    for (const f of files) {
      if (f && promptLinks[f]) promptLinks[f].steps.push(step.id)
    }
  }
  // 传递:被片段没有直接挂在节点上,它的节点 = 引用它的文件(system / user)的节点
  const stepsOf = (path: string, seen = new Set<string>()): string[] => {
    if (seen.has(path)) return []
    seen.add(path)
    const link = promptLinks[path]
    if (!link) return []
    if (link.steps.length) return link.steps
    return link.usedBy.flatMap((u) => stepsOf(u, seen))
  }
  for (const [path, link] of Object.entries(promptLinks)) link.steps = [...new Set(stepsOf(path))]

  const skillLinks: Graph['skillLinks'] = {}
  const mcpLinks: Graph['mcpLinks'] = {}
  for (const step of steps) {
    const agent = step.agentName ?? `内联@${step.id}`
    for (const r of step.skills) {
      skillLinks[r.id] ??= { agents: [], steps: [] }
      if (!skillLinks[r.id].agents.includes(agent)) skillLinks[r.id].agents.push(agent)
      skillLinks[r.id].steps.push(step.id)
    }
    for (const r of step.mcp) {
      mcpLinks[r.id] ??= { agents: [], steps: [] }
      if (!mcpLinks[r.id].agents.includes(agent)) mcpLinks[r.id].agents.push(agent)
      mcpLinks[r.id].steps.push(step.id)
    }
  }

  // 定义了却没人用(info):不会报错,但运营容易以为生效了
  const usedAgents = new Set(steps.map((s) => s.agentName).filter((n): n is string => !!n))
  for (const name of Object.keys(input.agents)) {
    if (!usedAgents.has(name)) {
      issues.push({
        level: 'info',
        resource: 'agents',
        message: `agent「${name}」已定义,但流水线里没有节点用它`,
        target: { resource: 'agents', focus: name },
      })
    }
  }
  for (const n of skillNames) {
    if (!skillLinks[n]) {
      issues.push({
        level: 'info',
        resource: 'skills',
        message: `技能「${n}」已定义,但没有任何 agent 引用它(不会注入)`,
        target: { resource: 'skills', focus: `skills/${n}/SKILL.md` },
      })
    }
  }
  for (const n of mcpNames) {
    if (!mcpLinks[n]) {
      issues.push({
        level: 'info',
        resource: 'mcp',
        message: `MCP 服务「${n}」已定义,但没有任何 agent 引用它(不会挂载)`,
        target: { resource: 'mcp', focus: n },
      })
    }
  }
  for (const path of promptPaths) {
    if (INTERNAL_PROMPT_FILES.has(path)) continue
    if (promptLinks[path]?.steps.length === 0) {
      issues.push({
        level: 'info',
        resource: 'prompts',
        message: `${path} 当前不会被任何节点用到`,
        target: { resource: 'prompts', focus: path },
      })
    }
  }

  const rank: Record<IssueLevel, number> = { error: 0, warn: 1, info: 2 }
  issues.sort((a, b) => rank[a.level] - rank[b.level])
  return { usingDefault, steps, issues, promptLinks, skillLinks, mcpLinks }
}

export function refKey(r: Ref): string {
  return `${r.kind}:${r.id}`
}
