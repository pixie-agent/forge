/**
 * 编排流水线 + 提示词文件系统自检(见 docs/FORGE2.md §17.9 / §17.10)。
 *
 * 仓库没有测试框架,延续 lang-check.mjs 的做法:跑在已编译的 dist 上(tsc 产物),
 * 覆盖两条链路的「数据 → 解析 → 装配」,不真发 LLM:
 *   1) 编排:默认流水线 JSON 往返、拓扑排序(线性/扇出/环/悬空/重复 id)、mode 筛选;
 *   2) 提示词:加载默认树、shared 片段插值、system/user 解析、{{plannerPrompt}} 等变量;
 *   3) 两者合流:把默认编排的 step.prompt 用 prompts.vars() 插值,确认占位符都能解出来。
 *
 * 用法:node agent/scripts/pipeline-check.mjs(需先 npm --prefix agent run build;
 * 默认读 agent/orchestration/,可用 ORCHESTRATION_DIR 覆盖)
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(dirname(fileURLToPath(import.meta.url))) // agent/
process.env.ORCHESTRATION_DIR ??= join(HERE, 'orchestration')

import { DEFAULT_PIPELINE, AGENTS, parsePipeline, topologicalOrder, defaultPipeline } from '../dist/pipeline.js'
import { loadPromptSet, interpolate } from '../dist/prompts.js'
import { evalCondition } from '../dist/condition.js'

/**
 * 自检只涉及编排 + 提示词的解析/装配,不碰模型,所以不调 loadConfig(那需要整套 env)。
 * 只构造 defaultPipeline / loadPromptSet 用到的最小配置。
 */
function minimalConfig() {
  const orchestrationDir = process.env.ORCHESTRATION_DIR
  return {
    orchestrationDir,
    promptsDir: process.env.PROMPTS_DIR ?? join(orchestrationDir, 'prompts'),
    designReview: 'generate',
    polishMaxMs: 300_000,
  }
}

let failures = 0
const ok = (cond, name) => {
  if (cond) console.log(`✓ ${name}`)
  else {
    failures++
    console.error(`✗ ${name}`)
  }
}

// ── 1) 编排:默认流水线是「数据」,运行时文件与硬编码兜底必须一致 ──
const runtimeJson = readFileSync(join(process.env.ORCHESTRATION_DIR, 'pipeline.default.json'), 'utf8')
const defaultJson = JSON.stringify(DEFAULT_PIPELINE)
ok(parsePipeline(runtimeJson) !== null, 'orchestration/pipeline.default.json 能通过 parsePipeline')
ok(parsePipeline(defaultJson)?.map((s) => s.id).join('>') === parsePipeline(runtimeJson)?.map((s) => s.id).join('>'), 'pipeline.default.json 与 DEFAULT_PIPELINE 节点/拓扑一致')
const parsed = parsePipeline(defaultJson)
ok(parsed !== null, '默认流水线 JSON 能通过 parsePipeline')
ok(parsed?.length === 5, `默认流水线 5 个节点(实际 ${parsed?.length})`)
ok(parsed?.filter((s) => 'command' in s).length === 2, '默认流水线含 2 个 build 节点')
ok(parsed?.filter((s) => 'agent' in s && s.agent === 'reviewer').length === 1, '默认流水线含 reviewer 节点')

// ── 2) 拓扑排序:DAG 能力 ──
const linear = parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [
  { id: 'a', agent: 'planner', prompt: 'x' },
  { id: 'b', needs: ['a'], agent: 'coder', prompt: 'x' },
  { id: 'c', needs: ['b'], command: 'build' },
] }))
ok(linear?.map((s) => s.id).join('>') === 'a>b>c', `线性拓扑序(实际 ${linear?.map((s) => s.id).join('>')})`)

// 扇出扇入:a → b、a → c、b,c → d
const fan = parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [
  { id: 'a', agent: 'planner', prompt: 'x' },
  { id: 'b', needs: ['a'], agent: 'coder', prompt: 'x' },
  { id: 'c', needs: ['a'], agent: 'reviewer', prompt: 'x' },
  { id: 'd', needs: ['b', 'c'], command: 'build' },
] }))
const fanIds = fan?.map((s) => s.id) ?? []
ok(fan !== null, '扇出扇入 DAG 能解析')
ok(fanIds[0] === 'a' && fanIds[3] === 'd', `汇合节点最后(实际 ${fanIds.join('>')})`)

