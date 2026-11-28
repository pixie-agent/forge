/**
 * MCP 服务配置(见 docs/FORGE2.md §17.13):运营声明 agent 可用的外部工具服务(stdio 命令 / http 服务),
 * 派发时作为 body.mcp 下发;agent 用 pi createMcpExtension 接线,工具以 mcp__<server>__<tool> 暴露,
 * 并按 agent 声明的 mcp 子集启用。凭证纪律照搬 connectors(§6b):密钥只走 ${NAME} 环境变量引用
 * (绑在 Cloud Run 上的 Secret),绝不写明文进配置;stdio 服务 = 沙箱内任意代码执行,启用前需安全评审。
 *
 * 存储:复用 PROMPTS R2 桶,键 mcpset.json —— 一个 JSON 对象(非 zip),与 agentset.json 同构。
 * 空/非法 = 不启用 MCP,脏配置绝不打断生成。
 */

import type { Env } from '../types'
import type { McpConfig } from './agent'

export const MCP_OBJECT_KEY = 'mcpset.json'
const MAX_MCP_BYTES = 256 * 1024
const MAX_MCP_SERVERS = 50
const MAX_MCP_NAME = 60
const EXPOSURES = new Set(['codemode', 'deferred', 'direct', 'hidden'])
/** 完整 Secret 引用:整个值就是 ${NAME}(NAME = Cloud Run 绑定的 Secret 名) */
const SECRET_REF_RE = /^\$\{[A-Z_][A-Z0-9_]*\}$/
/** 敏感请求头名:值必须走 ${NAME} 引用,防明文 token 落进 R2 */
const SENSITIVE_HEADER_RE = /token|key|secret|auth|passw|credential|bearer/i

function isLoopback(url: string): boolean {
  try {
    const u = new URL(url)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname === '::1'
  } catch {
    return false
  }
}

