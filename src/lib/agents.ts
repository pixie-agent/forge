/**
 * 命名 agent 注册表(见 docs/FORGE2.md §17.11):运营定义额外的命名 agent(name → 定义),
 * 流水线节点用 `"agent": "<name>"` 引用;派发时 Worker 把整份注册表作为 `body.agents` 下发。
 *
 * 存储:复用 PROMPTS R2 桶(编排文本配置的桶),键 `agentset.json` —— 一个 JSON 对象(非 zip):
 * agent 定义是扁平的 name → { systemPrompt?, tools?, skills?, mcp?, model? },不像提示词那样是文件树。
 * 空/非法 = 回落内置 planner/coder/reviewer,脏配置绝不打断生成。
 */

import type { Env } from '../types'
import type { AgentDef } from './agent'

export const AGENTS_OBJECT_KEY = 'agentset.json'
/** 单份注册表字节上限(纯文本,给足余量) */
const MAX_AGENTS_BYTES = 512 * 1024
/** 最多注册多少个命名 agent */
const MAX_AGENTS = 50
/** agent 名长度上限 */
const MAX_AGENT_NAME = 60
/** 与流水线/agent 侧同一套工具白名单 */
const KNOWN_TOOLS = new Set(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'])

/** 校验一份 agents 注册表(后台保存入口);合法返回 null,非法返回中文错误 */
export function validateAgents(value: unknown): string | null {
  if (value === undefined || value === null) return null // 空 = 清空,回落内置默认
  if (typeof value !== 'object' || Array.isArray(value)) return 'agents 必须是对象(name → 定义)'
  if (JSON.stringify(value).length > MAX_AGENTS_BYTES) return 'agents 配置过大(超过 512KB)'
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_AGENTS) return `agents 最多 ${MAX_AGENTS} 个`
  for (const [name, def] of entries) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) return `agent 名必须是 ^[a-z][a-z0-9_-]*$:${name}`
    if (name.length > MAX_AGENT_NAME) return `agent 名过长(>${MAX_AGENT_NAME}):${name}`
    if (!def || typeof def !== 'object' || Array.isArray(def)) return `agent ${name} 的定义必须是对象`
    const d = def as Record<string, unknown>
    if (d.systemPrompt !== undefined && (typeof d.systemPrompt !== 'string' || !d.systemPrompt.trim())) {
      return `agent ${name}.systemPrompt 必须是非空字符串`
    }
    if (d.tools !== undefined) {
      if (!Array.isArray(d.tools)) return `agent ${name}.tools 必须是字符串数组`
      const tools = (d.tools as unknown[]).map(String)
      if (tools.length === 0 || !tools.every((t) => KNOWN_TOOLS.has(t))) {
        return `agent ${name}.tools 必须非空且 ⊆ {read,bash,edit,write,grep,find,ls}`
      }
    }
    for (const key of ['skills', 'mcp'] as const) {
      if (d[key] === undefined) continue
      if (!Array.isArray(d[key])) return `agent ${name}.${key} 必须是字符串数组`
      const arr = d[key] as unknown[]
      if (arr.some((x) => typeof x !== 'string' || !x.trim())) return `agent ${name}.${key} 只能包含非空字符串`
    }
    if (d.model !== undefined) {
      if (!d.model || typeof d.model !== 'object' || Array.isArray(d.model)) return `agent ${name}.model 必须是对象`
      const m = d.model as Record<string, unknown>
      for (const key of ['name', 'effort'] as const) {
        if (m[key] !== undefined && typeof m[key] !== 'string') return `agent ${name}.model.${key} 必须是字符串`
      }
    }
  }
  return null
}

/** 读 R2 里的 agents 注册表;无对象/非法返回 undefined(调用方回落内置默认) */
export async function getAgents(env: Env): Promise<Record<string, AgentDef> | undefined> {
  const obj = await env.PROMPTS.get(AGENTS_OBJECT_KEY)
  if (!obj) return undefined
  const text = await obj.text()
  if (!text.trim()) return undefined
  try {
    const parsed = JSON.parse(text) as unknown
    if (validateAgents(parsed)) return undefined
    return parsed as Record<string, AgentDef>
  } catch {
    return undefined
  }
}

/** 保存 agents 注册表到 R2(覆盖式);空对象 = 清空(回落内置默认) */
export async function putAgents(env: Env, agents: Record<string, AgentDef>): Promise<void> {
  const body = new TextEncoder().encode(JSON.stringify(agents))
  await env.PROMPTS.put(AGENTS_OBJECT_KEY, body, { httpMetadata: { contentType: 'application/json; charset=utf-8' } })
}

/** 后台编辑器所需的当前注册表 + 元信息(始终非空;无配置时为空对象) */
export async function agentsInfo(env: Env): Promise<{
  active: boolean
  updated_at: string | null
  size: number
  agents: Record<string, AgentDef>
}> {
  const obj = await env.PROMPTS.get(AGENTS_OBJECT_KEY)
  let agents: Record<string, AgentDef> = {}
  if (obj) {
    try {
      const parsed = JSON.parse(await obj.text()) as unknown
      if (!validateAgents(parsed)) agents = parsed as Record<string, AgentDef>
    } catch {
      agents = {}
    }
  }
  return { active: !!obj, updated_at: obj?.uploaded.toISOString() ?? null, size: obj?.size ?? 0, agents }
}
