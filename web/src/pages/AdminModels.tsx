import { useCallback, useEffect, useState } from 'react'
import AdminBar from '../components/AdminBar'
import { api } from '../lib/api'

/**
 * 模型配置与用量(后台控制台最小版,见 docs/FORGE2.md §21)。
 * 中文界面是刻意的:后台面向中文运营,不接 i18n(AGENTS.md §6)。
 */

interface UsageStat {
  config_id?: string
  model?: string
  /** free | vip | ''(旧任务/未分流) */
  channel?: string
  jobs: number
  succeeded: number
  failed: number
  cancelled: number
  avg_run_ms: number
  input_tokens: number
  output_tokens: number
  llm_cost_usd: number
  gcp_cost_usd: number
  cost_usd: number
  cost_per_success: number | null
}

interface ConfigRow {
  id: string
  name: string
  channel: string
  provider_id: string
  base_url: string
  api_dialect: string
  model_id: string
  thinking_level: string
  thinking_format: string
  max_tokens: number
  reasoning: number
  image_input: number
  design_review: string
  max_run_ms: number
  polish_max_ms: number
  /** 任务并发(0=不限);仅 free 通道生效,与 Cloud Run 的 --concurrency 无关 */
  queue_concurrency: number
  input_price: number
  output_price: number
  cache_read_price: number
  cache_write_price: number
  enabled: number
  created_at: string
  updated_at: string
  priced: boolean
  stats: UsageStat | null
}

interface ModelsPayload {
  configs: ConfigRow[]
  /** 每个通道当前生效的配置 id(vip / free / default) */
  active_by_channel: Record<string, string | null>
  totals: UsageStat
  by_model: UsageStat[]
  jobs_without_usage: number
}

const EMPTY_FORM = {
  name: '',
  channel: 'vip',
  model_id: '',
  base_url: '',
  provider_id: 'forge',
  api_dialect: 'openai-completions',
  thinking_level: 'medium',
  thinking_format: '',
  max_tokens: '16384',
  design_review: 'generate',
  max_run_ms: '3000000',
  polish_max_ms: '300000',
  queue_concurrency: '2',
  input_price: '0',
  output_price: '0',
  cache_read_price: '0',
  cache_write_price: '0',
  reasoning: true,
  image_input: false,
  enabled: true,
}

const inputClass =
  'w-full rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-sm text-gray-100 outline-none focus:border-indigo-500'
const labelClass = 'mb-1 block text-xs text-gray-500'

