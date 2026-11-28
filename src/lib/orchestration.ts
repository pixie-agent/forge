/**
 * 后台「AI 编排助手」:一个入口,用一句自然语言同时改任意/全部编排资源
 * (pipeline / agents / skills / mcp / prompts)。agent 侧一次性补全生成一个多资源 JSON,
 * Worker 用与各保存接口相同的校验逐项把关,并对 skills/prompts 文件树做「在现有树上叠加」。
 * 只产出建议,不落库 —— 前端逐个走原有保存接口(见 docs/FORGE2.md §17.15)。
 */

import type { Env } from '../types'
import { getPlatformPipeline, validatePipelineJson } from './pipeline'
import { agentsInfo, validateAgents } from './agents'
import { mcpInfo, validateMcp } from './mcp'
import { skillsInfo, validateSkillFiles } from './skills'
import { promptEffectiveInfo, validatePromptFiles } from './prompts'
import type { AgentDef, McpConfig } from './agent'

export type OrchestrationResource = 'pipeline' | 'agents' | 'skills' | 'mcp' | 'prompts'

export interface OrchestrationState {
  pipeline: string
  agents: Record<string, AgentDef>
  mcp: McpConfig
  skills: Record<string, string>
  prompts: Record<string, string>
}

export interface OrchestrationChanges {
  pipeline?: string
  agents?: Record<string, AgentDef>
  mcp?: McpConfig
  skills?: Record<string, string>
  prompts?: Record<string, string>
}

export interface ResourceNote {
  resource: OrchestrationResource
  changed: boolean
  valid: boolean
  error: string | null
  /** skills/prompts 相对当前树新增/修改的路径 */
  changedFiles?: string[]
}

export interface SuggestResult {
  summary: string
  changes: OrchestrationChanges
  notes: ResourceNote[]
  valid: boolean
  error: string | null
}

const SYSTEM_PROMPT =
  '你是 Forge 2.0 平台的「编排配置助手」。Forge 把用户的自然语言想法自动生成可上线网站,生成过程由一份可配置的「编排」驱动,共五类资源:流水线(pipeline)、命名 agent 注册表(agents)、技能(skills,文件树)、MCP 服务配置(mcp)、提示词(prompts,文件树)。用户用一句中文描述想要的改动,可能涉及多类资源;你据此输出严格符合下面 schema 的 JSON。'

const RULES: Record<OrchestrationResource, string> = {
  pipeline: `【pipeline 流水线】
JSON 对象:{ "schemaVersion": "v1alpha1", "name": "...", "description": "...", "steps": [...] }
steps 非空,最多 20 个节点。节点字段:
- id 字符串唯一;needs 字符串数组(依赖的前置节点 id,缺省 = 起点)
- 节点类型三选一:
  1) agent 节点:{ id, agent, prompt, ... }。agent = 内置 planner/coder/reviewer 或自定义命名 agent 名,或内联对象 { systemPrompt, tools }。prompt 必填非空,可用模板变量 {{ plannerPrompt }} / {{ coderPrompt }} / {{ reviewerPrompt }} / {{ idea }} / {{ note }} / {{ message }} / {{ history }} / {{ connectors }} / {{ attachments }} / {{ langName }} / {{ langCode }} / {{ localeCode }}
  2) 构建节点:{ id, command: "build", ... }(唯一合法 command 是 "build")
  3) 人门节点:{ id, approve: "确认问题" } 或 { id, choose: { question, options(≥2) } }
- agent 节点可选字段:tools(⊆ {read,bash,edit,write,grep,find,ls})、images、deliver、continue_on_failure、budget_ms/min_budget_ms、output(标识符数组,字段名 ^[a-zA-Z_][a-zA-Z0-9_]*$,≤10)、if(条件跳过)
硬约束:needs 引用必须存在;不能成环。内置默认编排:planner → coder → baseline(build) → reviewer → rebuild(build)。`,
  agents: `【agents 命名 agent 注册表】
JSON 对象(不是数组):{ "<name>": {...} },name 匹配 ^[a-z][a-z0-9_-]*$,最多 50 个。
每个定义字段都可选:systemPrompt(字符串)、tools(数组 ⊆ {read,bash,edit,write,grep,find,ls})、skills(字符串数组)、mcp(字符串数组)、model(对象 {name, effort},预留)。缺省 tools = coder 默认工具集。内置名 planner/coder/reviewer 不必定义。`,
  mcp: `【mcp MCP 服务配置】
JSON 对象:{ "servers": { "<name>": {...} }, "autoEnableCodemode": false },服务名 ^[a-z][a-z0-9_-]*$,最多 50 个。
每个服务:type = "stdio"|"http"(可省略);stdio 用 command/args/env/cwd,http 用 url(外部必须 https)/headers;必须且只能有 command 或 url 之一;exposure = codemode|deferred|direct|hidden(缺省 direct);toolExposure 白名单;description/enabled/timeout 可选。凭证一律写 \${NAME} 引用 Cloud Run 绑定的 Secret,绝不写明文密钥。`,
  skills: `【skills 技能(文件树)】路径 skills/<name>/<file>,name 匹配 ^[a-z][a-z0-9_-]*$,每个技能必须含 SKILL.md。`,
  prompts: `【prompts 提示词(文件树)】路径 shared|system|user/ 下一层 .md;{{变量}} 模板语法要原样保留。`,
}

