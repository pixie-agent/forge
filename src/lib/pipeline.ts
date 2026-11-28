/**
 * 全局编排流水线(teamai workflow 子集,见 docs/FORGE2.md §17.9)。
 *
 * 与模型配置(model_configs)解耦:全平台一份,独立存储、独立后台、独立下发(`body.pipeline` 顶层字段)。
 * 校验在这里只做「结构合法性」(能在保存时给运营明确报错的部分);真正执行时的兜底仍在 agent 侧
 * `parsePipeline` —— 任一节点非法整份回落内置默认,脏配置绝不打断生成。
 */

export const PIPELINE_KEY = 'global'

/** 平台认可的编码工具名(与 agent 侧 pipeline.KNOWN_TOOLS 一致;两份代码不共享模块,须手动同步) */
const KNOWN_TOOLS = new Set(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'])
const MAX_STEPS = 20
const MAX_STEP_ID = 40
const MAX_APPROVE_LEN = 1000
const MAX_CHOOSE_OPTIONS = 10
const MAX_CHOOSE_OPTION_LEN = 60
/** 类型化输出字段上限与命名规则(与 agent 侧 parsePipeline 一致) */
const MAX_OUTPUT_FIELDS = 10
const OUTPUT_FIELD_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** 读取全局流水线 JSON 字符串;未配置/查询失败返回空串(调用方回落 agent 内置默认编排) */
export async function getPlatformPipeline(db: D1Database): Promise<string> {
  try {
    const row = await db
      .prepare('SELECT pipeline_json FROM platform_pipeline WHERE id = ?')
      .bind(PIPELINE_KEY)
      .first<{ pipeline_json: string }>()
    return row?.pipeline_json ?? ''
  } catch (err) {
    console.warn(`[pipeline] 读取全局流水线失败,回落内置默认:${err instanceof Error ? err.message : String(err)}`)
    return ''
  }
}

interface RawStep {
  id?: unknown
  needs?: unknown
  agent?: unknown
  prompt?: unknown
  command?: unknown
  tools?: unknown
  approve?: unknown
  choose?: unknown
  output?: unknown
  if?: unknown
}

/** 校验字符串数组(仅字符串,去重由 agent 侧负责);合法返回 null,非法返回中文错误 */
function validateStrArray(v: unknown, label: string, maxItems = 20): string | null {
  if (!Array.isArray(v)) return `${label} 必须是字符串数组`
  if (v.length > maxItems) return `${label} 最多 ${maxItems} 项`
  for (const item of v as unknown[]) {
    if (typeof item !== 'string' || !item.trim()) return `${label} 只能包含非空字符串`
  }
  return null
}

/** 校验节点引用的 agent(字符串名或内联对象);合法返回 null,非法返回中文错误 */
function validateAgentRef(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() ? null : 'agent 不能是空字符串'
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    if (o.systemPrompt !== undefined && (typeof o.systemPrompt !== 'string' || !o.systemPrompt.trim())) {
      return '内联 agent.systemPrompt 必须是非空字符串'
    }
    if (o.tools !== undefined) {
      if (!Array.isArray(o.tools)) return '内联 agent.tools 必须是字符串数组'
      const tools = (o.tools as unknown[]).map(String)
      if (tools.length === 0 || !tools.every((t) => KNOWN_TOOLS.has(t))) {
        return '内联 agent.tools 必须非空且 ⊆ {read,bash,edit,write,grep,find,ls}'
      }
    }
    for (const key of ['skills', 'mcp'] as const) {
      if (o[key] === undefined) continue
      const err = validateStrArray(o[key], `内联 agent.${key}`)
      if (err) return err
    }
    if (o.model !== undefined) {
      if (!o.model || typeof o.model !== 'object' || Array.isArray(o.model)) return '内联 agent.model 必须是对象'
      const m = o.model as Record<string, unknown>
      for (const key of ['name', 'effort'] as const) {
        if (m[key] !== undefined && typeof m[key] !== 'string') return `内联 agent.model.${key} 必须是字符串`
      }
    }
    if (
      o.systemPrompt === undefined && o.tools === undefined && o.skills === undefined &&
      o.mcp === undefined && o.model === undefined
    ) {
      return '内联 agent 至少要有 systemPrompt 或 tools 之一'
    }
    return null
  }
  return 'agent 必须是字符串(命名 agent)或对象(内联定义)'
}

/**
 * 结构校验:空串 = 内置默认(合法);非空必须符合 teamai workflow 子集,返回中文错误或 null。
 * 与 agent 侧 parsePipeline 保持同一套规则(两份代码不共享模块,须手动同步)。
 */
