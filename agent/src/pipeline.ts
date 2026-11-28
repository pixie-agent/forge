/**
 * 编排流水线(见 docs/FORGE2.md §17.9):把生成过程定义成一份 TeamAI 风格的工作流(子集)。
 *
 * 对齐 Tencent/teamai-cli 的 workflow DSL(MIT),按 Forge 需要裁剪为 JSON 子集:
 *   - 顶层 `schemaVersion: v1alpha1`(演进用)
 *   - `steps[]` 里每步一个 `id`,DAG 边用 `needs: [id…]` 表达(不是独立 edges 数组)
 *   - 每步恰好一个动作:`agent` + `prompt`(子 agent 节点)或 `command: build`(平台构建节点)
 *   - `continue_on_failure` ≈ teamai 的同名字段(步骤失败不判 job 失败)
 *   - `{{变量}}` 模板与 teamai 的 `{{ … }}` 语法一致
 *
 * 护栏(平台文件还原/locale 强制/失败回滚/空转检测)是解释器的一部分,不是节点,
 * 后台改不掉。任一节点非法(含环/悬空 needs)则整份回落内置默认,绝不因脏配置打断生成。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentConfig } from './config.js'
import type { AgentDef, RunRequest } from './types.js'
import { t, type UiLang } from './i18n.js'

/** 节点引用的 agent:命名 agent 名(字符串)或内联定义(对象,与 AgentDef 同形) */
export type AgentRef = string | AgentDef

/** 一个子 agent 节点:独立 pi 会话 + 命名 agent(内置 system prompt + 默认工具集)+ 一段用户提示词 */
export interface PipelineAgentStep {
  id: string
  /** 该节点等待的其它节点 id(teamai 的 `needs`,DAG 边);缺省 = 根节点 */
  needs?: string[]
  /** 引用的 agent:内置 planner|coder|reviewer、agents/ 里的自定义名字,或内联定义对象 */
  agent: AgentRef
  /** 用户提示词(支持 {{变量}} 模板) */
  prompt: string
  /** Forge 扩展:覆盖该 agent 默认工具集,必须 ⊆ {read,bash,edit,write,grep,find,ls} */
  tools?: string[]
  /** 把用户图片作为多模态输入(默认 false) */
  images?: boolean
  /** 该节点收尾正文作为「交付说明」(默认 false;都没标时用最后一个 agent 节点) */
  deliver?: boolean
  /** 0/缺省 = 用剩余总预算 */
  budget_ms?: number
  /** 剩余预算低于它则跳过该节点 */
  min_budget_ms?: number
  /** 该节点开始前上报的进度文案(支持 {{变量}}) */
  progress?: string
  /** 该节点失败不判 job 失败,只记一条告警;依赖它的节点仍会运行(与 teamai 同名字段,语义略收窄) */
  continue_on_failure?: boolean
  /**
   * 类型化输出字段(见 docs/FORGE2.md §17.14):本节点收尾正文里提取的 JSON 对象字段名。
   * 下游用 `{{ steps.<id>.outputs.<field> }}` 消费;另有恒有的 `outputs.summary` = 完整收尾正文。
   */
  output?: string[]
  /** 条件跳过:为真才跑本节点,否则视作已完成(下游照跑)。语法见 docs/FORGE2.md §17.14 */
  if?: string
}

/** 一个构建节点:平台确定性构建(还原平台文件 + setLocale + vite build) */
export interface PipelineBuildStep {
  id: string
  needs?: string[]
  command: 'build'
  /** 失败时回滚到最近一次成功构建的源码(默认 false)。这是「环」语义,DAG 边表达不了,故留作节点属性 */
  rollback?: boolean
  /** 条件跳过(与 agent 节点同语义) */
  if?: string
}

/** 一个人门(HITL)节点(见 docs/FORGE2.md §17.14):暂停等用户确认(approve)或选择(choose) */
export interface PipelineGateStep {
  id: string
  needs?: string[]
  /** approve:确认问题文案(用户在「确认 / 拒绝」之间选) */
  approve?: string
  /** choose:问题 + 选项(≥2 个,用户选其一) */
  choose?: { question: string; options: string[] }
  /** 条件跳过(与 agent/build 节点同语义) */
  if?: string
}

export type PipelineStep = PipelineAgentStep | PipelineBuildStep | PipelineGateStep

