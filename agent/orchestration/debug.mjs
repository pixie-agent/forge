#!/usr/bin/env node
/**
 * 编排目录的闭环调试脚本(见本目录 AGENTS.md)。两个子命令:
 *   render —— 离线、不发 LLM:解析编排 + 加载提示词,打印每个节点解析出的 system/user prompt。
 *   run    —— 线上:把本目录的 pipeline.default.json + prompts/ 组装成 RunRequest,POST 到
 *            正在本地运行的 agent(与 Worker 的 dispatchAgent 完全同一请求形状)。
 *
 * 依赖:render 需要已编译的 agent/dist(npm --prefix agent run build 或 npm run dev:agent 一次)。
 *
 * 用法(node agent/orchestration/debug.mjs <render|run> [flags]):
 *   --type generate|chat    默认 generate
 *   --idea <text>           generate 的一句话想法
 *   --message <text>        chat 的修改要求
 *   --note <text>           补充要求
 *   --lang <code>           平台界面语言(默认 zh)
 *   --pipeline <file>       指定编排文件(默认 pipeline.default.json)
 *   --url <base>            run 模式的 agent 地址(默认 http://localhost:8080)
 *   --no-review             run 模式:designReview=off,首轮构建后即止(更省 token)
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const AGENT_DIR = dirname(HERE)

function flag(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

const mode = process.argv[2]
if (!['render', 'run'].includes(mode)) {
  console.error('用法:node debug.mjs <render|run> [--type generate|chat] [--idea …] [--message …] [--pipeline …] [--url …]')
  process.exit(2)
}

const type = flag('type', 'generate')
if (!['generate', 'chat'].includes(type)) {
  console.error('--type 只支持 generate|chat')
  process.exit(2)
}
const lang = flag('lang', 'zh')
const idea = flag('idea', type === 'generate' ? '做一个宠物领养网站,能浏览待领养的宠物并留言' : '')
const message = flag('message', type === 'chat' ? '加一个深色模式开关' : '')
const note = flag('note', '')
const pipelineFile = flag('pipeline', 'pipeline.default.json')
const agentUrl = flag('url', 'http://localhost:8080').replace(/\/+$/, '')
/** 是否在调内置默认编排文件(而非自定义文件)——内置默认要交给 defaultPipeline 按 mode/开关派生,自定义则原样 parsePipeline */
const isBuiltinPipeline = pipelineFile === 'pipeline.default.json'

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