export function validatePipelineJson(json: string): string | null {
  if (!json.trim()) return null
  let def: unknown
  try {
    def = JSON.parse(json)
  } catch {
    return '编排流水线不是合法的 JSON'
  }
  if (!def || typeof def !== 'object') return '编排流水线必须是 JSON 对象'
  const d = def as Record<string, unknown>
  if (d.schemaVersion !== 'v1alpha1') return 'schemaVersion 必须是 "v1alpha1"'
  if (!Array.isArray(d.steps) || d.steps.length === 0) return 'steps 必须是非空数组'
  if (d.steps.length > MAX_STEPS) return `steps 最多 ${MAX_STEPS} 个节点`

  const ids = new Set<string>()
  const needs = new Map<string, string[]>()
  for (const item of d.steps as RawStep[]) {
    if (!item || typeof item !== 'object') return '每个节点必须是对象'
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id) return '每个节点必须有字符串 id'
    if (id.length > MAX_STEP_ID) return `节点 id 最长 ${MAX_STEP_ID} 个字符:${id.slice(0, 20)}…`
    if (ids.has(id)) return `节点 id 重复:${id}`
    ids.add(id)

    const ns = Array.isArray(item.needs)
      ? (item.needs as unknown[]).map((n) => (typeof n === 'string' ? n.trim() : '')).filter(Boolean)
      : []
    if (ns.some((n) => n.length > MAX_STEP_ID)) return `节点 ${id}:needs 引用的 id 最长 ${MAX_STEP_ID} 个字符`
    needs.set(id, ns)

    // 条件跳过字段(可选):必须是字符串
    if (item.if !== undefined && (typeof item.if !== 'string' || !item.if.trim())) {
      return `节点 ${id}:if 必须是非空字符串`
    }

    // 动作互斥:每个节点恰好一种 —— 门(approve/choose)/ build(command)/ agent(agent+prompt)
    const isGate = item.approve !== undefined || item.choose !== undefined
    const isBuild = item.command !== undefined
    const isAgent = item.agent !== undefined || item.prompt !== undefined
    if (Number(isGate) + Number(isBuild) + Number(isAgent) !== 1) {
      return `节点 ${id}:必须且只能有一种动作(approve/choose、command、或 agent+prompt)`
    }
    // approve 与 choose 也互斥
    if (isGate && item.approve !== undefined && item.choose !== undefined) {
      return `节点 ${id}:approve 与 choose 只能二选一`
    }

    // 人门节点(approve / choose,见 docs/FORGE2.md §17.14)
    if (isGate) {
      if (item.approve !== undefined && (typeof item.approve !== 'string' || !item.approve.trim())) {
        return `节点 ${id}:approve 必须是非空字符串`
      }
      if (item.approve !== undefined && item.approve.trim().length > MAX_APPROVE_LEN) {
        return `节点 ${id}:approve 最长 ${MAX_APPROVE_LEN} 个字符`
      }
      if (item.choose !== undefined) {
        const ch = item.choose as Record<string, unknown>
        if (!ch || typeof ch !== 'object' || Array.isArray(ch)) return `节点 ${id}:choose 必须是对象`
        if (typeof ch.question !== 'string' || !ch.question.trim()) return `节点 ${id}:choose.question 必须是非空字符串`
        const opts = ch.options
        if (!Array.isArray(opts) || opts.length < 2) return `节点 ${id}:choose.options 必须是非空字符串数组且至少 2 项`
        if (opts.length > MAX_CHOOSE_OPTIONS) return `节点 ${id}:choose.options 最多 ${MAX_CHOOSE_OPTIONS} 项`
        if (opts.some((o) => typeof o !== 'string' || !o.trim())) return `节点 ${id}:choose.options 只能包含非空字符串`
        if (opts.some((o) => o.trim().length > MAX_CHOOSE_OPTION_LEN)) {
          return `节点 ${id}:choose.options 每项最长 ${MAX_CHOOSE_OPTION_LEN} 个字符`
        }
      }
      continue
    }

    if (isBuild) {
      if (item.command !== 'build') return `节点 ${id}:command 只支持 "build"`
      continue
    }
    const agentErr = validateAgentRef(item.agent)
    if (agentErr) return `节点 ${id}:${agentErr}`
    if (typeof item.prompt !== 'string' || !item.prompt.trim()) return `节点 ${id}:prompt 不能为空`
    if (item.tools !== undefined && !Array.isArray(item.tools)) return `节点 ${id}:tools 必须是字符串数组`
    if (Array.isArray(item.tools)) {
      const tools = (item.tools as unknown[]).map(String)
      if (tools.length === 0 || !tools.every((t) => KNOWN_TOOLS.has(t))) {
        return `节点 ${id}:tools 必须非空且 ⊆ {read,bash,edit,write,grep,find,ls}`
      }
    }
    // 类型化输出字段(见 docs/FORGE2.md §17.14):非空标识符数组,最多 10 个(重复由 agent 侧去重)
    if (item.output !== undefined) {
      if (!Array.isArray(item.output) || item.output.length === 0 || item.output.length > MAX_OUTPUT_FIELDS) {
        return `节点 ${id}:output 必须是非空字符串数组且最多 ${MAX_OUTPUT_FIELDS} 项`
      }
      for (const f of item.output as unknown[]) {
        if (typeof f !== 'string' || !OUTPUT_FIELD_RE.test(f.trim())) {
          return `节点 ${id}:output 字段名必须匹配 ^[a-zA-Z_][a-zA-Z0-9_]*$`
        }
      }
    }
  }
  for (const ns of needs.values()) {
    for (const n of ns) {
      if (!ids.has(n)) return `needs 引用了不存在的节点:${n}`
    }
  }
  // 拓扑排序判环
  const indeg = new Map<string, number>()
  for (const id of ids) indeg.set(id, (needs.get(id) ?? []).length)
  const ready = [...ids].filter((id) => indeg.get(id) === 0)
  let seen = 0
  while (ready.length) {
    const id = ready.shift() as string
    seen++
    for (const [depId, ns] of needs) {
      if (!ns.includes(id)) continue
      const nd = (indeg.get(depId) as number) - 1
      indeg.set(depId, nd)
      if (nd === 0) ready.push(depId)
    }
  }
  if (seen !== ids.size) return '流水线存在环(needs 依赖成环)'
  return null
}