const OUTPUT_CONTRACT = `【输出格式】只输出一个 JSON 对象,只包含要改的资源(不改的资源省略该键):
{
  "summary": "一句话说明这次改了什么(中文)",
  "pipeline": { ...完整新流水线对象... },
  "agents": { ...完整新注册表对象... },
  "mcp": { ...完整新 MCP 配置对象... },
  "skills": { "skills/<name>/<file>": "...", ... },
  "prompts": { "system/coder.md": "...", ... }
}
pipeline / agents / mcp 给「完整新状态」;skills / prompts 只给「要新增或修改的文件路径 → 完整新内容」。
只输出这个 JSON 本身,不要解释、不要 markdown 代码块、不要前后缀文字。`

function renderFiles(files: Record<string, string>): string {
  const entries = Object.entries(files)
  if (entries.length === 0) return '(空)'
  return entries.map(([p, c]) => `### ${p}\n${c}`).join('\n\n')
}

function buildPrompt(state: OrchestrationState, description: string): string {
  const mcpServers = state.mcp?.servers ?? {}
  return `${RULES.pipeline}

${RULES.agents}

${RULES.mcp}

${RULES.skills}

${RULES.prompts}

${OUTPUT_CONTRACT}

【当前配置】

## pipeline
${state.pipeline.trim() ? state.pipeline : '(空 = 内置默认编排)'}

## agents
${Object.keys(state.agents).length ? JSON.stringify(state.agents, null, 2) : '(空 = 只用内置 planner/coder/reviewer)'}

## mcp
${Object.keys(mcpServers).length ? JSON.stringify(state.mcp, null, 2) : '(空 = 未启用)'}

## skills
${renderFiles(state.skills)}

## prompts(有效树 = 默认 ⊕ 自定义覆盖)
${renderFiles(state.prompts)}

【需求】
${description}`
}

/** 从模型文本里抽出最外层 JSON 对象并美化;抽不出返回 null */
export function extractJsonObject(text: string): string | null {
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const tryParse = (candidate: string): string | null => {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify(parsed, null, 2)
      }
    } catch {
      // 不是合法 JSON,继续尝试
    }
    return null
  }
  const whole = tryParse(s)
  if (whole) return whole
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) return tryParse(s.slice(start, end + 1))
  return null
}

function parseSuggestion(text: string): Record<string, unknown> | null {
  const pretty = extractJsonObject(text)
  if (!pretty) return null
  try {
    const parsed = JSON.parse(pretty)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 把未知值安全转成 {路径: 字符串} 文件树;形状不对返回 null */
function asFileMap(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val !== 'string') return null
    out[k] = val
  }
  return out
}