/** 读 .env(AGENT_SECRET 等),不覆盖已有环境变量 */
function loadDotEnv() {
  const file = join(AGENT_DIR, '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

async function cmdRender() {
  const { parsePipeline, topologicalOrder, defaultPipeline } = await import('../dist/pipeline.js')
  const { loadPromptSet, interpolate } = await import('../dist/prompts.js')

  const pipelinePath = resolve(HERE, pipelineFile)
  if (!existsSync(pipelinePath)) {
    console.error(`编排文件不存在:${pipelinePath}`)
    process.exit(2)
  }
  const json = readFileSync(pipelinePath, 'utf8')
  const req = { type, idea, message, note, lang }
  // render 只做解析/插值,不碰模型,只构造 defaultPipeline / loadPromptSet 用到的最小配置
  const orchestrationDir = process.env.ORCHESTRATION_DIR ?? HERE
  const config = {
    orchestrationDir,
    promptsDir: process.env.PROMPTS_DIR ?? join(orchestrationDir, 'prompts'),
    designReview: 'generate',
    polishMaxMs: 300_000,
  }

  // 内置默认:走 defaultPipeline(与 runJob 一致,chat 去 planner / 关复查轮);自定义文件:原样解析
  const steps = isBuiltinPipeline
    ? defaultPipeline(config, req, lang, () => 1_000_000)
    : parsePipeline(json) ?? defaultPipeline(config, req, lang, () => 1_000_000)
  console.log(`# 编排 ${pipelineFile}(${steps.length} 节点,${isBuiltinPipeline ? 'defaultPipeline 派生后的实际执行序' : '拓扑序'})`)
  const prompts = await loadPromptSet(config.promptsDir, { req, lang: 'zh', mode: type, imageInputEnabled: true })
  const vars = prompts.vars()

  for (const step of topologicalOrder(steps) ?? steps) {
    const needs = step.needs?.length ? `  ← needs [${step.needs}]` : ''
    // 人门节点(approve/choose):没有 prompt/agent,必须先于 agent 分支处理,否则会误入 agent 分支崩溃
    if ('approve' in step || 'choose' in step) {
      const kind = 'approve' in step ? 'approve' : 'choose'
      const q = step.approve ?? step.choose?.question
      const opts = step.choose?.options?.length ? `  选项=${step.choose.options.join(' / ')}` : ''
      console.log(`\n[gate] ${step.id}  ${kind}  "${q}"${opts}${needs}`)
      if (step.if) console.log(`        if: ${step.if}`)
      continue
    }
    if ('command' in step) {
      console.log(`\n[build] ${step.id}${step.rollback ? ' (rollback)' : ''}${needs}`)
      if (step.if) console.log(`        if: ${step.if}`)
      continue
    }
    // agent 节点:命名引用(字符串)或内联对象
    const inline = typeof step.agent === 'object'
    const agentName = inline ? '(inline)' : step.agent
    const tools = step.tools ?? (inline ? step.agent.tools : undefined)
    const system = inline ? (step.agent.systemPrompt ?? '(内联无 systemPrompt → 回落 coder 默认)') : prompts.system(step.agent)
    const userPrompt = interpolate(step.prompt, vars)
    console.log(`\n[agent] ${step.id}  agent=${agentName}  tools=${(tools ?? ['(default)']).join(',')}${needs}`)
    if (step.images) console.log('        images=on')
    if (step.deliver) console.log('        deliver=on')
    if (step.if) console.log(`        if: ${step.if}`)
    if (step.output?.length) console.log(`        output: [${step.output.join(', ')}]`)
    console.log(`        prompt 模板: ${step.prompt}`)
    console.log(`        system (${system.length} 字符,头 240):`)
    console.log('        ' + system.slice(0, 240).replace(/\n/g, '\n        '))
    console.log(`        user (${userPrompt.length} 字符,头 240):`)
    console.log('        ' + userPrompt.slice(0, 240).replace(/\n/g, '\n        '))
  }
}

async function cmdRun() {
  loadDotEnv()
  const secret = process.env.AGENT_SECRET
  if (!secret) {
    console.error('缺少 AGENT_SECRET(读 agent/.env 失败,请先 npm run dev:agent 或手动 export)')
    process.exit(2)
  }
  const pipelinePath = resolve(HERE, pipelineFile)
  if (!existsSync(pipelinePath)) {
    console.error(`编排文件不存在:${pipelinePath}`)
    process.exit(2)
  }
  const body = {
    jobId: `debug-${Date.now()}`,
    projectId: 'debug',
    type,
    idea: type === 'generate' ? idea : undefined,
    message: type === 'chat' ? message : undefined,
    note: note || undefined,
    lang,
    // 内置默认文件不发 pipeline:agent 的 defaultPipeline 会读 ORCHESTRATION_DIR/pipeline.default.json
    // 并按 mode/开关派生(chat 去 planner、关复查轮)——与线上空 pipeline 的路径完全一致。
    // 自定义文件才发,作为 body.pipeline 原样 parsePipeline(与后台存进 D1 后下发一致)。
    pipeline: isBuiltinPipeline ? undefined : readFileSync(pipelinePath, 'utf8'),
    callbackBase: 'http://localhost:8787', // 回调打不中本地 Worker 也无妨:agent 侧全部 fire-and-forget/落 stdout
  }
  // 提示词:本地 agent 已由 ORCHESTRATION_DIR 指向本目录,直接改文件即生效;显式 --send-files 时
  // 再走 body.promptFiles 覆盖链路(与后台上传 zip 后下发的路径一致)。
  if (hasFlag('send-files')) body.promptFiles = readPromptFiles()
  if (hasFlag('no-review')) body.model = { ...(body.model ?? {}), designReview: 'off' }

  console.log(`POST ${agentUrl}/run  type=${type}  pipeline=${isBuiltinPipeline ? '(builtin, 不发)' : pipelineFile}  sendFiles=${hasFlag('send-files')}`)
  const res = await fetch(`${agentUrl}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Secret': secret, 'X-Forge-Lang': lang },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    console.error(`agent 返回 ${res.status}:\n${text.slice(0, 2000)}`)
    process.exit(1)
  }
  const data = JSON.parse(text)
  console.log(`\n== 成功 ==\nsrc 文件 ${Object.keys(data.src ?? {}).length} 个 · dist 文件 ${data.manifest?.files?.length ?? 0} 个`)
  if (data.plan?.name) console.log(`plan: ${data.plan.name} — ${data.plan.tagline ?? ''}`)
  if (data.summary) console.log(`\n交付说明:\n${data.summary}`)
  console.log(`\nsrc 文件清单:${Object.keys(data.src ?? {}).slice(0, 40).map((p) => `\n  ${p}`).join('')}`)
}

if (mode === 'render') await cmdRender()
else await cmdRun()
