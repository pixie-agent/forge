import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { formatFullTime } from '../lib/format'
import { useT, type DictKey } from '../lib/i18n'
import type { BlobObjectMeta, KvKeyMeta, SiteDataEnv, SqlObject, SqlResult } from '../lib/types'

/**
 * 项目数据控制台:查看/管理生成应用在平台上的三类项目级数据,按环境(测试/线上)隔离。
 *   - 键值(KV):通过 kv 接口写入的键值
 *   - 对象(R2):通过 blob 接口上传的文件
 *   - SQL:该项目该环境的独立 SQLite 库(DBeaver 风格:库结构树 + 表数据网格 + SQL 编辑器);
 *     生成应用通过 db 接口写入的文档集合也在这里以表的形式出现
 * 三类都只属于当前项目,别的项目读写不到;测试环境与线上环境互不可见。
 */
type Kind = 'kv' | 'blob' | 'sql'

/** 环境/类型标签只存词条键,渲染时才取文本(切语言时按钮文字跟着变) */
const ENVS: { key: SiteDataEnv; labelKey: DictKey; hintKey: DictKey }[] = [
  { key: 'draft', labelKey: 'env.test', hintKey: 'data.env.draftHint' },
  { key: 'live', labelKey: 'env.liveLabel', hintKey: 'data.env.liveHint' },
]
const KINDS: { key: Kind; labelKey?: DictKey; label?: string }[] = [
  { key: 'kv', labelKey: 'data.kind.kv' },
  { key: 'blob', labelKey: 'data.kind.blob' },
  { key: 'sql', label: 'SQL' },
]

