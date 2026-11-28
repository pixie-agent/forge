#!/usr/bin/env node
/**
 * 把本目录的 pipeline.default.json + prompts/ + agents/ + skills/ + mcp.json 一键推到某个环境的 Worker(运行时下发,无需部署)。
 * 与后台五条路径完全同构:
 *   pipeline → PUT /api/admin/pipeline(存 D1 platform_pipeline)
 *   prompts  → POST /api/admin/prompts/save(校验后归档为 R2 promptset.zip 新版本)
 *   agents   → PUT /api/admin/agents(存 R2 agentset.json)
 *   skills   → POST /api/admin/skills/save(存 R2 skillset.zip)
 *   mcp      → PUT /api/admin/mcp(存 R2 mcpset.json)
 * 每个 job 派发时 Worker 会动态拉取这五份数据,下一个任务即用新值。
 *
 * 用法(见 agent/orchestration/AGENTS.md):
 *   node agent/orchestration/push.mjs                          # 默认 local
 *   node agent/orchestration/push.mjs --env staging --password <口令>
 *   node agent/orchestration/push.mjs --env prod --password <口令> --yes
 *   node agent/orchestration/push.mjs --pipeline-only / --prompts-only / --agents-only / --skills-only / --mcp-only
 *
 * --env    local | staging | prod(映射到对应 Worker 基址,也可用 --url 直给)
 * --url    <base> 覆盖 --env 的基址
 * --password <口令> 管理后台口令;缺省:ADMIN_PASSWORD env → 根 .dev.vars → devadmin(仅本地)
 * --yes    非 local 环境默认要求确认,带 --yes 跳过
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(dirname(HERE))

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

const ENV_URL = {
  local: 'http://localhost:8787',
  staging: 'https://app-staging.1forgen.site',
  prod: 'https://app.1forgen.site',
}
const env = flag('env', 'local')
if (!(env in ENV_URL)) {
  console.error(`--env 只支持 local|staging|prod(实际 ${env})`)
  process.exit(2)
}
const base = (flag('url', ENV_URL[env]) ?? '').replace(/\/+$/, '')
const pipelineOnly = hasFlag('pipeline-only')
const promptsOnly = hasFlag('prompts-only')
const agentsOnly = hasFlag('agents-only')
const skillsOnly = hasFlag('skills-only')
const mcpOnly = hasFlag('mcp-only')
// 任一 --X-only 只推 X;全都不带 = 推全部五份
const anyOnly = pipelineOnly || promptsOnly || agentsOnly || skillsOnly || mcpOnly
const doPipeline = !anyOnly || pipelineOnly
const doPrompts = !anyOnly || promptsOnly
const doAgents = !anyOnly || agentsOnly
const doSkills = !anyOnly || skillsOnly
const doMcp = !anyOnly || mcpOnly

function resolvePassword() {
  if (flag('password', '')) return flag('password', '')
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD
  const devVars = join(ROOT, '.dev.vars')
  if (existsSync(devVars)) {
    for (const line of readFileSync(devVars, 'utf8').split('\n')) {
      const m = line.match(/^\s*ADMIN_PASSWORD\s*=\s*(.*)\s*$/)
      if (m) return m[1].replace(/^["']|["']$/g, '')
    }
  }
  return env === 'local' ? 'devadmin' : ''
}
const password = resolvePassword()
if (!password) {
  console.error(`需要管理后台口令:--password <口令>(或 export ADMIN_PASSWORD)。staging/prod 的口令是各自 Worker 的 secret,不会写在仓库里。`)
  process.exit(2)
}

/** 读取本目录下 prompts/{shared,system,user} 的一层 .md 树 → { 路径 → 内容 }(与 Worker 的 zip 规则一致) */
function readPromptFiles() {
  const out = {}
  for (const dir of ['shared', 'system', 'user']) {
    const abs = join(HERE, 'prompts', dir)
    if (!existsSync(abs)) continue
    for (const name of readdirSync(abs)) {
      if (!name.endsWith('.md')) continue
      out[`${dir}/${name}`] = readFileSync(join(abs, name), 'utf8')
    }
  }
  return out
}