/** 流水线定义(teamai workflow 子集;schemaVersion 用于演进,当前仅 v1alpha1) */
export interface PipelineDefinition {
  schemaVersion: 'v1alpha1'
  name: string
  description?: string
  steps: PipelineStep[]
}

export const SCHEMA_VERSION = 'v1alpha1'
/** 复查轮至少要有这么多剩余预算才值得跑 */
export const MIN_POLISH_BUDGET_MS = 30_000

/** 平台认可的编码工具名(pi 内置编码工具全集;powershell 是 Windows 专用,沙箱不可用,不收) */
export const KNOWN_TOOLS = new Set(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'])
const MAX_STEPS = 20
const MAX_STEP_ID = 40
const MAX_PROMPT = 200_000
const MAX_BUDGET_MS = 3_400_000
const MAX_STEP_IF = 200
const MAX_OUTPUT_FIELDS = 10
const OUTPUT_FIELD_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** 内置命名 agent:名字 → 默认工具集(system prompt 改由提示词文件系统加载,见 prompts.ts) */
export interface BuiltinAgent {
  tools: string[]
}
export const AGENTS: Record<'planner' | 'coder' | 'reviewer', BuiltinAgent> = {
  planner: { tools: ['read', 'write'] },
  coder: { tools: ['read', 'bash', 'edit', 'write'] },
  reviewer: { tools: ['read', 'edit', 'write'] },
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** 字符串数组(去重、截断、只留字符串);非数组或含非字符串项返回 undefined */
function strArray(v: unknown, maxItems = 20, maxLen = 60): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: string[] = []
  for (const item of v as unknown[]) {
    if (typeof item !== 'string') return undefined
    const s = item.trim().slice(0, maxLen)
    if (s && !out.includes(s)) out.push(s)
    if (out.length >= maxItems) break
  }
  return out
}

/** 解析 choose 门:{ question, options(≥2) };非法返回 null */
function parseChoose(v: unknown): { question: string; options: string[] } | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const question = str(o.question, 1000).trim()
  if (!question) return null
  const options = strArray(o.options, 10, 60)
  if (!options || options.length < 2) return null
  return { question, options }
}

/** 解析 output 字段表:标识符数组(非空、去重);缺省返回 undefined,非法返回 null */
function parseOutputFields(v: unknown): string[] | null | undefined {
  if (v === undefined) return undefined
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_OUTPUT_FIELDS) return null
  const fields: string[] = []
  for (const item of v as unknown[]) {
    if (typeof item !== 'string') return null
    const f = item.trim()
    if (!OUTPUT_FIELD_RE.test(f)) return null
    if (!fields.includes(f)) fields.push(f)
  }
  return fields.length ? fields : null
}

function parseModelRef(v: unknown): AgentDef['model'] {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 120) : undefined
  const effort = typeof o.effort === 'string' ? o.effort.trim().slice(0, 20) : undefined
  return name || effort ? { name, effort } : undefined
}

/** 解析节点引用的 agent:字符串名或内联对象;非法返回 null(整份回落内置默认) */
function parseAgentRef(v: unknown): AgentRef | null {
  if (typeof v === 'string') {
    const name = v.trim()
    return name ? name : null
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    const systemPrompt = o.systemPrompt === undefined ? undefined : str(o.systemPrompt, MAX_PROMPT)
    // tools 一旦给出就必须是数组且全在白名单内(与 step 级 tools 同一规则,未知工具拒绝而非静默丢弃)
    let tools: string[] | undefined
    if (o.tools !== undefined) {
      if (!Array.isArray(o.tools)) return null
      const mapped = (o.tools as unknown[]).map(String)
      if (mapped.length === 0 || !mapped.every((t) => KNOWN_TOOLS.has(t))) return null
      tools = mapped
    }
    const skills = strArray(o.skills)
    const mcp = strArray(o.mcp)
    const model = parseModelRef(o.model)
    // 至少要给出 systemPrompt 或 tools 之一,否则空定义没有意义(纯名字引用应写成字符串)
    if (systemPrompt === undefined && tools === undefined && skills === undefined && mcp === undefined && model === undefined) {
      return null
    }
    return { systemPrompt, tools, skills, mcp, model }
  }
  return null
}