/** 校验一份 MCP 配置(后台保存入口);合法返回 null,非法返回中文错误 */
export function validateMcp(value: unknown): string | null {
  if (value === undefined || value === null) return null // 空 = 清空,不启用 MCP
  if (typeof value !== 'object' || Array.isArray(value)) return 'mcp 必须是对象({ servers, autoEnableCodemode? })'
  if (JSON.stringify(value).length > MAX_MCP_BYTES) return 'mcp 配置过大(超过 256KB)'
  const root = value as Record<string, unknown>
  if (root.autoEnableCodemode !== undefined && typeof root.autoEnableCodemode !== 'boolean') {
    return 'mcp.autoEnableCodemode 必须是布尔'
  }
  const servers = root.servers
  if (servers === undefined || servers === null) return 'mcp.servers 必须是对象(name → 定义)'
  if (typeof servers !== 'object' || Array.isArray(servers)) return 'mcp.servers 必须是对象(name → 定义)'
  const entries = Object.entries(servers as Record<string, unknown>)
  if (entries.length > MAX_MCP_SERVERS) return `mcp 最多 ${MAX_MCP_SERVERS} 个服务`
  for (const [name, def] of entries) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) return `mcp 服务名必须是 ^[a-z][a-z0-9_-]*$:${name}`
    if (name.length > MAX_MCP_NAME) return `mcp 服务名过长(>${MAX_MCP_NAME}):${name}`
    if (!def || typeof def !== 'object' || Array.isArray(def)) return `mcp 服务 ${name} 的定义必须是对象`
    const d = def as Record<string, unknown>
    if (d.type !== undefined && d.type !== 'stdio' && d.type !== 'http') {
      return `mcp 服务 ${name}.type 必须是 stdio|http`
    }
    if (d.command !== undefined && typeof d.command !== 'string') return `mcp 服务 ${name}.command 必须是字符串`
    if (d.args !== undefined) {
      if (!Array.isArray(d.args) || d.args.some((a) => typeof a !== 'string')) {
        return `mcp 服务 ${name}.args 必须是字符串数组`
      }
    }
    if (d.cwd !== undefined && typeof d.cwd !== 'string') return `mcp 服务 ${name}.cwd 必须是字符串`
    if (d.env !== undefined) {
      const env = d.env as Record<string, unknown>
      if (typeof env !== 'object' || Array.isArray(env)) return `mcp 服务 ${name}.env 必须是 { 名: 字符串 }`
      for (const [k, v] of Object.entries(env)) {
        if (typeof v !== 'string') return `mcp 服务 ${name}.env.${k} 必须是字符串`
        // env 是给子进程注入 Secret 的通道,每个值都必须是完整 ${NAME} 引用 —— 绝不把明文密钥存进 R2
        if (!SECRET_REF_RE.test(v.trim())) {
          return `mcp 服务 ${name}.env.${k} 必须是 \${NAME} 引用(如 \${MY_SECRET}),绝不写明文密钥`
        }
      }
    }
    if (d.url !== undefined) {
      if (typeof d.url !== 'string' || !/^https?:\/\//.test(d.url)) {
        return `mcp 服务 ${name}.url 必须是 http(s):// 地址`
      }
      if (d.url.startsWith('http://') && !isLoopback(d.url)) {
        return `mcp 服务 ${name}.url 明文 http 只允许 loopback(localhost/127.0.0.1),外部必须 https`
      }
    }
    if (d.headers !== undefined) {
      const headers = d.headers as Record<string, unknown>
      if (typeof headers !== 'object' || Array.isArray(headers)) return `mcp 服务 ${name}.headers 必须是 { 名: 字符串 }`
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v !== 'string') return `mcp 服务 ${name}.headers.${k} 必须是字符串`
        // 敏感头(Authorization / API-Key / Token / Secret / Password / …)必须是完整 ${NAME} 引用,
        // 防明文 token 落 R2;非敏感头(如 Content-Type)保持自由。
        if (SENSITIVE_HEADER_RE.test(k) && !SECRET_REF_RE.test(v.trim())) {
          return `mcp 服务 ${name}.headers.${k} 是敏感头,值必须是 \${NAME} 引用(如 \${MY_TOKEN}),绝不写明文`
        }
      }
    }
    const hasCommand = d.command !== undefined
    const hasUrl = d.url !== undefined
    if (hasCommand === hasUrl) return `mcp 服务 ${name} 必须且只能有 command(stdio)或 url(http) 之一`
    if (d.exposure !== undefined && !EXPOSURES.has(String(d.exposure))) {
      return `mcp 服务 ${name}.exposure 必须是 codemode|deferred|direct|hidden`
    }
    if (d.toolExposure !== undefined) {
      const te = d.toolExposure as Record<string, unknown>
      if (typeof te !== 'object' || Array.isArray(te)) return `mcp 服务 ${name}.toolExposure 必须是对象`
      for (const v of Object.values(te)) {
        if (!EXPOSURES.has(String(v))) return `mcp 服务 ${name}.toolExposure 的值必须是 codemode|deferred|direct|hidden`
      }
    }
    if (d.description !== undefined && typeof d.description !== 'string') return `mcp 服务 ${name}.description 必须是字符串`
    if (d.enabled !== undefined && typeof d.enabled !== 'boolean') return `mcp 服务 ${name}.enabled 必须是布尔`
    if (d.timeout !== undefined && (typeof d.timeout !== 'number' || d.timeout < 0 || !Number.isFinite(d.timeout))) {
      return `mcp 服务 ${name}.timeout 必须是非负数字`
    }
  }
  return null
}

/** 读 R2 里的 MCP 配置;无对象/空/非法返回 undefined(agent 不启用 MCP) */
export async function getMcp(env: Env): Promise<McpConfig | undefined> {
  const obj = await env.PROMPTS.get(MCP_OBJECT_KEY)
  if (!obj) return undefined
  const text = await obj.text()
  if (!text.trim()) return undefined
  try {
    const parsed = JSON.parse(text) as unknown
    if (validateMcp(parsed)) return undefined
    const cfg = parsed as McpConfig
    if (!cfg.servers || Object.keys(cfg.servers).length === 0) return undefined
    return cfg
  } catch {
    return undefined
  }
}

/** 保存 MCP 配置到 R2(覆盖式);空 servers = 清空(不启用 MCP) */
export async function putMcp(env: Env, mcp: McpConfig): Promise<void> {
  const body = new TextEncoder().encode(JSON.stringify(mcp))
  await env.PROMPTS.put(MCP_OBJECT_KEY, body, { httpMetadata: { contentType: 'application/json; charset=utf-8' } })
}

/** 后台编辑器所需的当前配置 + 元信息(始终非空;无配置时 servers 为空对象) */
export async function mcpInfo(env: Env): Promise<{
  active: boolean
  updated_at: string | null
  size: number
  mcp: McpConfig
}> {
  const obj = await env.PROMPTS.get(MCP_OBJECT_KEY)
  let mcp: McpConfig = { servers: {} }
  if (obj) {
    try {
      const parsed = JSON.parse(await obj.text()) as unknown
      if (!validateMcp(parsed)) mcp = parsed as McpConfig
    } catch {
      mcp = { servers: {} }
    }
  }
  return { active: !!obj, updated_at: obj?.uploaded.toISOString() ?? null, size: obj?.size ?? 0, mcp }
}
