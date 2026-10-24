/**
 * 把 agent 的原始流式日志解析成结构化的「过程事件」,供聊天区友好展示(类 Coze 的生成过程)。
 *
 * 日志格式由 agent/src/runner.ts 定义:
 *   - 思考:以 `💭 ` 起头,直到空行或下一个标记行
 *   - 工具调用:`🔧 <工具名> <入参摘要>`
 *   - 工具结果:`   ✓` / `   ✗`(回填到最近一次工具调用;状态文案由前端自己的词典渲染)
 *   - 其余文本:agent 的文字叙述
 *
 * 纯展示用途:解析失败/格式变化时退化为原文,绝不影响生成功能。
 */

import { tStatic, type DictKey } from './i18n'

export type AgentToolEvent = { kind: 'tool'; name: string; arg: string; status: 'running' | 'ok' | 'error' }
export type AgentEvent = { kind: 'thinking'; text: string } | { kind: 'say'; text: string } | AgentToolEvent

const THINK_RE = /^\s*💭\s?(.*)$/
const TOOL_RE = /^\s*🔧\s*(\S+)\s*(.*)$/
/**
 * 工具结果标记:agent 只写 ✓ / ✗ 两个符号(见 agent/src/runner.ts)——
 * 状态文案由本文件解析出来后再用前端自己的词典渲染,所以日志里不必(也不该)写死中文。
 */
const RESULT_RE = /^\s*([✓✗])\s*$/

function isMarker(line: string): boolean {
  return THINK_RE.test(line) || TOOL_RE.test(line) || RESULT_RE.test(line)
}

export function parseAgentLog(log: string): AgentEvent[] {
  if (!log) return []
  const lines = log.replace(/\r\n/g, '\n').split('\n')
  const events: AgentEvent[] = []
  let lastTool: AgentToolEvent | null = null
  let say: string[] = []

  const flushSay = () => {
    const text = say.join('\n').trim()
    if (text) events.push({ kind: 'say', text })
    say = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const t = THINK_RE.exec(line)
    if (t) {
      flushSay()
      const buf = [t[1]]
      while (i + 1 < lines.length && lines[i + 1].trim() && !isMarker(lines[i + 1])) buf.push(lines[++i])
      const text = buf.join('\n').trim()
      if (text) events.push({ kind: 'thinking', text })
      continue
    }

    const tm = TOOL_RE.exec(line)
    if (tm) {
      flushSay()
      lastTool = { kind: 'tool', name: tm[1], arg: tm[2].trim(), status: 'running' }
      events.push(lastTool)
      continue
    }

    const rm = RESULT_RE.exec(line)
    if (rm) {
      if (lastTool) lastTool.status = rm[1] === '✓' ? 'ok' : 'error'
      lastTool = null
      continue
    }

    if (!line.trim()) {
      flushSay()
      continue
    }
    say.push(line)
  }
  flushSay()
  return events
}

/** 工具名 → 词典键(与 runner.ts 的写文件摘要配合,呈现为「正在编写 src/App.jsx」)。
 *  词条在词典里(中/英各一份);这里用非组件的 tStatic 取词,所以调用方签名不变。 */
const TOOL_VERB_KEY: Record<string, DictKey> = {
  write: 'tool.write',
  edit: 'tool.edit',
  read: 'tool.read',
  bash: 'tool.bash',
  grep: 'tool.grep',
  find: 'tool.find',
  ls: 'tool.ls',
}

export function toolVerb(name: string): string {
  return tStatic(TOOL_VERB_KEY[name] ?? 'tool.other')
}

/** 从过程事件里提取本次被写入/修改的文件(去重,保持出现顺序) */
export function collectChangedFiles(events: AgentEvent[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of events) {
    if (e.kind !== 'tool' || (e.name !== 'write' && e.name !== 'edit')) continue
    const file = e.arg.split(/\s+/)[0]
    if (file && !seen.has(file)) {
      seen.add(file)
      out.push(file)
    }
  }
  return out
}