/**
 * 把后台 JSON 解析成流水线;任一节点非法返回 null(调用方回落内置默认)。
 * 校验:JSON 合法 → schemaVersion = v1alpha1 → steps 非空且 ≤ 上限 → 每步字段合法 → id 唯一、
 * needs 都指向存在的 id、无环。
 */
export function parsePipeline(json: string): PipelineStep[] | null {
  if (!json || !json.trim()) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const def = raw as Record<string, unknown>
  if (def.schemaVersion !== SCHEMA_VERSION) return null
  if (!Array.isArray(def.steps) || def.steps.length === 0 || def.steps.length > MAX_STEPS) return null

  const steps: PipelineStep[] = []
  for (const item of def.steps) {
    if (!item || typeof item !== 'object') return null
    const o = item as Record<string, unknown>
    // id / needs 长度与 Worker 校验一致:超长拒绝而不是截断(截断会让两个不同 id 悄悄撞名)
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    if (!id || id.length > MAX_STEP_ID) return null
    const needs = Array.isArray(o.needs)
      ? (o.needs as unknown[]).map((n) => (typeof n === 'string' ? n.trim() : '')).filter(Boolean)
      : undefined
    if (needs?.some((n) => n.length > MAX_STEP_ID)) return null
    const ifCond = typeof o.if === 'string' ? o.if.trim().slice(0, MAX_STEP_IF) : undefined

    // 动作互斥:每个节点恰好一种 —— 门(approve/choose)/ build(command)/ agent(agent+prompt)
    const isGate = o.approve !== undefined || o.choose !== undefined
    const isBuild = o.command !== undefined
    const isAgent = o.agent !== undefined || o.prompt !== undefined
    if (Number(isGate) + Number(isBuild) + Number(isAgent) !== 1) return null
    // approve 与 choose 也互斥(最多其一)
    if (isGate && o.approve !== undefined && o.choose !== undefined) return null

    // 人门节点:approve(确认)或 choose(选择)
    if (isGate) {
      const approve = o.approve === undefined ? undefined : str(o.approve, 1000).trim()
      if (o.approve !== undefined && !approve) return null
      const choose = o.choose === undefined ? undefined : parseChoose(o.choose)
      if (o.choose !== undefined && !choose) return null
      const step: PipelineGateStep = { id, needs }
      if (approve) step.approve = approve
      if (choose) step.choose = choose
      if (ifCond) step.if = ifCond
      steps.push(step)
      continue
    }

    if (isBuild) {
      if (o.command !== 'build') return null
      const step: PipelineBuildStep = { id, needs, command: 'build', rollback: o.rollback === true }
      if (ifCond) step.if = ifCond
      steps.push(step)
      continue
    }
    const agent = parseAgentRef(o.agent)
    if (!agent) return null
    const prompt = str(o.prompt, MAX_PROMPT)
    if (!prompt) return null
    // tools 一旦给出就必须是数组,且每个都在白名单内 —— 未知工具直接拒绝(整份回落默认),
    // 而非静默丢弃:静默降级会让运营以为工具生效了、实际却没生效。
    let tools: string[] | undefined
    if (o.tools !== undefined) {
      if (!Array.isArray(o.tools)) return null
      const mapped = (o.tools as unknown[]).map(String)
      if (mapped.length === 0 || !mapped.every((t) => KNOWN_TOOLS.has(t))) return null
      tools = mapped
    }
    const output = parseOutputFields(o.output)
    if (output === null) return null
    const step: PipelineAgentStep = {
      id,
      needs,
      agent,
      prompt,
      tools,
      images: o.images === true,
      deliver: o.deliver === true,
      budget_ms: num(o.budget_ms, 0, 0, MAX_BUDGET_MS),
      min_budget_ms: num(o.min_budget_ms, 0, 0, MAX_BUDGET_MS),
      progress: str(o.progress, 200) || undefined,
      continue_on_failure: o.continue_on_failure === true,
    }
    if (output) step.output = output
    if (ifCond) step.if = ifCond
    steps.push(step)
  }
  return topologicalOrder(steps) ? steps : null
}

/**
 * 拓扑排序:Kahn 算法,确定性(按定义顺序取就绪节点)。返回 null 表示 id 重复 / needs 悬空 / 有环。
 * 执行器与 parsePipeline 共用它,保证「校验通过」与「可执行」是同一件事。
 */