const usd = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(4)}`)
const secs = (ms: number) => `${Math.round(ms / 1000)}s`
const pct = (ok: number, total: number) => (total > 0 ? `${Math.round((ok / total) * 100)}%` : '—')
const chineseStage = (s: string) => (s === 'off' ? '关闭' : s === 'always' ? '总是' : '仅从零生成')
const thinkingFormatLabel = (s: string) => (s ? s : '自动推断')
/** 通道含义见 docs/FORGE2.md §21.5:免费用户走 free(排队),付过费的走 vip */
const CHANNELS = ['vip', 'free', 'default'] as const
const channelLabel = (s: string) => (s === 'vip' ? 'VIP(付费)' : s === 'free' ? '免费(排队)' : '默认(回落)')

export default function AdminModels() {
  const [data, setData] = useState<ModelsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await api<ModelsPayload>('/api/admin/models'))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function scrollToForm() {
    requestAnimationFrame(() =>
      document.getElementById('model-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    )
  }

  function openCreate() {
    setEditingId(null)
    setForm({ ...EMPTY_FORM })
    setShowForm(true)
    scrollToForm()
  }

  function closeForm() {
    setEditingId(null)
    setForm({ ...EMPTY_FORM })
    setShowForm(false)
  }

  /** 把已有配置回填到表单;保存时原地更新这一行 */
  function startEdit(row: ConfigRow) {
    setEditingId(row.id)
    setForm({
      name: row.name,
      channel: row.channel,
      model_id: row.model_id,
      base_url: row.base_url,
      provider_id: row.provider_id,
      api_dialect: row.api_dialect,
      thinking_level: row.thinking_level,
      thinking_format: row.thinking_format,
      max_tokens: String(row.max_tokens),
      design_review: row.design_review,
      max_run_ms: String(row.max_run_ms),
      polish_max_ms: String(row.polish_max_ms),
      queue_concurrency: String(row.queue_concurrency ?? 0),
      input_price: String(row.input_price),
      output_price: String(row.output_price),
      cache_read_price: String(row.cache_read_price),
      cache_write_price: String(row.cache_write_price),
      reasoning: row.reasoning === 1,
      image_input: row.image_input === 1,
      enabled: row.enabled === 1,
    })
    setShowForm(true)
    setError('')
    scrollToForm()
  }

  async function act(path: string, label: string) {
    setBusy(label)
    setError('')
    try {
      await api(path, { method: 'POST' })
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy('')
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy('save')
    setError('')
    try {
      await api(editingId ? `/api/admin/models/${editingId}` : '/api/admin/models', {
        method: editingId ? 'PUT' : 'POST',
        body: {
          ...form,
          max_run_ms: Number(form.max_run_ms),
          polish_max_ms: Number(form.polish_max_ms),
          queue_concurrency: Number(form.queue_concurrency),
          input_price: Number(form.input_price),
          output_price: Number(form.output_price),
          cache_read_price: Number(form.cache_read_price),
          cache_write_price: Number(form.cache_write_price),
        },
      })
      closeForm()
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy('')
    }
  }

  const activeOf = (channel: string) => data?.configs.find((c) => c.channel === channel && c.enabled === 1) ?? null
  const totals = data?.totals

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <AdminBar subtitle="模型" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-5 sm:px-4 sm:py-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">模型配置与用量</h1>
            <p className="mt-1 text-xs text-gray-500">
              配置是一次任务派发时的快照;改配置只影响新任务,历史成本不重算。表内无生效配置时回落 Cloud Run env。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void load()}
              className="rounded-xl border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:border-gray-500"
            >
              刷新
            </button>
            <button
              onClick={() => (showForm ? closeForm() : openCreate())}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              {showForm ? '收起表单' : '新增配置'}
            </button>
          </div>
        </div>

        {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}

        {loading ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : !data ? null : (
          <>
            {/* 近 7 天总览 */}
            <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Metric label="近 7 天任务" value={String(totals?.jobs ?? 0)} />
              <Metric
                label="成功率"
                value={pct(totals?.succeeded ?? 0, (totals?.succeeded ?? 0) + (totals?.failed ?? 0))}
                hint={`成功 ${totals?.succeeded ?? 0} / 失败 ${totals?.failed ?? 0}`}
              />
              <Metric label="总成本" value={usd(totals?.cost_usd ?? 0)} hint={`LLM ${usd(totals?.llm_cost_usd ?? 0)} · GCP ${usd(totals?.gcp_cost_usd ?? 0)}`} />
              <Metric label="单次成功成本" value={usd(totals?.cost_per_success)} hint="含失败任务的沉没成本" />
              <Metric label="无用量记录" value={String(data.jobs_without_usage)} hint="已终态但没上报 usage 的任务" warn={data.jobs_without_usage > 0} />
            </section>

            {/* 当前生效:每个通道各一条(免费用户走 free,vip 走 vip) */}
            <section className="mb-4 rounded-2xl border border-gray-800 p-4">
              <h2 className="mb-3 text-sm font-semibold text-gray-200">当前生效配置(按通道)</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {CHANNELS.map((ch) => {
                  const row = activeOf(ch)
                  return (
                    <div key={ch} className="rounded-xl border border-gray-800 bg-gray-900/30 p-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-gray-300">{channelLabel(ch)}</span>
                        {row && (
                          <div className="flex gap-1.5">
                            <button
                              disabled={!!busy}
                              onClick={() => startEdit(row)}
                              className="rounded-lg border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:border-indigo-500/60 hover:text-indigo-300 disabled:opacity-50"
                            >
                              编辑
                            </button>
                            <button
                              disabled={!!busy}
                              onClick={() => void act(`/api/admin/models/${row.id}/disable`, 'disable')}
                              className="rounded-lg border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:border-red-500/50 hover:text-red-400 disabled:opacity-50"
                            >
                              停用
                            </button>
                          </div>
                        )}
                      </div>
                      {row ? (
                        <div className="space-y-0.5 text-xs text-gray-500">
                          <div className="text-gray-200">{row.name}</div>
                          <div>{row.model_id}</div>
                          <div className="truncate" title={row.base_url}>
                            {row.base_url}
                          </div>
                          <div>
                            {row.api_dialect} · 思考 {row.thinking_level}({thinkingFormatLabel(row.thinking_format)})
                          </div>
                          <div>
                            输出 {row.max_tokens} · 运行上限 {secs(row.max_run_ms)} · 复查轮{' '}
                            {chineseStage(row.design_review)}
                          </div>
                          <div>
                            ${row.input_price} / ${row.output_price} 每百万 token
                            {!row.priced && (
                              <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.5 text-amber-400">未计价</span>
                            )}
                          </div>
                          {row.channel === 'free' && <ConcurrencyEditor row={row} onSaved={load} />}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-600">未配置,回落该执行体 Cloud Run env 的默认模型。</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>

            {showForm && (
              <form
                id="model-form"
                onSubmit={submit}
                className="mb-4 rounded-2xl border border-indigo-500/30 bg-gray-900/40 p-4"
              >
                <h2 className="mb-1 text-sm font-semibold text-gray-200">
                  {editingId ? '编辑模型配置' : '新增模型配置'}
                </h2>
                <p className="mb-3 text-[11px] text-gray-500">
                  {editingId
                    ? '保存后原地更新这条配置,对下一个任务生效;历史任务的成本已落库,不会重算。'
                    : '保存后生成一条新配置;勾选「立即启用」会停用同通道的旧配置。'}
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className={labelClass}>名称 *</label>
                    <input
                      className={inputClass}
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="例如 生产-DeepSeek Flash"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>通道 *</label>
                    <select
                      className={inputClass}
                      value={form.channel}
                      onChange={(e) => setForm({ ...form, channel: e.target.value })}
                    >
                      <option value="vip">VIP(付过费的用户)</option>
                      <option value="free">免费(未付费,走排队执行体)</option>
                      <option value="default">默认(两个通道都没配时回落)</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>模型 ID *</label>
                    <input
                      className={inputClass}
                      value={form.model_id}
                      onChange={(e) => setForm({ ...form, model_id: e.target.value })}
                      placeholder="deepseek-flash"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Base URL *(必须与 Cloud Run 的 key 匹配)</label>
                    <input
                      className={inputClass}
                      value={form.base_url}
                      onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                      placeholder="https://api.deepseek.com/anthropic"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>API 方言</label>
                    <select
                      className={inputClass}
                      value={form.api_dialect}
                      onChange={(e) => setForm({ ...form, api_dialect: e.target.value })}
                    >
                      <option value="anthropic-messages">anthropic-messages</option>
                      <option value="openai-completions">openai-completions</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Provider ID</label>
                    <input
                      className={inputClass}
                      value={form.provider_id}
                      onChange={(e) => setForm({ ...form, provider_id: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>思考档位</label>
                    <select
                      className={inputClass}
                      value={form.thinking_level}
                      onChange={(e) => setForm({ ...form, thinking_level: e.target.value })}
                    >
                      {['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>思考方言(pi thinkingFormat)</label>
                    <select
                      className={inputClass}
                      value={form.thinking_format}
                      onChange={(e) => setForm({ ...form, thinking_format: e.target.value })}
                    >
                      <option value="">自动推断(按 Base URL)</option>
                      <option value="openai">openai(reasoning_effort)</option>
                      <option value="zai">zai(enable_thinking)</option>
                      <option value="qwen">qwen(enable_thinking)</option>
                      <option value="qwen-chat-template">qwen-chat-template</option>
                      <option value="openrouter">openrouter(reasoning.effort)</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>输出上限 max_tokens(思考预算从这里划)</label>
                    <input
                      className={inputClass}
                      value={form.max_tokens}
                      onChange={(e) => setForm({ ...form, max_tokens: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>设计复查轮</label>
                    <select
                      className={inputClass}
                      value={form.design_review}
                      onChange={(e) => setForm({ ...form, design_review: e.target.value })}
                    >
                      <option value="generate">仅从零生成(generate)</option>
                      <option value="always">generate + chat 都跑</option>
                      <option value="off">关闭(省钱)</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>运行上限(ms,最大 3400000 = 3400s,需 &lt; Cloud Run 3600s)</label>
                    <input
                      type="number"
                      min={60000}
                      max={3400000}
                      step={1000}
                      className={inputClass}
                      value={form.max_run_ms}
                      onChange={(e) => setForm({ ...form, max_run_ms: e.target.value })}
                    />
                    <p className="mt-1 text-[11px] text-gray-600">单位毫秒;1500s = 1500000,3400s = 3400000。</p>
                  </div>
                  <div>
                    <label className={labelClass}>复查轮预算(ms)</label>
                    <input
                      className={inputClass}
                      value={form.polish_max_ms}
                      onChange={(e) => setForm({ ...form, polish_max_ms: e.target.value })}
                    />
                  </div>
                  {form.channel === 'free' && (
                    <div>
                      <label className={labelClass}>任务并发(同时跑几个 job;0 = 不限)</label>
                      <input
                        className={inputClass}
                        value={form.queue_concurrency}
                        onChange={(e) => setForm({ ...form, queue_concurrency: e.target.value })}
                      />
                      <p className="mt-1 text-[11px] text-gray-600">
                        只限任务数,不改 Cloud Run 的 --concurrency;资源并发在资源侧扩缩容。
                      </p>
                    </div>
                  )}
                  {(
                    [
                      ['input_price', '输入价 $/1M'],
                      ['output_price', '输出价 $/1M'],
                      ['cache_read_price', '缓存命中 $/1M'],
                      ['cache_write_price', '缓存写入 $/1M'],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key}>
                      <label className={labelClass}>{label}</label>
                      <input
                        className={inputClass}
                        value={form[key]}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-400">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={form.reasoning}
                      onChange={(e) => setForm({ ...form, reasoning: e.target.checked })}
                    />
                    模型支持推理
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={form.image_input}
                      onChange={(e) => setForm({ ...form, image_input: e.target.checked })}
                    />
                    支持图片输入(上游不认会 400)
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                    />
                    保存后立即启用
                  </label>
                  <div className="ml-auto flex items-center gap-2">
                    {editingId && (
                      <button
                        type="button"
                        onClick={closeForm}
                        disabled={!!busy}
                        className="rounded-xl border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:border-gray-500 disabled:opacity-50"
                      >
                        取消
                      </button>
                    )}
                    <button
                      disabled={!!busy}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {busy === 'save' ? '保存中…' : editingId ? '保存修改' : '保存'}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* 配置列表 */}
            <section className="mb-6">
              <h2 className="mb-2 text-sm font-semibold text-gray-200">全部配置</h2>
              {data.configs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-800 py-10 text-center text-sm text-gray-500">
                  还没有后台配置,当前使用 Cloud Run env 默认模型
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-gray-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-900 text-gray-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">名称 / 模型</th>
                        <th className="px-3 py-2 font-medium">通道</th>
                        <th className="px-3 py-2 font-medium">方言 / 思考 / 复查轮</th>
                        <th className="px-3 py-2 font-medium">运行上限</th>
                        <th className="px-3 py-2 font-medium">价格(入/出 $/1M)</th>
                        <th className="px-3 py-2 font-medium">近 7 天</th>
                        <th className="px-3 py-2 font-medium">状态</th>
                        <th className="px-3 py-2 font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.configs.map((row) => (
                        <tr key={row.id} className="border-t border-gray-800 bg-gray-950">
                          <td className="px-3 py-2">
                            <div className="text-gray-200">{row.name}</div>
                            <div className="text-gray-500">{row.model_id}</div>
                            <div className="max-w-56 truncate text-gray-600" title={row.base_url}>
                              {row.base_url}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-300">{channelLabel(row.channel)}</span>
                          </td>
                          <td className="px-3 py-2 text-gray-400">
                            {row.api_dialect}
                            <div>
                              {row.thinking_level} · {thinkingFormatLabel(row.thinking_format)}
                            </div>
                            <div>{chineseStage(row.design_review)}</div>
                          </td>
                          <td className="px-3 py-2 text-gray-400">
                            <div>{secs(row.max_run_ms)}</div>
                            {row.channel === 'free' && (
                              <div className="text-gray-500">
                                任务并发 {(row.queue_concurrency ?? 0) > 0 ? row.queue_concurrency : '不限'}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-400">
                            ${row.input_price} / ${row.output_price}
                            {!row.priced && (
                              <div className="mt-0.5 inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-400">未计价</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-400">
                            {row.stats ? (
                              <>
                                <div>
                                  {row.stats.jobs} 任务 · 成功 {pct(row.stats.succeeded, row.stats.jobs)}
                                </div>
                                <div>
                                  {usd(row.stats.cost_usd)} · 单次成功 {usd(row.stats.cost_per_success)}
                                </div>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {row.enabled === 1 ? (
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-400">生效中</span>
                            ) : (
                              <span className="text-gray-500">未启用</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                disabled={!!busy}
                                onClick={() => startEdit(row)}
                                className="rounded-lg border border-gray-700 px-2.5 py-1 text-gray-300 hover:border-indigo-500/60 hover:text-indigo-300 disabled:opacity-50"
                              >
                                编辑
                              </button>
                              {row.enabled !== 1 && (
                                <button
                                  disabled={!!busy}
                                  onClick={() => void act(`/api/admin/models/${row.id}/enable`, row.id)}
                                  className="rounded-lg border border-gray-700 px-2.5 py-1 text-gray-300 hover:border-emerald-500/60 hover:text-emerald-300 disabled:opacity-50"
                                >
                                  {busy === row.id ? '启用中…' : '启用'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* 按模型用量 */}
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-200">近 7 天按模型</h2>
              {data.by_model.length === 0 ? (
                <p className="text-xs text-gray-500">还没有用量记录。</p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-gray-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-900 text-gray-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">模型</th>
                        <th className="px-3 py-2 font-medium">通道</th>
                        <th className="px-3 py-2 font-medium">配置</th>
                        <th className="px-3 py-2 font-medium">任务</th>
                        <th className="px-3 py-2 font-medium">成功 / 失败</th>
                        <th className="px-3 py-2 font-medium">平均耗时</th>
                        <th className="px-3 py-2 font-medium">Token(入/出)</th>
                        <th className="px-3 py-2 font-medium">LLM / GCP</th>
                        <th className="px-3 py-2 font-medium">单次成功成本</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_model.map((row, i) => (
                        <tr key={`${row.model}-${row.config_id}-${i}`} className="border-t border-gray-800 bg-gray-950">
                          <td className="px-3 py-2 text-gray-200">{row.model || '—'}</td>
                          <td className="px-3 py-2 text-gray-400">{row.channel ? channelLabel(row.channel) : '—'}</td>
                          <td className="px-3 py-2 text-gray-500">
                            {data.configs.find((c) => c.id === row.config_id)?.name ?? (row.config_id ? row.config_id.slice(0, 8) : 'env 默认')}
                          </td>
                          <td className="px-3 py-2 text-gray-400">{row.jobs}</td>
                          <td className="px-3 py-2 text-gray-400">
                            {row.succeeded} / {row.failed}
                          </td>
                          <td className="px-3 py-2 text-gray-400">{secs(row.avg_run_ms)}</td>
                          <td className="px-3 py-2 text-gray-400">
                            {row.input_tokens.toLocaleString()} / {row.output_tokens.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-gray-400">
                            {usd(row.llm_cost_usd)} / {usd(row.gcp_cost_usd)}
                          </td>
                          <td className="px-3 py-2 text-gray-200">{usd(row.cost_per_success)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}

/** 任务并发的原地编辑(只改这一个运维旋钮,不动模型/价格快照) */
function ConcurrencyEditor({ row, onSaved }: { row: ConfigRow; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(String(row.queue_concurrency ?? 0))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    setValue(String(row.queue_concurrency ?? 0))
  }, [row.queue_concurrency])

  async function save() {
    setBusy(true)
    setErr('')
    try {
      await api(`/api/admin/models/${row.id}/concurrency`, {
        method: 'POST',
        body: { queue_concurrency: Number(value) },
      })
      await onSaved()
    } catch (e) {
      setErr((e as Error).message || '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 border-t border-gray-800 pt-2">
      <label className="mb-1 block text-[11px] text-gray-500">任务并发(同时跑几个 job;0 = 不限)</label>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          max={32}
          className="w-16 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100 outline-none focus:border-indigo-500"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          disabled={busy || value === String(row.queue_concurrency ?? 0)}
          onClick={() => void save()}
          className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
      {err && <div className="mt-1 text-[11px] text-red-400">{err}</div>}
      <p className="mt-1 text-[11px] text-gray-600">只限任务数,不改 Cloud Run 的 --concurrency;下一次任务生效。</p>
    </div>
  )
}

function Metric({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 ${warn ? 'border-amber-500/40' : 'border-gray-800'}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${warn ? 'text-amber-400' : 'text-gray-100'}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-gray-600">{hint}</div>}
    </div>
  )
}
