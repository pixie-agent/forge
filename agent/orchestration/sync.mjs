#!/usr/bin/env node
/**
 * 把某个环境后台里调好的整套编排原样复制到另一个环境(staging → prod 是最常见的一种)。
 * 走的是和后台页面同一套 API,读源环境、写目标环境,不经过仓库文件:
 *   pipeline → GET /api/admin/pipeline                     → PUT /api/admin/pipeline
 *   agents   → GET /api/admin/agents                       → PUT /api/admin/agents
 *   mcp      → GET /api/admin/mcp                          → PUT /api/admin/mcp
 *   prompts  → GET /api/admin/prompts(有效树)              → POST /api/admin/prompts/save(只写与默认树不同的文件)
 *   skills   → GET /api/admin/skills/download(zip 原样)    → PUT /api/admin/skills(zip_base64)
 *
 * 源环境里为空的资源默认**不动**目标环境(不把 prod 的配置清掉);要完全镜像加 --mirror。
 * 注意:技能没有「清空」接口,--mirror 也清不掉目标已有的技能。
 *
 * 用法:
 *   node agent/orchestration/sync.mjs --from staging --to prod --dry-run
 *   node agent/orchestration/sync.mjs --from staging --to prod --yes
 *   node agent/orchestration/sync.mjs --from local --to staging --prompts-only --yes
 *
 * --from / --to        local | staging | prod
 * --from-password / --to-password   两边各自的后台口令(Worker secret 读不回来,只能由持有者给);
 *                        也可 export ADMIN_PASSWORD_STAGING / ADMIN_PASSWORD_PROD,local 缺省读 .dev.vars / devadmin
 * --dry-run            只看两边差异,不写目标
 * --mirror             源环境为空的资源也覆盖到目标(清空 / 回落内置默认)
 * --yes                目标非 local 时必须带,否则只打印确认提示
 * --pipeline-only / --prompts-only / --agents-only / --skills-only / --mcp-only
 *
 * 提示词只搬「与镜像默认树不同」的文件:默认部分继续由 agent 镜像提供,以后升级默认提示词不会被
 * 一整棵旧快照挡住(比对基准是本仓库 agent/orchestration/prompts/,与 Worker 的 DEFAULT_PROMPT_FILES 同源)。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
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
function envOf(role) {
  const env = flag(role, role === 'from' ? 'staging' : 'prod')
  if (!(env in ENV_URL)) {
    console.error(`--${role} 只支持 local|staging|prod(实际 ${env})`)
    process.exit(2)
  }
  return env
}
const fromEnv = envOf('from')
const toEnv = envOf('to')
if (fromEnv === toEnv && !hasFlag('from-url') && !hasFlag('to-url')) {
  console.error(`源和目标都是「${fromEnv}」,没有可复制的东西。`)
  process.exit(2)
}
const fromBase = (flag('from-url', ENV_URL[fromEnv]) ?? '').replace(/\/+$/, '')
const toBase = (flag('to-url', ENV_URL[toEnv]) ?? '').replace(/\/+$/, '')

const pipelineOnly = hasFlag('pipeline-only')
const promptsOnly = hasFlag('prompts-only')
const agentsOnly = hasFlag('agents-only')
const skillsOnly = hasFlag('skills-only')
const mcpOnly = hasFlag('mcp-only')
const anyOnly = pipelineOnly || promptsOnly || agentsOnly || skillsOnly || mcpOnly
const doPipeline = !anyOnly || pipelineOnly
const doPrompts = !anyOnly || promptsOnly
const doAgents = !anyOnly || agentsOnly
const doSkills = !anyOnly || skillsOnly
const doMcp = !anyOnly || mcpOnly
const dryRun = hasFlag('dry-run')
const mirror = hasFlag('mirror')

function devVarsPassword() {
  const devVars = join(ROOT, '.dev.vars')
  if (!existsSync(devVars)) return ''
  for (const line of readFileSync(devVars, 'utf8').split('\n')) {
    const m = line.match(/^\s*ADMIN_PASSWORD\s*=\s*(.*)\s*$/)
    if (m) return m[1].replace(/^["']|["']$/g, '')
  }
  return ''
}
function passwordOf(role, env) {
  // 口令按「环境」给:ADMIN_PASSWORD_STAGING / ADMIN_PASSWORD_PROD;local 缺省读 .dev.vars / devadmin
  const pw = flag(`${role}-password`, '') || process.env[`ADMIN_PASSWORD_${env.toUpperCase()}`] || (env === 'local' ? devVarsPassword() || 'devadmin' : '')
  if (!pw) {
    console.error(`需要「${env}」的后台口令:--${role}-password <口令>(或 export ADMIN_PASSWORD_${env.toUpperCase()})。Worker secret 读不回来,只能由持有者提供。`)
    process.exit(2)
  }
  return pw
}

/** 登录拿 admin cookie */
async function login(base, password, label) {
  const res = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  const setCookie = res.headers.get('set-cookie') ?? ''
  const cookie = (setCookie.match(/admin=[^;]+/) ?? [])[0]
  if (!res.ok || !cookie) {
    console.error(`登录「${label}」失败(http ${res.status}):${(await res.text().catch(() => ''))}`)
    process.exit(1)
  }
  return cookie
}

