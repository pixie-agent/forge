import { useEffect, useRef } from 'react'

/**
 * 后台任务日志面板:仅本地开发(ENVIRONMENT=local)展示完整实时日志。
 * 文本变化时自动滚到底部,配合详情页的轮询实现流式效果;线上环境仍只显示里程碑尾部。
 */
export default function AdminJobLog({ text, live }: { text: string; live?: boolean }) {
  const ref = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text])

  return (
    <div className="mt-2">
      {live && <div className="mb-1 text-xs font-medium text-emerald-400">● 本地实时日志</div>}
      <pre
        ref={ref}
        className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-950 p-3 font-mono text-xs leading-relaxed text-gray-300"
      >
        {text}
      </pre>
    </div>
  )
}