// 环 → 整份回落 null
const cycle = parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [
  { id: 'a', needs: ['b'], agent: 'planner', prompt: 'x' },
  { id: 'b', needs: ['a'], agent: 'coder', prompt: 'x' },
] }))
ok(cycle === null, '环 → parsePipeline 返回 null(回落默认)')

// 悬空 needs → null
const dangling = parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [
  { id: 'a', needs: ['ghost'], agent: 'planner', prompt: 'x' },
] }))
ok(dangling === null, '悬空 needs → null')

// 重复 id → null
const dup = parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [
  { id: 'a', agent: 'planner', prompt: 'x' },
  { id: 'a', agent: 'coder', prompt: 'x' },
] }))
ok(dup === null, '重复 id → null')

// agent 引用:任意命名 agent 名合法(运行时回落,见 runner.resolveAgent);内联对象也合法;内联定义非法才 null
const unknownAgent = parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [{ id: 'a', agent: 'ghost', prompt: 'x' }] }))
ok(unknownAgent !== null && unknownAgent[0].agent === 'ghost', '未知 agent 名保留(运行时回落),不判非法')
const inlineAgent = parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [{ id: 'a', agent: { systemPrompt: '你是需求澄清助手', tools: ['read'] }, prompt: '{{ idea }}' }] }))
ok(inlineAgent !== null && typeof inlineAgent[0].agent === 'object' && inlineAgent[0].agent.systemPrompt === '你是需求澄清助手', '内联 agent 对象能解析')
ok(parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [{ id: 'a', agent: { tools: [] }, prompt: 'x' }] })) === null, '内联 agent 空 tools → null')
ok(parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [{ id: 'a', agent: {}, prompt: 'x' }] })) === null, '内联 agent 空对象 → null')
ok(parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [{ id: 'a', command: 'deploy' }] })) === null, '未知 command → null')
ok(parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [{ id: 'a', agent: 'coder', prompt: '' }] })) === null, '空 prompt → null')
ok(parsePipeline('') === null, '空串 → null(回落默认)')
ok(parsePipeline('not json') === null, '非 JSON → null')
ok(parsePipeline(JSON.stringify({ schemaVersion: 'v2', steps: [] })) === null, '错误 schemaVersion → null')

// gate 节点(approve/choose)+ typed output + if(P4/P5,见 docs/FORGE2.md §17.14)
const gateApprove = parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [
  { id: 'a', agent: 'planner', prompt: 'x' },
  { id: 'g', needs: ['a'], approve: '以上方案是否满足需求?' },
  { id: 'b', needs: ['g'], agent: 'coder', prompt: 'x' },
] }))
ok(gateApprove !== null && gateApprove.map((s) => s.id).join('>') === 'a>g>b', `approve 门节点能解析(实际 ${gateApprove?.map((s) => s.id).join('>')})`)
ok(gateApprove !== null && gateApprove.some((s) => 'approve' in s && s.approve === '以上方案是否满足需求?'), 'approve 问题文案保留')
const gateChoose = parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [
  { id: 'a', agent: 'planner', prompt: 'x' },
  { id: 'g', needs: ['a'], choose: { question: '选一个', options: ['甲', '乙'] } },
] }))
ok(gateChoose !== null && gateChoose.some((s) => 'choose' in s && s.choose?.options.length === 2), 'choose 门节点能解析(≥2 选项)')
ok(parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [{ id: 'g', approve: '' }] })) === null, 'approve 空问题 → null')
ok(parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [{ id: 'g', choose: { question: 'q', options: ['a'] } }] })) === null, 'choose 选项 < 2 → null')