export default function DataPanel({ projectId }: { projectId: string }) {
  const t = useT()
  const [env, setEnv] = useState<SiteDataEnv>('live')
  const [kind, setKind] = useState<Kind>('kv')
  const [error, setError] = useState('')
  const hintKey = ENVS.find((e) => e.key === env)?.hintKey
  const hintText =
    kind === 'sql'
      ? t('data.sqlHint', { env: env === 'draft' ? t('env.testShort') : t('env.live') })
      : hintKey
        ? t(hintKey)
        : ''

  return (
    <div className="mx-auto max-w-3xl p-0 md:p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-lg border border-gray-700 p-0.5 text-xs">
          {ENVS.map((e) => (
            <button
              key={e.key}
              onClick={() => setEnv(e.key)}
              className={`rounded-md px-3 py-1.5 ${env === e.key ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}
            >
              {t(e.labelKey)}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-gray-700 p-0.5 text-xs">
          {KINDS.map((k) => (
            <button
              key={k.key}
              onClick={() => setKind(k.key)}
              className={`rounded-md px-3 py-1.5 ${kind === k.key ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}
            >
              {k.labelKey ? t(k.labelKey) : k.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3 text-xs text-gray-600">{hintText}</div>
      {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}
      {kind === 'kv' && <KvView key={`kv-${env}`} projectId={projectId} env={env} onError={setError} />}
      {kind === 'blob' && <BlobView key={`blob-${env}`} projectId={projectId} env={env} onError={setError} />}
      {kind === 'sql' && <SqlView key={`sql-${env}`} projectId={projectId} env={env} />}
    </div>
  )
}

// ---------- 键值(KV) ----------

function KvView({ projectId, env, onError }: { projectId: string; env: SiteDataEnv; onError: (m: string) => void }) {
  const t = useT()
  const [keys, setKeys] = useState<KvKeyMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api<{ keys: KvKeyMeta[] }>(`/api/projects/${projectId}/kv?env=${env}`)
      setKeys(data.keys)
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [projectId, env, onError])

  useEffect(() => {
    load()
  }, [load])

  async function open(key: string) {
    setSelected(key)
    setSaved(false)
    try {
      const data = await api<{ value: unknown; exists: boolean }>(`/api/projects/${projectId}/kv/${encodeURIComponent(key)}?env=${env}`)
      setText(data.exists ? JSON.stringify(data.value, null, 2) : '')
    } catch (err) {
      setText('')
      onError((err as Error).message)
    }
  }

  async function save() {
    if (!selected) return
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      onError(t('data.jsonInvalid'))
      return
    }
    setSaving(true)
    try {
      await api(`/api/projects/${projectId}/kv/${encodeURIComponent(selected)}?env=${env}`, { method: 'PUT', body: { value } })
      setSaved(true)
      load()
      setTimeout(() => setSaved(false), 1600)
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(key: string) {
    if (!confirm(t('data.confirmDeleteKey', { key }))) return
    try {
      await api(`/api/projects/${projectId}/kv/${encodeURIComponent(key)}?env=${env}`, { method: 'DELETE' })
      if (selected === key) {
        setSelected(null)
        setText('')
      }
      load()
    } catch (err) {
      onError((err as Error).message)
    }
  }

  function startCreate() {
    setCreating(true)
    setNewKey('')
  }

  function confirmCreate() {
    const key = newKey.trim()
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(key)) {
      onError(t('data.keyNameInvalid'))
      return
    }
    setCreating(false)
    setSelected(key)
    setText('')
    setSaved(false)
  }

  if (loading) return <div className="text-sm text-gray-500">{t('common.loading')}</div>

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="max-h-56 w-full shrink-0 space-y-1 overflow-auto md:max-h-none md:w-48">
        <button
          onClick={startCreate}
          className="mb-1 w-full rounded-lg border border-dashed border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:border-gray-600 hover:text-gray-200"
        >
          {t('data.newKey')}
        </button>
        {creating && (
          <div className="space-y-1 rounded-lg border border-gray-700 p-2">
            <input
              autoFocus
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmCreate()
                if (e.key === 'Escape') setCreating(false)
              }}
              placeholder={t('data.keyName')}
              className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 font-mono text-xs outline-none focus:border-indigo-500"
            />
            <div className="flex gap-1">
              <button onClick={confirmCreate} className="flex-1 rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-500">
                {t('common.confirm')}
              </button>
              <button onClick={() => setCreating(false)} className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-400">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
        {keys.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-600">{t('data.noKeys')}</div>
        ) : (
          keys.map((k) => (
            <div
              key={k.key}
              className={`group flex items-center justify-between rounded-lg px-3 py-2 ${
                selected === k.key ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`}
            >
              <button onClick={() => open(k.key)} className="min-w-0 flex-1 truncate text-left font-mono text-xs" title={k.key}>
                {k.key}
              </button>
              <button onClick={() => remove(k.key)} className="ml-1 shrink-0 text-red-400/60 opacity-0 hover:text-red-400 group-hover:opacity-100" title={t('common.delete')}>
                ✕
              </button>
            </div>
          ))
        )}
      </div>
      <div className="min-w-0 flex-1">
        {selected ? (
          <>
            <div className="mb-2 flex items-center justify-between">
              <span className="truncate font-mono text-xs text-gray-400" title={selected}>
                {selected}
              </span>
              <div className="flex items-center gap-2">
                {saved && <span className="text-xs text-emerald-400">{t('data.saved')}</span>}
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
                >
                  {saving ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              placeholder={t('data.valuePlaceholder')}
              className="h-64 w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-xs leading-5 text-gray-200 outline-none focus:border-indigo-500"
            />
            <div className="mt-1 text-xs text-gray-600">{t('data.valueHint')}</div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-700 p-6 text-center text-xs text-gray-500">{t('data.pickKey')}</div>
        )}
      </div>
    </div>
  )
}

// ---------- 对象(R2) ----------

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'ico', 'bmp'])
const TEXT_EXT = new Set(['txt', 'json', 'csv', 'md', 'html', 'htm', 'css', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'xml', 'yaml', 'yml', 'log'])

function extOf(key: string): string {
  const name = key.split('/').pop() ?? ''
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function BlobView({ projectId, env, onError }: { projectId: string; env: SiteDataEnv; onError: (m: string) => void }) {
  const t = useT()
  const [objects, setObjects] = useState<BlobObjectMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [textPreview, setTextPreview] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [uploading, setUploading] = useState(false)

  const contentUrl = useCallback(
    (key: string, download = false) =>
      `/api/projects/${projectId}/blob/content?env=${env}&key=${encodeURIComponent(key)}${download ? '&download=1' : ''}`,
    [projectId, env]
  )

  const load = useCallback(async () => {
    try {
      const data = await api<{ objects: BlobObjectMeta[] }>(`/api/projects/${projectId}/blob?env=${env}`)
      setObjects(data.objects)
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [projectId, env, onError])

  useEffect(() => {
    load()
  }, [load])

  async function open(key: string) {
    setSelected(key)
    setTextPreview(null)
    const ext = extOf(key)
    if (TEXT_EXT.has(ext)) {
      setPreviewLoading(true)
      try {
        const res = await fetch(contentUrl(key))
        setTextPreview(res.ok ? await res.text() : t('data.readFailed', { status: res.status }))
      } catch (err) {
        setTextPreview((err as Error).message)
      } finally {
        setPreviewLoading(false)
      }
    }
  }

  async function remove(key: string) {
    if (!confirm(t('data.confirmDeleteObject', { key }))) return
    try {
      await api(`/api/projects/${projectId}/blob/content?env=${env}&key=${encodeURIComponent(key)}`, { method: 'DELETE' })
      if (selected === key) {
        setSelected(null)
        setTextPreview(null)
      }
      load()
    } catch (err) {
      onError((err as Error).message)
    }
  }

  async function upload(file: File) {
    setUploading(true)
    try {
      const res = await fetch(contentUrl(file.name), {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      })
      if (!res.ok) {
        let msg = t('data.uploadFailed', { status: res.status })
        try {
          const data = (await res.json()) as { error?: string }
          if (data.error) msg = data.error
        } catch {
          // 非 JSON 响应
        }
        throw new Error(msg)
      }
      await load()
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  if (loading) return <div className="text-sm text-gray-500">{t('common.loading')}</div>

  const selectedMeta = objects.find((o) => o.key === selected)

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="max-h-56 w-full shrink-0 space-y-1 overflow-auto md:max-h-none md:w-48">
        <label
          className={`mb-1 block w-full cursor-pointer rounded-lg border border-dashed border-gray-700 px-3 py-1.5 text-center text-xs hover:border-gray-600 ${
            uploading ? 'text-gray-600' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {uploading ? t('data.uploading') : t('data.upload')}
          <input
            type="file"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) upload(f)
              e.target.value = ''
            }}
          />
        </label>
        {objects.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-600">{t('data.noObjects')}</div>
        ) : (
          objects.map((o) => (
            <div
              key={o.key}
              className={`group flex items-center justify-between rounded-lg px-3 py-2 ${
                selected === o.key ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`}
            >
              <button onClick={() => open(o.key)} className="min-w-0 flex-1 text-left" title={o.key}>
                <div className="truncate font-mono text-xs">{o.key}</div>
                <div className="text-[10px] text-gray-600">{formatBytes(o.size)}</div>
              </button>
              <button onClick={() => remove(o.key)} className="ml-1 shrink-0 text-red-400/60 opacity-0 hover:text-red-400 group-hover:opacity-100" title={t('common.delete')}>
                ✕
              </button>
            </div>
          ))
        )}
      </div>
      <div className="min-w-0 flex-1">
        {selected && selectedMeta ? (
          <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-xs text-gray-400" title={selected}>
                {selected}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <a href={contentUrl(selected, true)} className="rounded-lg border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800">
                  {t('data.download')}
                </a>
                <button onClick={() => remove(selected)} className="rounded-lg border border-red-500/40 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10">
                  {t('common.delete')}
                </button>
              </div>
            </div>
            <div className="mb-2 text-xs text-gray-600">
              {formatBytes(selectedMeta.size)} · {formatFullTime(selectedMeta.uploaded)}
            </div>
            {IMAGE_EXT.has(extOf(selected)) ? (
              <div className="rounded-xl border border-gray-800 bg-gray-950 p-3">
                <img src={contentUrl(selected)} alt={selected} className="mx-auto max-h-72 rounded-lg object-contain" />
              </div>
            ) : TEXT_EXT.has(extOf(selected)) ? (
              previewLoading ? (
                <div className="text-xs text-gray-500">{t('data.reading')}</div>
              ) : (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-gray-800 bg-gray-950 p-3 font-mono text-xs leading-5 text-gray-300">
                  {textPreview}
                </pre>
              )
            ) : (
              <div className="rounded-xl border border-dashed border-gray-700 p-6 text-center text-xs text-gray-500">
                {t('data.noPreview')}
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-700 p-6 text-center text-xs text-gray-500">{t('data.pickObject')}</div>
        )}
      </div>
    </div>
  )
}

// ---------- SQL(项目级 SQLite 控制台) ----------

function cellText(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

// ---------- DBeaver 式表数据网格:翻页浏览 / 单元格就地编辑 / 增行 / 删行 ----------

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** 把输入文本还原成合适参数:空 / NULL → null,纯数字 → number,其余 → 字符串 */
function coerceParam(s: string): string | number | null {
  const t = s.trim()
  if (t === '' || t.toUpperCase() === 'NULL') return null
  if (/^-?\d+$/.test(t) || /^-?\d+\.\d+$/.test(t)) return Number(t)
  return s
}

const GRID_PAGE_SIZE = 50

function TableGrid({
  projectId,
  env,
  table,
  onChanged,
}: {
  projectId: string
  env: SiteDataEnv
  table: string
  onChanged: () => void
}) {
  const t = useT()
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [withRowid, setWithRowid] = useState(true)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState<{ rowid: string; col: string } | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [newRow, setNewRow] = useState<Record<string, string>>({})
  const skipSave = useRef(false)

  const call = useCallback(
    (sql: string, params: (string | number | null)[] = []) =>
      api<SqlResult>(`/api/projects/${projectId}/sql?env=${env}`, { method: 'POST', body: { sql, params } }),
    [projectId, env]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const q = quoteIdent(table)
      let res: SqlResult
      let hasRowid = true
      try {
        // 带 rowid 以便按行定位编辑/删除
        res = await call(`SELECT rowid AS __rowid, * FROM ${q} LIMIT ? OFFSET ?`, [GRID_PAGE_SIZE, page * GRID_PAGE_SIZE])
      } catch {
        // WITHOUT ROWID 表:退回只读浏览
        hasRowid = false
        res = await call(`SELECT * FROM ${q} LIMIT ? OFFSET ?`, [GRID_PAGE_SIZE, page * GRID_PAGE_SIZE])
      }
      setWithRowid(hasRowid)
      setColumns(res.columns.filter((c) => c !== '__rowid'))
      setRows(res.rows)
      const cnt = await call(`SELECT COUNT(*) AS n FROM ${q}`)
      setTotal(Number(cnt.rows[0]?.n ?? 0))
    } catch (e) {
      setRows([])
      setColumns([])
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [call, table, page])

  useEffect(() => {
    setPage(0)
    setEdit(null)
    setAdding(false)
    setNewRow({})
  }, [table])

  useEffect(() => {
    void load()
  }, [load])

  async function submitInsert() {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      const q = quoteIdent(table)
      const cols = columns.filter((c) => (newRow[c] ?? '') !== '')
      if (cols.length === 0) {
        await call(`INSERT INTO ${q} DEFAULT VALUES`)
      } else {
        await call(
          `INSERT INTO ${q} (${cols.map(quoteIdent).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          cols.map((c) => coerceParam(newRow[c]))
        )
      }
      setAdding(false)
      setNewRow({})
      await load()
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function saveCell(rowid: string, col: string, value: string) {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      await call(`UPDATE ${quoteIdent(table)} SET ${quoteIdent(col)} = ? WHERE rowid = ?`, [coerceParam(value), rowid])
      setEdit(null)
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function deleteRow(rowid: string | number) {
    if (busy || !window.confirm(t('data.confirmDeleteRow'))) return
    setBusy(true)
    setErr('')
    try {
      await call(`DELETE FROM ${quoteIdent(table)} WHERE rowid = ?`, [rowid])
      await load()
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pages = Math.max(1, Math.ceil(total / GRID_PAGE_SIZE))

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-gray-300">{table}</span>
        <span className="text-xs text-gray-600">{t('data.rowCount', { count: total })}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => void load()}
            disabled={busy || loading}
            className="rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-40"
          >
            {t('common.refresh')}
          </button>
          <button
            onClick={() => {
              setAdding(true)
              setNewRow({})
            }}
            disabled={busy || adding}
            className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {t('data.addRow')}
          </button>
        </div>
      </div>
      {!withRowid && <div className="mb-2 text-xs text-amber-500/80">{t('data.noRowid')}</div>}
      {err && <div className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 font-mono text-xs text-red-400">{err}</div>}

      {loading ? (
        <div className="px-1 py-3 text-xs text-gray-600">{t('common.loading')}</div>
      ) : (
        <div className="max-h-[26rem] overflow-auto rounded-xl border border-gray-800">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-gray-900">
              <tr>
                <th className="border-b border-gray-700 px-3 py-1.5 text-left text-[10px] font-medium text-gray-500">{t('data.colRow')}</th>
                {columns.map((col) => (
                  <th key={col} className="whitespace-nowrap border-b border-gray-700 px-3 py-1.5 text-left font-mono font-medium text-gray-300">
                    {col}
                  </th>
                ))}
                {withRowid && <th className="border-b border-gray-700 px-3 py-1.5 text-right font-medium text-gray-500">{t('data.colActions')}</th>}
              </tr>
            </thead>
            <tbody>
              {adding && (
                <tr className="bg-indigo-500/5">
                  <td className="border-b border-gray-800 px-3 py-1 text-[10px] text-indigo-400">{t('data.newBadge')}</td>
                  {columns.map((col) => (
                    <td key={col} className="border-b border-gray-800 px-2 py-0.5">
                      <input
                        value={newRow[col] ?? ''}
                        onChange={(e) => setNewRow((r) => ({ ...r, [col]: e.target.value }))}
                        placeholder={col}
                        className="w-full min-w-[6rem] rounded border border-gray-700 bg-gray-950 px-1.5 py-0.5 font-mono text-xs text-gray-200 outline-none focus:border-indigo-500"
                      />
                    </td>
                  ))}
                  <td className="whitespace-nowrap border-b border-gray-800 px-3 py-0.5 text-right">
                    <button onClick={() => void submitInsert()} disabled={busy} className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-40">
                      {t('common.save')}
                    </button>
                    <button
                      onClick={() => {
                        setAdding(false)
                        setNewRow({})
                      }}
                      className="ml-2 text-xs text-gray-500 hover:text-gray-300"
                    >
                      {t('common.cancel')}
                    </button>
                  </td>
                </tr>
              )}
              {rows.length === 0 && !adding && (
                <tr>
                  <td colSpan={columns.length + 2} className="px-3 py-6 text-center text-xs text-gray-600">
                    {t('data.tableEmpty')}
                  </td>
                </tr>
              )}
              {rows.map((row, i) => {
                const rowid = String(row.__rowid)
                return (
                  <tr key={rowid} className="odd:bg-gray-950 even:bg-gray-900/40">
                    <td className="border-b border-gray-800/60 px-3 py-1 text-[10px] text-gray-600">{page * GRID_PAGE_SIZE + i + 1}</td>
                    {columns.map((col) => {
                      const editing = withRowid && edit?.rowid === rowid && edit.col === col
                      return (
                        <td key={col} className="max-w-[24rem] border-b border-gray-800/60 px-3 py-1 font-mono text-gray-300">
                          {editing ? (
                            <input
                              autoFocus
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur()
                                else if (e.key === 'Escape') {
                                  skipSave.current = true
                                  e.currentTarget.blur()
                                }
                              }}
                              onBlur={() => {
                                if (skipSave.current) {
                                  skipSave.current = false
                                  setEdit(null)
                                  return
                                }
                                if (edit) void saveCell(edit.rowid, edit.col, draft)
                              }}
                              className="w-full min-w-[6rem] rounded border border-indigo-500 bg-gray-950 px-1.5 py-0.5 font-mono text-xs text-gray-100 outline-none"
                            />
                          ) : (
                            <div
                              className={withRowid ? 'cursor-text truncate hover:text-white' : 'truncate'}
                              onClick={() => {
                                if (!withRowid) return
                                const text = cellText(row[col])
                                setEdit({ rowid, col })
                                setDraft(text === 'NULL' ? '' : text)
                              }}
                            >
                              {cellText(row[col])}
                            </div>
                          )}
                        </td>
                      )
                    })}
                    {withRowid && (
                      <td className="whitespace-nowrap border-b border-gray-800/60 px-3 py-1 text-right">
                        <button
                          onClick={() => void deleteRow(row.__rowid as string | number)}
                          disabled={busy}
                          className="text-xs text-red-400/80 hover:text-red-300 disabled:opacity-40"
                        >
                          {t('common.delete')}
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="mt-2 flex items-center justify-center gap-3 text-xs">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page <= 0 || busy}
            className="rounded-lg border border-gray-700 px-3 py-1 text-gray-400 disabled:opacity-30"
          >
            {t('data.prevPage')}
          </button>
          <span className="text-gray-500">
            {page + 1} / {pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            disabled={page >= pages - 1 || busy}
            className="rounded-lg border border-gray-700 px-3 py-1 text-gray-400 disabled:opacity-30"
          >
            {t('data.nextPage')}
          </button>
        </div>
      )}
    </div>
  )
}

function SqlView({ projectId, env }: { projectId: string; env: SiteDataEnv }) {
  const t = useT()
  const [objects, setObjects] = useState<SqlObject[]>([])
  const [loadingSchema, setLoadingSchema] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<'table' | 'sql'>('sql')
  const [sqlText, setSqlText] = useState(() => t('data.sqlTemplate'))
  const [result, setResult] = useState<SqlResult | null>(null)
  const [err, setErr] = useState('')
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState('')

  const loadSchema = useCallback(async () => {
    setLoadingSchema(true)
    try {
      const data = await api<{ objects: SqlObject[] }>(`/api/projects/${projectId}/schema?env=${env}`)
      setObjects(data.objects)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoadingSchema(false)
    }
  }, [projectId, env])

  useEffect(() => {
    loadSchema()
  }, [loadSchema])

  const run = useCallback(async () => {
    if (!sqlText.trim() || running) return
    setRunning(true)
    setErr('')
    setMsg('')
    try {
      const data = await api<SqlResult>(`/api/projects/${projectId}/sql?env=${env}`, { method: 'POST', body: { sql: sqlText } })
      setResult(data)
      // 建表/建索引/删除后刷新左侧库结构
      if (/\b(create|drop|alter)\b/i.test(sqlText)) loadSchema()
    } catch (e) {
      setResult(null)
      setErr((e as Error).message)
    } finally {
      setRunning(false)
    }
  }, [projectId, env, sqlText, running, loadSchema])

  function openTable(name: string) {
    setSelected(name)
    setMode('table')
  }

  function loadSelect(name: string) {
    setSqlText(`SELECT * FROM "${name}" LIMIT 100;`)
    setMode('sql')
    setMsg(t('data.loaded', { name }))
  }

  const tables = objects.filter((o) => o.type === 'table')
  const others = objects.filter((o) => o.type !== 'table')

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="max-h-56 w-full shrink-0 space-y-1 overflow-auto md:max-h-none md:w-48">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-xs text-gray-500">{t('data.schema')}</span>
          <button onClick={loadSchema} className="text-xs text-gray-500 hover:text-gray-300">
            {t('common.refresh')}
          </button>
        </div>
        {loadingSchema ? (
          <div className="px-3 py-2 text-xs text-gray-600">{t('common.loading')}</div>
        ) : objects.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-600">{t('data.noTables')}</div>
        ) : (
          <>
            {tables.map((o) => (
              <div
                key={o.name}
                className={`flex w-full items-center rounded-lg ${selected === o.name && mode === 'table' ? 'bg-gray-800/60' : 'hover:bg-gray-800/50'}`}
              >
                <button
                  onClick={() => openTable(o.name)}
                  className={`min-w-0 flex-1 truncate px-3 py-2 text-left font-mono text-xs ${
                    selected === o.name && mode === 'table' ? 'text-indigo-300' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {o.name}
                </button>
                <span className="ml-2 shrink-0 rounded-full bg-gray-700 px-2 py-0.5 text-[10px] text-gray-300">{o.count ?? 0}</span>
                <button
                  onClick={() => loadSelect(o.name)}
                  title={t('data.openInSql')}
                  className="mx-1 shrink-0 rounded px-1 text-[10px] text-gray-600 hover:text-gray-300"
                >
                  SQL
                </button>
              </div>
            ))}
            {others.map((o) => (
              <div key={`${o.type}-${o.name}`} className="flex items-center justify-between px-3 py-1 text-gray-600">
                <span className="min-w-0 truncate font-mono text-[11px]">{o.name}</span>
                <span className="ml-2 shrink-0 text-[10px]">{o.type === 'index' ? t('data.index') : o.type === 'view' ? t('data.view') : t('data.trigger')}</span>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-gray-700 p-0.5 text-xs">
            <button
              onClick={() => setMode('table')}
              disabled={!selected}
              className={`rounded-md px-2.5 py-1 ${mode === 'table' ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200'} disabled:opacity-40`}
            >
              {t('data.tabTable')}
            </button>
            <button
              onClick={() => setMode('sql')}
              className={`rounded-md px-2.5 py-1 ${mode === 'sql' ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}
            >
              {t('data.tabSql')}
            </button>
          </div>
          <span className="text-xs text-gray-500">{t('data.sqlScope', { env: env === 'draft' ? t('env.testShort') : t('env.live') })}</span>
          {mode === 'sql' && (
            <button
              onClick={run}
              disabled={running || !sqlText.trim()}
              className="ml-auto shrink-0 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {running ? t('data.running') : t('data.run')}
            </button>
          )}
        </div>
        {mode === 'table' ? (
          selected ? (
            <TableGrid projectId={projectId} env={env} table={selected} onChanged={loadSchema} />
          ) : (
            <div className="px-1 py-3 text-xs text-gray-600">{t('data.pickTable')}</div>
          )
        ) : (
          <>
        <textarea
          value={sqlText}
          onChange={(e) => setSqlText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              run()
            }
          }}
          spellCheck={false}
          className="h-40 w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-xs leading-5 text-gray-200 outline-none focus:border-indigo-500"
        />
        {msg && <div className="mt-1 text-xs text-gray-500">{msg}</div>}
        {err && <div className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 font-mono text-xs text-red-400">{err}</div>}

        {result && (
          <div className="mt-3">
            <div className="mb-1 text-xs text-gray-600">
              {t('data.resultMeta', {
                rows: result.rows.length,
                read: result.rowsRead,
                written: result.rowsWritten,
                ms: result.durationMs,
              })}
            </div>
            {result.columns.length === 0 ? (
              <div className="rounded-xl border border-gray-800 bg-gray-950 p-3 text-xs text-emerald-400">{t('data.okNoRows')}</div>
            ) : (
              <div className="max-h-96 overflow-auto rounded-xl border border-gray-800">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 bg-gray-900">
                    <tr>
                      {result.columns.map((col) => (
                        <th key={col} className="whitespace-nowrap border-b border-gray-700 px-3 py-1.5 text-left font-mono font-medium text-gray-300">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="odd:bg-gray-950 even:bg-gray-900/40">
                        {result.columns.map((col) => (
                          <td
                            key={col}
                            className="max-w-[24rem] truncate border-b border-gray-800/60 px-3 py-1.5 font-mono text-gray-300"
                            title={cellText(row[col])}
                          >
                            {cellText(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
          </>
        )}
      </div>
    </div>
  )
}