import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../../lib/api'
import type { FileEntry, Graph } from '../../lib/orchestrationGraph'
import { LinkStrip, PanelTitle } from './OrchestrationGraph'

/**
 * 编排资源的编辑器(后台 /admin/orchestration 下半部分,与关系图共用同一份状态)。
 * 三份单 JSON 配置(流水线 / agents / mcp)共用 JsonResourceEditor;两棵文件树(提示词 / 技能)共用 FileTreeEditor。
 * 中文界面是刻意的:后台面向中文运营,不接 i18n(AGENTS.md §6)。
 */

const mono = 'font-mono text-xs leading-relaxed'
const button =
  'rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-300 hover:border-gray-500 disabled:opacity-40'
const primary =
  'rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50'

// ───────────────────────── 公共小块 ─────────────────────────

export function StatusChips({ active, activeLabel, defaultLabel, savedAt }: { active: boolean; activeLabel: string; defaultLabel: string; savedAt: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {savedAt && <span className="text-xs text-gray-600">更新于 {savedAt}</span>}
      <span className={`rounded-full px-2.5 py-1 text-xs ${active ? 'bg-indigo-500/15 text-indigo-300' : 'bg-gray-800 text-gray-400'}`}>
        {active ? activeLabel : defaultLabel}
      </span>
    </div>
  )
}

export function Hints({ title, rows, footnote }: { title: string; rows: readonly (readonly [string, string])[]; footnote?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-4">
      <h3 className="mb-2 text-sm font-semibold text-gray-200">{title}</h3>
      <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-xs leading-5">
            <dt className="shrink-0 font-mono text-indigo-300">{k}</dt>
            <dd className="text-gray-500">{v}</dd>
          </div>
        ))}
      </dl>
      {footnote && <p className="mt-2 text-[11px] leading-5 text-gray-600">{footnote}</p>}
    </div>
  )
}