/** 在现有文件树上叠加提议文件,并记录新增/修改的路径 */
function mergeFiles(current: Record<string, string>, proposed: Record<string, string>): { merged: Record<string, string>; changed: string[] } {
  const merged = { ...current }
  const changed: string[] = []
  for (const [path, content] of Object.entries(proposed)) {
    if (merged[path] !== content) changed.push(path)
    merged[path] = content
  }
  return { merged, changed }
}

function toFileMap(list: { path: string; content: string }[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of list) out[f.path] = f.content
  return out
}

/** 内置命名 agent:流水线里始终可引用的名字,无需在 agents 注册表里定义 */
const BUILTIN_AGENTS = new Set(['planner', 'coder', 'reviewer'])

/** 从技能文件树提取技能名(skills/<name>/…) */
function skillNames(files: Record<string, string>): Set<string> {
  const names = new Set<string>()
  for (const path of Object.keys(files)) {
    const m = /^skills\/([a-z][a-z0-9_-]*)\//.exec(path)
    if (m) names.add(m[1])
  }
  return names
}

/** 从流水线 JSON 里收集「字符串形式的 agent 引用」(内联对象引用不在此列,它自带定义) */
function pipelineAgentRefs(pipelineJson: string): string[] {
  try {
    const def = JSON.parse(pipelineJson) as { steps?: { agent?: unknown }[] }
    if (!Array.isArray(def.steps)) return []
    return def.steps.map((s) => s?.agent).filter((a): a is string => typeof a === 'string')
  } catch {
    return []
  }
}

/**
 * 跨资源引用校验:流水线 → 命名 agent → skills/mcp 是否都能解析到(基于「当前 ⊕ 提议」的有效状态)。
 * 单独校验各资源只能证明「每个资源本身合法」,不能证明组合后可执行 —— 这里补上组合这一层。
 */
function crossReferenceErrors(state: OrchestrationState, changes: OrchestrationChanges): string[] {
  const errors: string[] = []
  const agents = changes.agents ?? state.agents
  const mcp = changes.mcp ?? state.mcp
  const skills = changes.skills ?? state.skills
  const pipelineJson = changes.pipeline ?? state.pipeline

  const knownAgents = new Set<string>([...BUILTIN_AGENTS, ...Object.keys(agents)])
  const knownSkills = skillNames(skills)
  const knownMcp = new Set<string>(Object.keys(mcp?.servers ?? {}))

  for (const ref of pipelineAgentRefs(pipelineJson)) {
    if (!knownAgents.has(ref)) errors.push(`流水线引用了未定义的 agent:${ref}`)
  }
  for (const [name, def] of Object.entries(agents)) {
    for (const s of def.skills ?? []) {
      if (!knownSkills.has(s)) errors.push(`agent ${name} 引用了不存在的技能:${s}`)
    }
    for (const m of def.mcp ?? []) {
      if (!knownMcp.has(m)) errors.push(`agent ${name} 引用了不存在的 MCP 服务:${m}`)
    }
  }
  return errors
}

async function loadState(env: Env): Promise<OrchestrationState> {
  const [pipeline, agents, mcp, skills, prompts] = await Promise.all([
    getPlatformPipeline(env.DB),
    agentsInfo(env),
    mcpInfo(env),
    skillsInfo(env),
    promptEffectiveInfo(env),
  ])
  return {
    pipeline,
    agents: agents.agents,
    mcp: mcp.mcp,
    skills: toFileMap(skills.files),
    prompts: toFileMap(prompts.files),
  }
}

