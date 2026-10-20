/**
 * 极简行内富文本:把 `` `code` `` 渲染成 <code>、`**bold**` 渲染成 <b>,其余原样。
 *
 * 只为词典里少数需要行内强调的长句服务 —— 纯文本词条直接 t() 就行,不必套这层。
 * 不递归、不支持嵌套,匹配不到标记时整段当普通文本,所以漏写标记只会丢样式、不会丢内容。
 */
const TOKEN_RE = /(`[^`]+`|\*\*[^*]+\*\*)/g

export default function RichText({ text }: { text: string }) {
  const parts = text.split(TOKEN_RE).filter((p) => p !== '')
  return (
    <>
      {parts.map((p, i) => {
        if (p.length > 2 && p.startsWith('`') && p.endsWith('`')) {
          return (
            <code key={i} className="font-mono">
              {p.slice(1, -1)}
            </code>
          )
        }
        if (p.length > 4 && p.startsWith('**') && p.endsWith('**')) return <b key={i}>{p.slice(2, -2)}</b>
        return <span key={i}>{p}</span>
      })}
    </>
  )
}
