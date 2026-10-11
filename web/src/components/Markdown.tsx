import type { ReactNode } from 'react'

/**
 * 极简 Markdown 渲染(无第三方依赖):支持标题、有序/无序列表、代码块、行内代码与加粗。
 * agent 的交付说明就是这段 Markdown;渲染成 React 元素而非 innerHTML,避免注入风险。
 */

/** 行内解析:`**加粗**` 与 `` `代码` `` */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[2] !== undefined) {
      out.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-gray-100">
          {m[2]}
        </strong>
      )
    } else if (m[3] !== undefined) {
      out.push(
        <code key={`${keyPrefix}-c${i}`} className="rounded bg-gray-950/50 px-1 py-0.5 font-mono text-[0.85em] text-indigo-200">
          {m[3]}
        </code>
      )
    }
    last = m.index + m[0].length
    i++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // 代码块 ```lang ... ```
    if (/^```/.test(line.trim())) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i])
        i++
      }
      i++ // 跳过结束围栏
      blocks.push(
        <pre
          key={key++}
          className="overflow-auto rounded-lg border border-gray-800 bg-gray-950/50 p-2.5 font-mono text-[11px] leading-relaxed text-gray-300"
        >
          {buf.join('\n')}
        </pre>
      )
      continue
    }

    // 标题
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1].length
      const cls =
        level <= 2 ? 'text-sm font-semibold text-gray-100' : 'text-xs font-semibold text-indigo-200'
      blocks.push(
        <p key={key++} className={cls}>
          {inline(h[2], `h${key}`)}
        </p>
      )
      i++
      continue
    }

    // 无序列表
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      blocks.push(
        <ul key={key++} className="ml-4 list-disc space-y-1">
          {items.map((it, idx) => (
            <li key={idx}>{inline(it, `ul${key}-${idx}`)}</li>
          ))}
        </ul>
      )
      continue
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push(
        <ol key={key++} className="ml-5 list-decimal space-y-1">
          {items.map((it, idx) => (
            <li key={idx}>{inline(it, `ol${key}-${idx}`)}</li>
          ))}
        </ol>
      )
      continue
    }

    // 空行
    if (!line.trim()) {
      i++
      continue
    }

    // 段落:合并连续普通行
    const para: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i])) {
      para.push(lines[i])
      i++
    }
    blocks.push(<p key={key++}>{inline(para.join(' '), `p${key}`)}</p>)
  }

  return <div className="space-y-2 text-sm leading-relaxed">{blocks}</div>
}