// 动作互斥 / id 长度 / 未知工具(与 Worker 校验同一套规则,见 src/lib/pipeline.ts)
ok(parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [{ id: 'x', approve: 'ok?', command: 'build' }] })) === null, 'approve + command 互斥 → null')
ok(parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [{ id: 'x', approve: 'ok?', choose: { question: 'q', options: ['a', 'b'] } }] })) === null, 'approve + choose 互斥 → null')
ok(parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [{ id: 'x', command: 'build', agent: 'coder', prompt: 'p' }] })) === null, 'command + agent 互斥 → null')
ok(parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [{ id: 'x'.repeat(41), agent: 'coder', prompt: 'p' }] })) === null, 'id 超 40 字符 → null')
ok(parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [{ id: 'a', agent: 'coder', prompt: 'p', tools: ['read', 'rm'] }] })) === null, 'step tools 含未知工具 → null')
ok(parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [{ id: 'a', agent: { systemPrompt: 's', tools: ['read', 'rm'] }, prompt: 'p' }] })) === null, '内联 agent tools 含未知工具 → null')

// HITL 编排快照(§17.14):parsePipeline 的产物经 JSON 往返后重新 parsePipeline 仍等价 ——
// 续跑时 restoreStepsSnapshot 靠这条不变量固定编排版本(见 agent/src/runner.ts)
const snapshotSteps = parsePipeline(defaultJson)
const snapshotRoundTrip = parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: JSON.parse(JSON.stringify(snapshotSteps)) }))
ok(snapshotRoundTrip?.map((s) => s.id).join('>') === snapshotSteps?.map((s) => s.id).join('>'),
  `编排步骤 JSON 往返后拓扑一致(实际 ${snapshotRoundTrip?.map((s) => s.id).join('>')})`)

const outputStep = parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [
  { id: 'a', agent: 'planner', prompt: 'x', output: ['sections', 'palette'] },
] }))
ok(outputStep !== null && Array.isArray(outputStep[0].output) && outputStep[0].output.join(',') === 'sections,palette', 'agent 步骤 typed output 能解析')
ok(parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [{ id: 'a', agent: 'planner', prompt: 'x', output: ['bad name'] }] })) === null, 'output 字段名非法 → null')

const ifStep = parsePipeline(JSON.stringify({ schemaVersion: 'v1alpha1', steps: [
  { id: 'a', agent: 'planner', prompt: 'x', 'if': '{{ answer }} == 确认' },
  { id: 'g', needs: ['a'], approve: 'ok?', 'if': '{{ steps.a.outputs.summary }} contains 通过' },
] }))
ok(ifStep !== null && ifStep[0].if === '{{ answer }} == 确认', 'step if 条件(agent)能解析')
ok(ifStep !== null && ifStep[1].if === '{{ steps.a.outputs.summary }} contains 通过', 'step if 条件(gate)能解析')

// ── 2b) evalCondition 执行级回归(§17.14):{{ }} 左值、steps output、answer、不可解析 → true ──
const cv = {
  answer: '确认',
  answerChoice: '甲',
  'steps.a.outputs.summary': '方案已通过评审',
  'steps.a.outputs.sections': '["登录","列表"]',
}
ok(evalCondition('{{ answer }} == 确认', cv) === true, '{{ answer }} == 确认(answer=确认)→ true')
ok(evalCondition('{{ answer }} == 确认', { ...cv, answer: '否' }) === false, '{{ answer }} == 确认(answer=否)→ false')
ok(evalCondition('answer == 确认', cv) === true, '裸变量名 answer == 确认 → true')
ok(evalCondition('{{ answer }} == "确认"', cv) === true, '右值带引号 {{ answer }} == "确认" → true')
ok(evalCondition('{{ answer }} != 确认', cv) === false, '{{ answer }} != 确认(answer=确认)→ false')
ok(evalCondition('{{ answer }} != 确认', { ...cv, answer: '否' }) === true, '{{ answer }} != 确认(answer=否)→ true')
ok(evalCondition('{{ steps.a.outputs.summary }} contains 通过', cv) === true, 'steps output contains → true')
ok(evalCondition('{{ steps.a.outputs.summary }} contains 拒绝', cv) === false, 'steps output contains 未命中 → false')
ok(evalCondition('{{ answerChoice }}', cv) === true, '裸变量非空 → true')
ok(evalCondition('{{ answerChoice }}', { ...cv, answerChoice: '' }) === false, '裸变量为空串 → false')
ok(evalCondition('{{ ghost }} == 确认', cv) === true, '左值不可解析 → true(不跳过)')
ok(evalCondition('', cv) === true, '空条件 → true')
ok(evalCondition('{{ steps.a.outputs.sections }} == ["登录","列表"]', cv) === true, '数组输出保留 JSON 文本可比较')