async function saveBlob(url: string, name: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败:${res.status}`)
  const blobUrl = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(blobUrl)
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

const fileInput =
  'block w-full max-w-xs rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-300 file:mr-3 file:rounded-md file:border-0 file:bg-gray-700 file:px-3 file:py-1.5 file:text-xs file:text-gray-200 hover:file:bg-gray-600'

// ───────────────────────── 单 JSON 编辑器 ─────────────────────────

interface JsonProps {
  value: string
  onChange: (v: string) => void
  onSave: () => Promise<boolean>
  saving: boolean
  dirty: boolean
  example: string
  exampleLabel: string
  clearLabel: string
  /** 清空状态下实际生效的内容(只读展示),让「空 = 内置默认」看得见 */
  effective?: string
  /** 清空状态下的说明 */
  effectiveNote?: ReactNode
  hints: ReactNode
}

export function JsonResourceEditor({ value, onChange, onSave, saving, dirty, example, exampleLabel, clearLabel, effective, effectiveNote, hints }: JsonProps) {
  const blank = value.trim() === ''
  return (
    <>
      <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <label htmlFor="orch-json" className="text-sm font-semibold text-gray-200">
            {blank && effective ? '当前生效:内置默认(只读)' : 'JSON'}
            {dirty && <span className="ml-2 text-xs font-normal text-indigo-300">未保存</span>}
          </label>
          <div className="flex gap-2">
            {blank ? (
              effective && (
                <button type="button" onClick={() => onChange(effective)} className={`${button} !text-indigo-300 hover:!border-indigo-500/60`}>
                  在此基础上修改
                </button>
              )
            ) : (
              <>
                <button type="button" onClick={() => onChange(example)} className={`${button} !text-indigo-300 hover:!border-indigo-500/60`}>
                  {exampleLabel}
                </button>
                <button type="button" onClick={() => onChange('')} className={button}>
                  {clearLabel}
                </button>
              </>
            )}
          </div>
        </div>
        {blank && effective ? (
          <textarea
            rows={18}
            readOnly
            spellCheck={false}
            aria-label="当前生效的内置默认(只读)"
            className={`w-full resize-y cursor-default rounded-lg border border-gray-800 bg-gray-950/40 p-3 text-gray-400 outline-none ${mono}`}
            value={effective}
          />
        ) : blank ? (
          <div className="rounded-lg border border-dashed border-gray-800 bg-gray-950/40 p-3 text-xs leading-6 text-gray-500">{effectiveNote}</div>
        ) : (
        <textarea
          id="orch-json"
          rows={18}
          spellCheck={false}
          className={`w-full resize-y rounded-lg border border-gray-700 bg-gray-950/60 p-3 text-gray-100 outline-none placeholder:text-gray-600 focus:border-indigo-500 ${mono}`}
          placeholder={example}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        )}
        {blank && effective && <p className="mt-2 text-[11px] text-gray-600">{effectiveNote}</p>}
        {dirty && <p className="mt-2 text-[11px] text-gray-600">修改会实时反映到上方关系图;保存后下一次任务派发才生效。</p>}
      </div>
      <SaveRow onSave={onSave} saving={saving} dirty={dirty} />
      {hints}
    </>
  )
}

function SaveRow({ onSave, saving, dirty, label }: { onSave: () => Promise<boolean>; saving: boolean; dirty: boolean; label?: string }) {
  return (
    <div className="mt-3 flex justify-end">
      <button type="button" onClick={() => void onSave()} disabled={saving} className={primary}>
        {saving ? '保存中…' : dirty ? label ?? '保存修改' : '保存'}
      </button>
    </div>
  )
}

// ───────────────────────── 流水线 ─────────────────────────

const PIPELINE_HINTS = [
  ['schemaVersion', '固定 "v1alpha1"(演进用)'],
  ['steps', '节点数组;DAG 边用每个节点的 needs: [依赖的 id…],缺省 = 起点'],
  ['agent', 'planner | coder | reviewer(内置)、注册表里的名字,或内联对象 { systemPrompt, tools, skills, mcp }'],
  ['prompt', '该节点的用户提示词,支持下方模板变量'],
  ['command: "build"', '平台确定性构建(还原平台文件 + setLocale + vite build)'],
  ['approve / choose', '人门节点:"approve": "确认问题" 或 "choose": { question, options(≥2) }'],
  ['output', '类型化输出字段(^[a-zA-Z_][a-zA-Z0-9_]*$,≤10),下游用 {{ steps.<id>.outputs.<字段> }}'],
  ['if', '条件跳过,如 "{{ answer }} == 确认";为假则跳过该节点'],
  ['rollback', '仅构建节点:失败时回滚到最近一次成功构建的源码'],
  ['tools', '可选,覆盖该 agent 默认工具集,⊆ {read,bash,edit,write,grep,find,ls}'],
  ['images', '把用户上传的图片作为多模态输入交给该节点(默认 false)'],
  ['deliver', '该节点收尾正文作为交付说明'],
  ['continue_on_failure', '该节点失败不判 job 失败(≈ 复查轮),依赖它的节点照跑'],
  ['budget_ms / min_budget_ms', '节点预算 / 剩余预算低于它就跳过'],
] as const

const PIPELINE_VARS = [
  ['{{ plannerPrompt }}', '需求规划(来自 user/planner.md)'],
  ['{{ coderPrompt }}', '实现或改稿(user/generate.md / user/chat.md)'],
  ['{{ reviewerPrompt }}', '设计总监复查精修(user/polish.md)'],
  ['{{ idea }}', '一句话想法(仅 generate 有值)'],
  ['{{ note }}', '用户补充要求'],
  ['{{ message }}', '改稿要求(仅 chat 有值)'],
  ['{{ history }}', '此前对话(压缩后的上下文)'],
  ['{{ connectors }}', '本轮连接器清单'],
  ['{{ attachments }}', '用户附件清单'],
  ['{{ langName }}', '目标语言名称'],
  ['{{ langCode }}', '目标语言码'],
  ['{{ localeCode }}', 'locale 码(如 zh-CN)'],
  ['{{ steps.<id>.outputs.<字段> }}', '上游节点的类型化输出'],
  ['{{ answer }}', '用户对人门节点的作答'],
] as const

export function PipelineHints() {
  return (
    <>
      <Hints
        title="字段说明"
        rows={PIPELINE_HINTS}
        footnote="护栏(平台文件还原 / setLocale 强制 / 失败回滚 / 空转检测)由 agent 侧强制,后台改不掉;任一节点非法(含环、悬空 needs)保存时会在这里报中文错误。"
      />
      <div className="mt-3">
        <Hints
          title="模板变量(写在 prompt / progress / if 里)"
          rows={PIPELINE_VARS}
          footnote="提示词文件里的 shared/ 片段也是变量(文件名 data-sdk → {{ dataSdk }}),可直接写进节点提示词。"
        />
      </div>
    </>
  )
}

// ───────────────────────── Agent 注册表 ─────────────────────────

export const AGENTS_EXAMPLE = JSON.stringify(
  {
    clarify: {
      systemPrompt:
        '你是需求澄清助手。用户给了一个网站或应用的初步想法,你的职责是:在动手实现之前,把模糊点和缺失的关键信息识别出来(目标用户、核心功能、内容来源、风格偏好),并用简洁的中文给出结构化的澄清问题或建议。只读、只提问、不写代码。',
      tools: ['read'],
    },
  },
  null,
  2
)

const AGENT_HINTS = [
  ['<name>', '键即 agent 名,必须 ^[a-z][a-z0-9_-]*$;流水线里用 "agent": "<name>" 引用'],
  ['systemPrompt', '内联 system prompt;缺省按名回落 prompts/system/<name>.md,再回落 coder'],
  ['tools', '可选,⊆ {read,bash,edit,write,grep,find,ls};缺省 = coder 默认工具集'],
  ['skills', '可选:该 agent 启用的技能名子集(后台 skillset 里存在的技能),缺省 = 不注入技能'],
  ['mcp', '可选:该 agent 可用的 MCP 服务名子集,缺省 = 不注入 MCP'],
  ['model', '预留(per-agent 模型覆盖),当前校验但不生效'],
] as const

export function AgentsHints() {
  return (
    <Hints
      title="字段说明"
      rows={AGENT_HINTS}
      footnote="也可以不在注册表里定义,直接在流水线节点上内联 agent 对象。未知 agent 名不会打断生成:运行时回落 coder 默认并记告警。"
    />
  )
}

// ───────────────────────── MCP ─────────────────────────

export const MCP_EXAMPLE = JSON.stringify(
  {
    servers: {
      search: {
        type: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: '${SEARCH_TOKEN}' },
        exposure: 'direct',
        description: '联网搜索',
      },
      fs: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
        exposure: 'direct',
        description: '本地文件系统',
      },
    },
  },
  null,
  2
)

const MCP_HINTS = [
  ['servers', '对象,键即服务名(^[a-z][a-z0-9_-]*$);要被某个 agent 的 mcp 字段引用才会挂载'],
  ['type', 'stdio | http;可省略,靠 command/url 自动判定'],
  ['command/args/env/cwd', 'stdio 服务:启动命令。属任意代码执行,启用前需安全评审'],
  ['url/headers', 'http 服务:地址(外部必须 https)+ 请求头,值可引用 ${NAME}'],
  ['exposure', 'codemode|deferred|direct|hidden;Forge 强制缺省 direct(否则工具对模型不可见)'],
  ['toolExposure', '单工具暴露白名单(工具名或 * 通配),可只暴露部分工具'],
  ['凭证', 'env 每个值、敏感头(Authorization/Token/Key/Secret/…)必须是完整 ${NAME} 引用,绝不写明文密钥'],
] as const

export function McpHints() {
  return (
    <Hints
      title="字段说明"
      rows={MCP_HINTS}
      footnote="stdio 服务 = 在隔离工作区内执行任意命令,http 服务 = 外部信任面;新增服务前先做安全评审。"
    />
  )
}

// ───────────────────────── 文件树(提示词 / 技能共用) ─────────────────────────

interface FileTreeProps {
  files: FileEntry[]
  selected: string | null
  onSelect: (path: string) => void
  onChange: (path: string, content: string) => void
  dirty: Set<string>
  /** 文件标题右侧的额外操作(删除等) */
  headExtra?: ReactNode
  /** 编辑框上方的关系条 */
  above?: ReactNode
  empty: ReactNode
  footnote: ReactNode
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

function fmtSize(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`
}