/** 读取本目录下 agents/*.json → { name → 定义 };文件名(去 .json)即 agent 名 */
function readAgentFiles() {
  const dir = join(HERE, 'agents')
  if (!existsSync(dir)) return {}
  const out = {}
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const file = join(dir, name)
    let def
    try {
      def = JSON.parse(readFileSync(file, 'utf8'))
    } catch (err) {
      throw new Error(`agents/${name} 不是合法 JSON:${err instanceof Error ? err.message : String(err)}`)
    }
    out[name.slice(0, -'.json'.length)] = def
  }
  return out
}

/** 读取本目录下 skills/<name>/<file>(递归,跳过顶层 README.md)→ { skills/<name>/<file> → 内容 } */
function readSkillFiles() {
  const dir = join(HERE, 'skills')
  if (!existsSync(dir)) return {}
  const out = {}
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs)) {
      const p = join(abs, name)
      const r = rel ? `${rel}/${name}` : name
      if (statSync(p).isDirectory()) walk(p, r)
      else out[`skills/${r}`] = readFileSync(p, 'utf8')
    }
  }
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, name) // 顶层文件(README.md)不是技能,跳过
  }
  return out
}

/** 读取本目录下 mcp.json → MCP 配置;缺文件 = 空配置(不启用 MCP) */
function readMcpFile() {
  const file = join(HERE, 'mcp.json')
  if (!existsSync(file)) return { servers: {} }
  let cfg
  try {
    cfg = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`mcp.json 不是合法 JSON:${err instanceof Error ? err.message : String(err)}`)
  }
  return cfg
}

async function main() {
  if (env !== 'local' && !hasFlag('yes')) {
    console.error(`目标非本地(${base})。确认要把本目录的编排/提示词推到「${env}」?确认请加 --yes。`)
    process.exit(2)
  }

  // 1) 登录拿 admin cookie
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  const setCookie = login.headers.get('set-cookie') ?? ''
  const cookie = (setCookie.match(/admin=[^;]+/) ?? [])[0]
  if (!login.ok || !cookie) {
    console.error(`登录失败(http ${login.status}):${(await login.text().catch(() => ''))}`)
    process.exit(1)
  }

  if (doPipeline) {
    const file = join(HERE, 'pipeline.default.json')
    const json = readFileSync(file, 'utf8')
    const res = await fetch(`${base}/api/admin/pipeline`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ pipeline_json: json }),
    })
    const text = await res.text()
    if (!res.ok) {
      console.error(`推编排失败(http ${res.status}):${text}`)
      process.exit(1)
    }
    const def = JSON.parse(json)
    console.log(`✓ 编排已推送到 ${env}:${def.name}(steps=${def.steps.length})`)
  }

  if (doPrompts) {
    const files = readPromptFiles()
    const res = await fetch(`${base}/api/admin/prompts/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ files }),
    })
    const text = await res.text()
    if (!res.ok) {
      console.error(`推提示词失败(http ${res.status}):${text}`)
      process.exit(1)
    }
    console.log(`✓ 提示词已推送到 ${env}:${Object.keys(files).length} 个文件(已归档为新版本)`)
  }

  if (doAgents) {
    const agents = readAgentFiles()
    const res = await fetch(`${base}/api/admin/agents`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ agents }),
    })
    const text = await res.text()
    if (!res.ok) {
      console.error(`推 agents 失败(http ${res.status}):${text}`)
      process.exit(1)
    }
    console.log(`✓ agents 已推送到 ${env}:${Object.keys(agents).length} 个(空目录 = 清空回落内置)`)
  }

  if (doSkills) {
    const files = readSkillFiles()
    const res = await fetch(`${base}/api/admin/skills/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ files }),
    })
    const text = await res.text()
    if (!res.ok) {
      console.error(`推技能失败(http ${res.status}):${text}`)
      process.exit(1)
    }
    console.log(`✓ 技能已推送到 ${env}:${Object.keys(files).length} 个文件`)
  }

  if (doMcp) {
    const mcp = readMcpFile()
    const res = await fetch(`${base}/api/admin/mcp`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ mcp }),
    })
    const text = await res.text()
    if (!res.ok) {
      console.error(`推 MCP 失败(http ${res.status}):${text}`)
      process.exit(1)
    }
    console.log(`✓ MCP 已推送到 ${env}:${Object.keys(mcp.servers ?? {}).length} 个服务`)
  }

  console.log('下一个任务派发即生效(进行中的任务不受影响)。')
}

await main()