async function getJson(base, cookie, path) {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie } })
  if (!res.ok) throw new Error(`GET ${path} → http ${res.status}`)
  return res.json()
}
async function getBytes(base, cookie, path) {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie } })
  if (!res.ok) throw new Error(`GET ${path} → http ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}
async function send(base, cookie, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → http ${res.status}:${text}`)
  return text
}

function toBase64(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return Buffer.from(bin, 'binary').toString('base64')
}

/** 仓库里的默认提示词树(与 Worker 的 DEFAULT_PROMPT_FILES 同源,构建时 sync:prompts 同步);读不到就当空 */
function repoDefaultPrompts() {
  const out = {}
  for (const dir of ['shared', 'system', 'user']) {
    const abs = join(HERE, 'prompts', dir)
    if (!existsSync(abs)) continue
    for (const name of readdirSync(abs)) {
      if (name.endsWith('.md')) out[`${dir}/${name}`] = readFileSync(join(abs, name), 'utf8')
    }
  }
  return out
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const NAME = { pipeline: '流水线', agents: 'Agent 注册表', mcp: 'MCP', prompts: '提示词', skills: '技能' }

async function main() {
  if (!dryRun && toEnv !== 'local' && !hasFlag('yes')) {
    console.error(`目标是「${toEnv}」(${toBase})。确认把「${fromEnv}」的编排覆盖过去?确认请加 --yes(先看差异用 --dry-run)。`)
    process.exit(2)
  }
  const fromCookie = await login(fromBase, passwordOf('from', fromEnv), fromEnv)
  const toCookie = await login(toBase, passwordOf('to', toEnv), toEnv)

  /** 比较两边并执行;change() 返回 [是否不同, 摘要];write 只在真要写时调用 */
  const plan = []
  const step = (resource, enabled, run) => {
    if (enabled) plan.push({ resource, run })
  }

  if (doPipeline) step('pipeline', true, async () => {
    const [src, dst] = await Promise.all([getJson(fromBase, fromCookie, '/api/admin/pipeline'), getJson(toBase, toCookie, '/api/admin/pipeline')])
    const srcJson = (src.pipeline_json ?? '').trim()
    const dstJson = (dst.pipeline_json ?? '').trim()
    if (!srcJson && !mirror) return { skip: `源为空(内置默认),不动目标${dstJson ? '(目标有自定义流水线)' : ''}` }
    if (srcJson === dstJson) return { same: true, summary: `一致:${srcJson ? `${JSON.parse(srcJson).steps?.length ?? '?'} 个节点` : '内置默认'}` }
    const summary = `${srcJson ? `${JSON.parse(srcJson).steps?.length ?? '?'} 个节点` : '内置默认'}(目标原为${dstJson ? '自定义' : '内置默认'})`
    if (dryRun) return { change: summary }
    await send(toBase, toCookie, 'PUT', '/api/admin/pipeline', { pipeline_json: srcJson })
    return { done: summary }
  })

  if (doAgents) step('agents', true, async () => {
    const [src, dst] = await Promise.all([getJson(fromBase, fromCookie, '/api/admin/agents'), getJson(toBase, toCookie, '/api/admin/agents')])
    const srcAgents = src.agents ?? {}
    const dstAgents = dst.agents ?? {}
    if (!src.active && !mirror) return { skip: `源为空(只用内置),不动目标${dst.active ? `(${Object.keys(dstAgents).length} 个)` : ''}` }
    if (sameJson(srcAgents, dstAgents)) return { same: true, summary: `一致:${Object.keys(srcAgents).join(', ') || '空'}` }
    const summary = `${Object.keys(srcAgents).join(', ') || '清空'}(目标原为 ${Object.keys(dstAgents).join(', ') || '空'})`
    if (dryRun) return { change: summary }
    await send(toBase, toCookie, 'PUT', '/api/admin/agents', { agents: srcAgents })
    return { done: summary }
  })

  if (doMcp) step('mcp', true, async () => {
    const [src, dst] = await Promise.all([getJson(fromBase, fromCookie, '/api/admin/mcp'), getJson(toBase, toCookie, '/api/admin/mcp')])
    const srcMcp = src.mcp ?? { servers: {} }
    const dstMcp = dst.mcp ?? { servers: {} }
    if (!src.active && !mirror) return { skip: `源为空(未启用),不动目标${dst.active ? `(${Object.keys(dstMcp.servers ?? {}).length} 个服务)` : ''}` }
    if (sameJson(srcMcp, dstMcp)) return { same: true, summary: `一致:${Object.keys(srcMcp.servers ?? {}).join(', ') || '空'}` }
    const summary = `${Object.keys(srcMcp.servers ?? {}).join(', ') || '清空'}(目标原为 ${Object.keys(dstMcp.servers ?? {}).join(', ') || '空'})`
    if (dryRun) return { change: summary }
    await send(toBase, toCookie, 'PUT', '/api/admin/mcp', { mcp: srcMcp })
    return { done: summary }
  })

  if (doPrompts) step('prompts', true, async () => {
    const [src, dst] = await Promise.all([getJson(fromBase, fromCookie, '/api/admin/prompts'), getJson(toBase, toCookie, '/api/admin/prompts')])
    const defaults = repoDefaultPrompts()
    // 只搬「与默认树不同」的文件:默认部分继续由镜像提供,以后升级默认提示词不会被整棵旧快照挡住
    const overrides = {}
    for (const f of src.files ?? []) {
      if (defaults[f.path] === undefined) overrides[f.path] = f.content // 新文件,默认树里没有
      else if (defaults[f.path] !== f.content) overrides[f.path] = f.content
    }
    if (!src.active && !mirror) return { skip: `源无自定义覆盖(内置默认 ${src.files?.length ?? 0} 个文件),不动目标${dst.active ? `(${dst.files?.length ?? 0} 个自定义)` : ''}` }
    if (!src.active && mirror) {
      if (!dst.active) return { same: true, summary: '两边都是内置默认' }
      if (dryRun) return { change: '目标回落内置默认' }
      await send(toBase, toCookie, 'POST', '/api/admin/prompts/restore', { key: null })
      return { done: '目标已回落内置默认' }
    }
    const dstOverrides = {}
    for (const f of dst.files ?? []) if (defaults[f.path] === undefined || defaults[f.path] !== f.content) dstOverrides[f.path] = f.content
    if (sameJson(overrides, dstOverrides)) return { same: true, summary: `一致:${Object.keys(overrides).length} 个自定义覆盖` }
    const summary = `${Object.keys(overrides).length} 个自定义覆盖:${Object.keys(overrides).join(', ')}(目标原为 ${Object.keys(dstOverrides).length} 个)`
    if (dryRun) return { change: summary }
    if (!Object.keys(overrides).length) {
      // 源 active 但内容与默认树完全相同 → 等价于默认,清掉目标的自定义即可
      await send(toBase, toCookie, 'POST', '/api/admin/prompts/restore', { key: null })
      return { done: '源内容与默认树相同,目标已回落内置默认' }
    }
    await send(toBase, toCookie, 'POST', '/api/admin/prompts/save', { files: overrides })
    return { done: summary }
  })

  if (doSkills) step('skills', true, async () => {
    const [src, dst] = await Promise.all([getJson(fromBase, fromCookie, '/api/admin/skills'), getJson(toBase, toCookie, '/api/admin/skills')])
    if (!src.active) return { skip: `源未启用技能,不动目标${dst.active ? `(${dst.files?.length ?? 0} 个文件)` : ''}(技能没有清空接口,--mirror 也清不掉)` }
    const srcMap = Object.fromEntries((src.files ?? []).map((f) => [f.path, f.content]))
    const dstMap = Object.fromEntries((dst.files ?? []).map((f) => [f.path, f.content]))
    if (sameJson(srcMap, dstMap)) return { same: true, summary: `一致:${src.files?.length ?? 0} 个文件` }
    const summary = `${src.files?.length ?? 0} 个文件:${Object.keys(srcMap).join(', ')}(目标原为 ${dst.files?.length ?? 0} 个)`
    if (dryRun) return { change: summary }
    // zip 原样搬运(与后台「下载 → 上传」同一份字节);上面的文件树比较只用来判断是否一致
    const zip = await getBytes(fromBase, fromCookie, '/api/admin/skills/download')
    await send(toBase, toCookie, 'PUT', '/api/admin/skills', { zip_base64: toBase64(zip) })
    return { done: summary }
  })

  console.log(`${dryRun ? '[dry-run] ' : ''}${fromEnv} → ${toEnv}`)
  let changes = 0
  for (const { resource, run } of plan) {
    try {
      const r = await run()
      if (r.skip) console.log(`· ${NAME[resource]}:跳过 — ${r.skip}`)
      else if (r.same) console.log(`✓ ${NAME[resource]}:${r.summary},两边一致`)
      else if (r.change) {
        changes++
        console.log(`→ ${NAME[resource]} 将覆盖:${r.change}`)
      } else {
        changes++
        console.log(`✓ ${NAME[resource]} 已复制:${r.done}`)
      }
    } catch (err) {
      console.error(`✗ ${NAME[resource]}:${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    }
  }
  if (dryRun) {
    console.log(changes ? `\n有 ${changes} 项会变化;确认后去掉 --dry-run 并加 --yes 执行。` : '\n两边已一致,不需要复制。')
  } else if (!process.exitCode) {
    console.log('\n下一个任务派发即生效(进行中的任务不受影响)。')
  }
}

await main()