// ── 3) 默认编排派生:mode 筛选 + 复查轮开关 ──
const config = minimalConfig()
const fakeReq = (type) => ({ type, idea: '做一个待办清单', note: '', message: '', lang: 'zh' })
const gen = defaultPipeline(config, fakeReq('generate'), 'zh', () => 1000_000)
ok(gen.map((s) => s.id).join('>') === 'planner>coder>baseline>reviewer>rebuild', `generate 默认编排(实际 ${gen.map((s) => s.id).join('>')})`)
const chat = defaultPipeline(config, fakeReq('chat'), 'zh', () => 1000_000)
ok(chat.every((s) => s.id !== 'planner'), `chat 去掉 planner(实际 ${chat.map((s) => s.id).join('>')})`)
// 复查轮开关关掉 → reviewer/rebuild 都去掉
const noReview = defaultPipeline({ ...config, designReview: 'off' }, fakeReq('generate'), 'zh', () => 1000_000)
ok(noReview.every((s) => s.id !== 'reviewer' && s.id !== 'rebuild'), `designReview=off 去掉复查轮(实际 ${noReview.map((s) => s.id).join('>')})`)

// ── 4) 提示词:加载默认树 + 插值 ──
const prompts = await loadPromptSet(config.promptsDir, { req: fakeReq('generate'), lang: 'zh', mode: 'generate', imageInputEnabled: true })
ok(!!prompts, 'loadPromptSet 成功')
const sysPlanner = prompts.system('planner')
const sysCoder = prompts.system('coder')
const sysReviewer = prompts.system('reviewer')
ok(sysPlanner.length > 100 && sysCoder.length > 10_000 && sysReviewer.length > 100,
  `三个 system prompt 非空(planner ${sysPlanner.length} / coder ${sysCoder.length} / reviewer ${sysReviewer.length} 字符)`)
ok(sysCoder.includes('设计系统契约') || sysCoder.includes('组件库'), 'coder system prompt 含设计系统/组件库契约')

const vars = prompts.vars()
ok(vars.plannerPrompt.length > 50, `{{plannerPrompt}} 已解析(${vars.plannerPrompt.length} 字符)`)
ok(vars.coderPrompt.length > 200, `{{coderPrompt}} 已解析(${vars.coderPrompt.length} 字符)`)
ok(vars.reviewerPrompt.length > 200, `{{reviewerPrompt}} 已解析(${vars.reviewerPrompt.length} 字符)`)

// ── 5) 合流:默认编排每个 agent 节点的 prompt 都能插值成真实文本,且不含未解析占位符 ──
const UNRESOLVED = /\{\{\s*\w+\s*\}\}/
for (const s of parsed) {
  if (!('agent' in s)) continue
  const text = interpolate(s.prompt, vars)
  ok(!UNRESOLVED.test(text), `节点 ${s.id} 的 prompt 插值后无残留占位符(${text.length} 字符)`)
}
// 反向:引用不存在的变量应原样保留(便于发现漏配)
ok(interpolate('{{ nope }}', vars) === '{{ nope }}', '未定义变量原样保留(不静默吞掉)')

// ── 6) chat 模式:user/generate.md 与 user/chat.md 是不同的文件 ──
const chatPrompts = await loadPromptSet(config.promptsDir, { req: fakeReq('chat'), lang: 'zh', mode: 'chat', imageInputEnabled: true })
ok(chatPrompts.user('chat').includes('修改') && !chatPrompts.user('chat').includes('从零构建'), 'chat user prompt 是修改语义')
ok(prompts.user('generate').includes('从零构建'), 'generate user prompt 是从零构建语义')

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