async function callAgent(env: Env, prompt: string): Promise<string> {
  const target = env.AGENT_URL.replace(/\/+$/, '')
  const res = await fetch(`${target}/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Secret': env.AGENT_SECRET },
    body: JSON.stringify({ system: SYSTEM_PROMPT, prompt, maxTokens: 8192 }),
  })
  const raw = await res.text()
  if (!res.ok) {
    let message = ''
    try {
      message = (JSON.parse(raw) as { error?: string }).error ?? ''
    } catch {
      message = raw.slice(0, 200)
    }
    throw new Error(message || `编排助手调用失败(${res.status})`)
  }
  try {
    return (JSON.parse(raw) as { text?: string }).text ?? ''
  } catch {
    return ''
  }
}

/** 自然语言 → 多资源编排建议:逐项校验,skills/prompts 叠加到现有树上(不落库) */
export async function suggestOrchestration(env: Env, description: string): Promise<SuggestResult> {
  const state = await loadState(env)
  const text = await callAgent(env, buildPrompt(state, description))
  const obj = parseSuggestion(text)
  if (!obj) {
    return { summary: '', changes: {}, notes: [], valid: false, error: '模型没有返回可解析的 JSON,请换个说法重试' }
  }

  const summary = typeof obj.summary === 'string' ? obj.summary.trim().slice(0, 500) : ''
  const changes: OrchestrationChanges = {}
  const notes: ResourceNote[] = []
  let firstError: string | null = null
  const mark = (resource: OrchestrationResource, changed: boolean, valid: boolean, error: string | null, changedFiles?: string[]) => {
    if (error && !firstError) firstError = error
    notes.push({ resource, changed, valid, error, changedFiles })
  }

  // pipeline:完整新状态
  if (obj.pipeline !== undefined) {
    const json = typeof obj.pipeline === 'string' ? obj.pipeline : JSON.stringify(obj.pipeline, null, 2)
    const err = validatePipelineJson(json)
    changes.pipeline = json
    mark('pipeline', true, err === null, err)
  } else {
    mark('pipeline', false, true, null)
  }

  // agents:完整新状态
  if (obj.agents !== undefined) {
    const err = validateAgents(obj.agents)
    changes.agents = obj.agents as Record<string, AgentDef>
    mark('agents', true, err === null, err)
  } else {
    mark('agents', false, true, null)
  }

  // mcp:完整新状态
  if (obj.mcp !== undefined) {
    const err = validateMcp(obj.mcp)
    changes.mcp = obj.mcp as McpConfig
    mark('mcp', true, err === null, err)
  } else {
    mark('mcp', false, true, null)
  }

  // skills:叠加到现有树
  if (obj.skills !== undefined) {
    const proposed = asFileMap(obj.skills)
    if (!proposed) {
      mark('skills', true, false, 'skills 必须是 { 路径: 字符串 } 对象')
    } else {
      const { merged, changed } = mergeFiles(state.skills, proposed)
      const err = validateSkillFiles(merged)
      changes.skills = merged
      mark('skills', true, err === null, err, changed)
    }
  } else {
    mark('skills', false, true, null)
  }

  // prompts:叠加到现有树
  if (obj.prompts !== undefined) {
    const proposed = asFileMap(obj.prompts)
    if (!proposed) {
      mark('prompts', true, false, 'prompts 必须是 { 路径: 字符串 } 对象')
    } else {
      const { merged, changed } = mergeFiles(state.prompts, proposed)
      const err = validatePromptFiles(merged)
      changes.prompts = merged
      mark('prompts', true, err === null, err, changed)
    }
  } else {
    mark('prompts', false, true, null)
  }

  if (Object.keys(changes).length === 0) {
    return { summary, changes, notes, valid: false, error: '模型没有产出任何改动,请更具体地描述' }
  }

  // 跨资源引用校验:各资源单独合法 ≠ 组合可执行(流水线引用了不存在的 agent / agent 引用了不存在的技能或 MCP)
  const crossErrors = crossReferenceErrors(state, changes)
  if (crossErrors.length) {
    const msg = `跨资源引用校验失败:${crossErrors.join(';')}`
    if (!firstError) firstError = msg
  }
  return { summary, changes, notes, valid: firstError === null, error: firstError }
}