export function FileTreeEditor({ files, selected, onSelect, onChange, dirty, headExtra, above, empty, footnote }: FileTreeProps) {
  const current = files.find((f) => f.path === selected) ?? null
  return (
    <div className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-3">
        <h3 className="mb-2 text-sm font-semibold text-gray-200">文件({files.length})</h3>
        {files.length === 0 ? (
          <p className="text-xs leading-5 text-gray-500">{empty}</p>
        ) : (
          <ul className="space-y-0.5">
            {files.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => onSelect(f.path)}
                  aria-current={selected === f.path}
                  className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                    selected === f.path ? 'bg-indigo-500/20 text-indigo-200' : 'text-gray-400 hover:bg-gray-800'
                  }`}
                  title={f.path}
                >
                  {dirty.has(f.path) && <span className="shrink-0 text-indigo-400">●</span>}
                  <span className="truncate">
                    {f.path.slice(dirOf(f.path).length + 1)}
                    <span className="ml-2 text-gray-600">{dirOf(f.path)}/</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex min-w-0 flex-col rounded-2xl border border-gray-800 bg-gray-900/30 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="truncate font-mono text-sm font-semibold text-gray-200">{current ? current.path : '选择文件'}</h3>
          {current && (
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[11px] text-gray-600">
                {fmtSize(current.content.length)}
                {dirty.has(current.path) && <span className="ml-2 text-indigo-400">未保存</span>}
              </span>
              {headExtra}
            </div>
          )}
        </div>
        {above}
        {current ? (
          <textarea
            key={current.path}
            rows={22}
            spellCheck={false}
            aria-label={current.path}
            className={`w-full flex-1 resize-y rounded-lg border border-gray-700 bg-gray-950/60 p-3 text-gray-300 outline-none focus:border-indigo-500 ${mono}`}
            value={current.content}
            onChange={(e) => onChange(current.path, e.target.value)}
          />
        ) : (
          <p className="text-xs text-gray-500">点击左侧文件名编辑内容。</p>
        )}
        <p className="mt-2 text-[11px] leading-5 text-gray-600">{footnote}</p>
      </div>
    </div>
  )
}

// ───────────────────────── 提示词 ─────────────────────────

interface FileEditorProps {
  files: FileEntry[]
  /** 最近一次保存 / 加载的内容,用来算哪些文件改过 */
  saved: FileEntry[]
  selected: string | null
  onSelect: (path: string) => void
  onChange: (path: string, content: string) => void
  onRemove: (path: string) => void
  onSave: () => Promise<boolean>
  onReload: () => Promise<void>
  saving: boolean
  graph: Graph
  onOpen: (resource: 'agents' | 'pipeline' | 'prompts', focus?: string) => void
}

function dirtyPaths(files: FileEntry[], saved: FileEntry[]): Set<string> {
  const before = new Map(saved.map((f) => [f.path, f.content]))
  const after = new Set(files.map((f) => f.path))
  const out = new Set<string>()
  for (const f of files) if (before.get(f.path) !== f.content) out.add(f.path)
  for (const p of before.keys()) if (!after.has(p)) out.add(p)
  return out
}

/** 文件列表上方那排操作(上传 / 下载)的异常提示;保存结果由页面统一提示 */
function useNotice() {
  const [text, setText] = useState('')
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setText('')
    try {
      await fn()
    } catch (err) {
      setText(`${label}:${(err as Error).message}`)
    }
  }
  return [text, run] as const
}

interface PromptVersion {
  key: string
  at: string
  size: number
}

function PromptsEditor(props: FileEditorProps & { active: boolean }) {
  const { files, saved, selected, onSelect, onChange, onSave, onReload, saving, graph, onOpen, active } = props
  const [versions, setVersions] = useState<PromptVersion[]>([])
  const [notice, run] = useNotice()
  const fileRef = useRef<HTMLInputElement>(null)
  const dirty = dirtyPaths(files, saved)

  const loadVersions = async () => {
    try {
      const data = await api<{ versions: PromptVersion[] }>('/api/admin/prompts/versions')
      setVersions(data.versions)
    } catch {
      // 历史加载失败不阻塞主流程
    }
  }

  // 版本列表跟着「最近一次保存的内容」走:首次加载、保存、上传、恢复之后都会变
  useEffect(() => {
    void loadVersions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved])

  /** 恢复某个历史版本后整体刷新 */
  const restore = (key: string | null) => async () => {
    await api('/api/admin/prompts/restore', { method: 'POST', body: { key } })
    await onReload()
  }

  const link = selected ? graph.promptLinks[selected] : undefined

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-gray-800 bg-gray-900/40 p-3">
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          aria-label="上传提示词 zip"
          className={fileInput}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (!f) return
            void run('上传失败', async () => {
              await api('/api/admin/prompts', { method: 'PUT', body: { zip_base64: await readBase64(f) } })
              await onReload()
            }).finally(() => {
              if (fileRef.current) fileRef.current.value = ''
            })
          }}
        />
        <button type="button" onClick={() => void run('下载失败', () => saveBlob('/api/admin/prompts/download', 'promptset.zip'))} className={button}>
          下载当前提示词
        </button>
        <span className="text-[11px] text-gray-600">上传 zip 或直接在线编辑均可;两种都会成为可恢复的历史版本。</span>
      </div>
      {notice && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{notice}</p>}

      <FileTreeEditor
        files={files}
        selected={selected}
        onSelect={onSelect}
        onChange={onChange}
        dirty={dirty}
        empty="还没有提示词文件。"
        footnote={
          <>
            模板变量:{' '}
            <code className="text-gray-500">
              {'{{langName}} {{localeCode}} {{ideaWithNote}} {{requirement}} {{history}} {{briefs}} {{answer}} {{langBlock}} {{reviewerLang}} {{polishLang}}'}
            </code>
            ,加上 shared/ 下的片段(文件名 data-sdk → {'{{dataSdk}}'});只有 system/ user/
            能引用 shared 片段。改错变量名会原样保留(便于发现漏配)。
          </>
        }
        above={
          link && (
            <div className="mb-2">
              <LinkStrip title="它引用的片段" items={link.uses.map((p) => ({ label: p, onClick: () => onSelect(p) }))} />
              <LinkStrip title="引用它的文件" items={link.usedBy.map((p) => ({ label: p, onClick: () => onSelect(p) }))} />
              <p className="text-[11px] leading-5 text-gray-500">
                <span className="text-gray-600">用到它的节点:</span>{' '}
                {link.steps.length === 0 ? (
                  <span className="text-gray-600">无(当前不会被任何节点用到)</span>
                ) : (
                  link.steps.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onOpen('pipeline', id)}
                      className="mr-1.5 font-mono text-indigo-300 hover:underline"
                    >
                      {id}
                    </button>
                  ))
                )}
              </p>
            </div>
          )
        }
      />
      <SaveRow onSave={onSave} saving={saving} dirty={dirty.size > 0} label={`保存修改 (${dirty.size})`} />

      <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-900/30 p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-200">历史版本</h3>
        <ul className="space-y-1">
          <li className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 px-3 py-2">
            <div className="min-w-0">
              <span className="text-xs text-gray-200">内置默认</span>
              <span className="ml-2 text-[11px] text-gray-600">agent 镜像内置提示词树</span>
            </div>
            {active ? (
              <button type="button" onClick={() => void run('恢复失败', restore(null))} className={button}>
                恢复
              </button>
            ) : (
              <span className="shrink-0 text-xs text-gray-600">当前</span>
            )}
          </li>
          {versions.length === 0 && <li className="px-3 py-2 text-[11px] text-gray-600">暂无历史,保存或上传一次后这里会出现版本。</li>}
          {versions.map((v) => (
            <li key={v.key} className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 px-3 py-2">
              <div className="min-w-0">
                <span className="text-xs text-gray-200">{new Date(v.at).toLocaleString()}</span>
                <span className="ml-2 text-[11px] text-gray-600">{fmtSize(v.size)}</span>
              </div>
              <button
                type="button"
                onClick={() => void run('恢复失败', restore(v.key))}
                disabled={saving}
                className={button}
              >
                恢复
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

// ───────────────────────── 技能 ─────────────────────────

function SkillsEditor({ files, saved, selected, onSelect, onChange, onRemove, onSave, onReload, saving, graph, onOpen }: FileEditorProps) {
  const [notice, run] = useNotice()
  const fileRef = useRef<HTMLInputElement>(null)
  const dirty = dirtyPaths(files, saved)
  const skill = selected ? /^skills\/([^/]+)\//.exec(selected)?.[1] : undefined
  const link = skill ? graph.skillLinks[skill] : undefined

  function addSkill() {
    const name = window.prompt('技能名(^[a-z][a-z0-9_-]*$,即目录名):')
    if (!name) return
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
      run('技能名不合法', () => Promise.reject(new Error(`必须是 ^[a-z][a-z0-9_-]*$:${name}`)))
      return
    }
    const path = `skills/${name}/SKILL.md`
    if (files.some((f) => f.path === path)) {
      run('无法新增', () => Promise.reject(new Error(`技能已存在:${path}`)))
      return
    }
    onChange(path, `---\nname: ${name}\ndescription: ${name} 技能的用途(一句话,给模型判断何时使用)。\n---\n\n# ${name}\n\n在此写技能的规则与步骤。\n`)
    onSelect(path)
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-gray-800 bg-gray-900/40 p-3">
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          aria-label="上传技能 zip"
          className={fileInput}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (!f) return
            void run('上传失败', async () => {
              await api('/api/admin/skills', { method: 'PUT', body: { zip_base64: await readBase64(f) } })
              await onReload()
            }).finally(() => {
              if (fileRef.current) fileRef.current.value = ''
            })
          }}
        />
        <button type="button" onClick={() => void run('下载失败', () => saveBlob('/api/admin/skills/download', 'skillset.zip'))} className={button}>
          下载当前技能
        </button>
        <button type="button" onClick={addSkill} disabled={saving} className={`${button} !border-indigo-700 !text-indigo-300 hover:!border-indigo-500`}>
          + 新增技能
        </button>
        <span className="text-[11px] text-gray-600">上传 zip 或直接在线编辑均可;保存后下一单生效。</span>
      </div>
      {notice && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{notice}</p>}

      <FileTreeEditor
        files={files}
        selected={selected}
        onSelect={onSelect}
        onChange={onChange}
        dirty={dirty}
        headExtra={
          selected && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`删除 ${selected}?保存后生效。`)) {
                  onRemove(selected)
                  const next = files.find((f) => f.path !== selected)
                  onSelect(next?.path ?? '')
                }
              }}
              className="rounded-md border border-gray-700 px-2 py-0.5 text-[11px] text-gray-400 hover:border-red-500/50 hover:text-red-400"
            >
              删除
            </button>
          )
        }
        empty="还没有任何技能。点「+ 新增技能」或上传一个 skillset.zip(形如 skills/forge-ui/SKILL.md,目录名 = 技能 id)。"
        footnote="每个技能目录必须含 SKILL.md(入口);描述写在 frontmatter 的 description,决定模型何时使用它。技能要在某个 agent 的 skills 字段里声明才会注入。"
        above={
          link && (
            <p className="mb-2 text-[11px] leading-5 text-gray-500">
              <span className="text-gray-600">引用「{skill}」的 agent:</span>{' '}
              {link.agents.length === 0 ? (
                <span className="text-gray-600">无(不会注入)</span>
              ) : (
                link.agents.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => (a.startsWith('内联@') ? onOpen('pipeline', a.slice(3)) : onOpen('agents', a))}
                    className="mr-1.5 font-mono text-indigo-300 hover:underline"
                  >
                    {a}
                  </button>
                ))
              )}
            </p>
          )
        }
      />
      <SaveRow onSave={onSave} saving={saving} dirty={dirty.size > 0} label={`保存修改 (${dirty.size})`} />
    </>
  )
}

export { PromptsEditor, SkillsEditor }
