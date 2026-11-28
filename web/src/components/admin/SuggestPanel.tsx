import { useState } from 'react'
import { api } from '../../lib/api'
import type { Resource } from '../../lib/orchestrationGraph'
import { PanelTitle, RESOURCE_LABEL } from './OrchestrationGraph'

/**
 * 后台「AI 编排助手」:一个输入框,带上全部五类编排资源的完整上下文,一次自然语言请求可跨资源一起改。
 * 生成的改动先写进本页的编辑器(关系图即时反映),运营核对后再逐项保存,绝不自动落库。
 * 中文界面是刻意的:后台面向中文运营,不接 i18n(AGENTS.md §6)。
 */

export type AdoptValue = string | Record<string, string> | Record<string, unknown>

interface ResourceNote {
  resource: Resource
  changed: boolean
  valid: boolean
  error: string | null
  changedFiles?: string[]
}

interface Changes {
  pipeline?: string
  agents?: Record<string, unknown>
  mcp?: Record<string, unknown>
  skills?: Record<string, string>
  prompts?: Record<string, string>
}

interface SuggestData {
  summary: string
  changes: Changes
  notes: ResourceNote[]
  valid: boolean
  error: string | null
}

const PLACEHOLDER =
  '例如:加一个只读的「需求澄清」agent,并在流水线里先用它澄清、再加一个 approve 确认门;同时把 coder 的提示词改成更强调深色模式。'

function preview(note: ResourceNote, changes: Changes) {
  const r = note.resource
  if (r === 'skills' || r === 'prompts') {
    const files = changes[r] as Record<string, string> | undefined
    const changed = note.changedFiles ?? []
    const paths = changed.length ? changed : Object.keys(files ?? {})
    return (
      <div className="mt-2 text-xs">
        <p className="text-gray-500">
          改动文件 {changed.length} 个:{changed.length ? changed.join('、') : '无'}
        </p>
        {paths.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-indigo-300">查看文件内容</summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-gray-950/60 p-2 font-mono text-[11px] leading-relaxed text-gray-300">
              {paths.map((p) => `### ${p}\n${files?.[p] ?? ''}`).join('\n\n')}
            </pre>
          </details>
        )}
      </div>
    )
  }
  const json = r === 'pipeline' ? changes.pipeline ?? '' : JSON.stringify(changes[r as 'agents' | 'mcp'], null, 2)
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-indigo-300">查看 JSON</summary>
      <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-gray-950/60 p-2 font-mono text-[11px] leading-relaxed text-gray-300">{json}</pre>
    </details>
  )
}

interface Props {
  /** 把一份建议写进对应编辑器(不落库) */
  onAdopt: (resource: Resource, value: AdoptValue) => void
  /** 已写进编辑器的资源 */
  adopted: Resource[]
}

export default function SuggestPanel({ onAdopt, adopted }: Props) {
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState<SuggestData | null>(null)
  const [error, setError] = useState('')

  async function generate() {
    if (!desc.trim() || busy) return
    setBusy(true)
    setData(null)
    setError('')
    try {
      const d = await api<SuggestData>('/api/admin/orchestration/suggest', {
        method: 'POST',
        body: { description: desc.trim() },
      })
      setData(d)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const changedNotes = (data?.notes ?? []).filter((n) => n.changed)

  return (
    <>
      <PanelTitle title="AI 编排助手">
        用一句话描述要改什么,助手会带上当前全部配置生成改动。结果先写进本页的编辑器(关系图即时反映),不会自动保存;核对后到对应资源里保存。
      </PanelTitle>

      <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.04] p-4">
        <label htmlFor="orch-suggest" className="mb-1 block text-xs text-gray-500">
          想怎么改
        </label>
        <textarea
          id="orch-suggest"
          rows={3}
          spellCheck={false}
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm leading-relaxed text-gray-100 outline-none focus:border-indigo-500"
          placeholder={PLACEHOLDER}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-600">一次可以说多件事,助手会按资源拆开分别校验。</p>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy || !desc.trim()}
            className="shrink-0 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? '生成中…' : 'AI 生成'}
          </button>
        </div>
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}

      {data && (
        <div className="mt-4">
          {data.summary && (
            <div className="mb-3 rounded-lg bg-gray-900/60 px-3 py-2 text-xs text-gray-300">
              <span className="text-gray-500">模型说明:</span> {data.summary}
            </div>
          )}

          {changedNotes.length > 0 && data.valid && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-emerald-500/10 px-3 py-2">
              <span className="text-xs text-emerald-300">全部通过校验。写入编辑器后请回到上方核对关系图,再逐项保存。</span>
              <button
                type="button"
                onClick={() => {
                  for (const n of changedNotes) onAdopt(n.resource, data.changes[n.resource] as AdoptValue)
                }}
                className="shrink-0 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
              >
                全部写入编辑器
              </button>
            </div>
          )}

          <ul className="space-y-3">
            {changedNotes.map((note) => (
              <li key={note.resource} className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-gray-200">{RESOURCE_LABEL[note.resource]}</span>
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${
                        note.valid ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
                      }`}
                    >
                      {note.valid ? '校验通过' : '未通过'}
                    </span>
                    {adopted.includes(note.resource) && (
                      <span className="ml-2 rounded-full bg-indigo-500/15 px-2 py-0.5 text-[11px] text-indigo-300">已写入编辑器</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onAdopt(note.resource, data.changes[note.resource] as AdoptValue)}
                    disabled={!note.valid}
                    className="shrink-0 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    写入编辑器
                  </button>
                </div>
                {note.error && <p className="mt-1.5 text-xs text-red-400">{note.error}</p>}
                {preview(note, data.changes)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