export function topologicalOrder(steps: PipelineStep[]): PipelineStep[] | null {
  const byId = new Map<string, PipelineStep>()
  for (const s of steps) {
    if (byId.has(s.id)) return null
    byId.set(s.id, s)
  }
  const indeg = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const s of steps) {
    const ns = s.needs ?? []
    indeg.set(s.id, ns.length)
    for (const n of ns) {
      if (!byId.has(n)) return null
      adj.set(n, [...(adj.get(n) ?? []), s.id])
    }
  }
  const ready = steps.filter((s) => indeg.get(s.id) === 0).map((s) => s.id)
  const order: PipelineStep[] = []
  while (ready.length) {
    const id = ready.shift() as string
    order.push(byId.get(id) as PipelineStep)
    for (const d of adj.get(id) ?? []) {
      const nd = (indeg.get(d) as number) - 1
      indeg.set(d, nd)
      if (nd === 0) ready.push(d)
    }
  }
  return order.length === steps.length ? order : null
}

/**
 * 内置默认编排(原执行流程,以数据形式给出):Planner → Coder → build → Reviewer → rebuild。
 *
 * 这份 JSON 与 agent/orchestration/pipeline.default.json 同内容 —— 后者是**运行时事实源**
 * (改文件即可调试,见 agent/orchestration/AGENTS.md),这里只作读取失败/文件损坏时的兜底。
 * 节点结构与 `needs` 是数据;`{{ plannerPrompt }} / {{ coderPrompt }} / {{ reviewerPrompt }}` 由
 * 提示词文件系统(见 prompts.ts)在运行时解析注入,后台自定义编排则可自由混用
 * idea/note/message/history 等原始变量。budget_ms / progress 这类运行期字段
 * (依赖 config / uiLang)由 defaultPipeline 注入,不落进数据。
 */
export const DEFAULT_PIPELINE: PipelineDefinition = {
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
      min_budget_ms: MIN_POLISH_BUDGET_MS,
      continue_on_failure: true,
    },
    { id: 'rebuild', needs: ['reviewer'], command: 'build', rollback: true },
  ],
}

/** 去掉指定节点,并把它们的 id 从其余节点的 needs 里清除(模式/开关筛选后保持 DAG 一致) */
function without(steps: PipelineStep[], drop: Set<string>): PipelineStep[] {
  return steps
    .filter((s) => !drop.has(s.id))
    .map((s) => (s.needs?.length ? { ...s, needs: s.needs.filter((n) => !drop.has(n)) } : s))
}

/**
 * 从编排目录读取内置默认编排(pipeline.default.json)。
 * 读失败/内容非法时回落硬编码的 DEFAULT_PIPELINE —— 文件是调试事实源,代码兜底保可用。
 */
function loadDefaultSteps(config: AgentConfig): PipelineStep[] {
  const file = join(config.orchestrationDir, 'pipeline.default.json')
  try {
    const steps = parsePipeline(readFileSync(file, 'utf8'))
    if (steps) return steps
    console.error(`[pipeline] ${file} 内容非法,回落硬编码默认编排`)
  } catch (err) {
    console.error(`[pipeline] 读取 ${file} 失败(${err instanceof Error ? err.message : String(err)}),回落硬编码默认编排`)
  }
  return DEFAULT_PIPELINE.steps
}

/**
 * 内置默认编排:从编排目录的 pipeline.default.json 派生(文件损坏才回落 DEFAULT_PIPELINE),
 * 注入运行期字段并按模式/开关筛选 ——
 *  - chat 没有「一句话想法」可规划 → 去掉 planner 节点;
 *  - designReview 开关决定是否保留 Reviewer→rebuild 复查轮(剩余预算不足也去掉)。
 */
export function defaultPipeline(
  config: AgentConfig,
  req: RunRequest,
  uiLang: UiLang,
  remainingMs: () => number,
): PipelineStep[] {
  const drop = new Set<string>()
  if (req.type === 'chat') drop.add('planner')
  const wantPolish = config.designReview === 'always' || (config.designReview === 'generate' && req.type === 'generate')
  if (!wantPolish || remainingMs() < MIN_POLISH_BUDGET_MS) {
    drop.add('reviewer')
    drop.add('rebuild')
  }
  return without(loadDefaultSteps(config), drop).map((s): PipelineStep =>
    s.id === 'reviewer'
      ? { ...(s as PipelineAgentStep), budget_ms: config.polishMaxMs, progress: t(uiLang, 'progress.polish') }
      : s,
  )
}
