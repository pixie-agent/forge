import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { ConfigField, SecretField } from './ConnectorFields'
import type { ConnectorConnection, ConnectorProviderProfile, SiteDataEnv } from '../lib/types'

interface Props {
  projectId: string
  provider: ConnectorProviderProfile
  /** 这个 provider 在账号下**已保存过**的凭证(跨项目复用);点一下就能接入,不用重新粘贴 */
  reusable: ConnectorConnection[]
  /** 有任务正在跑:保存后本轮来不及生效,提示用户(凭证在 dispatch 时已固定) */
  jobRunning?: boolean
  /** 保存成功:父组件刷新绑定状态 + 给提示 */
  onSaved: (providerName: string, accountLabel: string) => void | Promise<void>
  /** 关闭卡片(未保存也允许,数据不落库) */
  onClose: () => void
}

/**
 * 对话内「接入外部系统」凭证卡片(见 docs/CONNECTORS.md §7)。
 *
 * 为什么要有它:完整管理面板(`ConnectorsPanel`)适合处理慢变量(换账号、解绑、draft/live 分环境),
 * 但"第一次把某个系统接上"是个高频、一次性动作,把用户支使到面板里填表很别扭。
 * 这张卡片就把那一步搬进对话栏,和附件、能力条处在同一片区域。
 *
 * **安全边界(关键)**:密钥只上行、永不回显,也**不经过对话消息链路** ——
 * 这里直接 POST `/api/connections/:provider/secret`,不会写进 messages 表、不会被拼进 prompt、
 * 不会出现在 agent_log 里。所以用户即使把 `sk_live_...` 贴在这里,也不会到模型厂商那一侧。
 */
export default function ConnectorCard({ projectId, provider, reusable, jobRunning, onSaved, onClose }: Props) {
  const [env, setEnv] = useState<SiteDataEnv>('draft')
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [form, setForm] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 非空 = 已保存(卡片原地转成完成态,给用户一个留在对话流里的痕记) */
  const [doneLabel, setDoneLabel] = useState('')

  const rootRef = useRef<HTMLDivElement>(null)
  // 打开即滚进视野(卡片挂在消息列表末尾;不依赖父组件的滚动 effect)
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  const isApiKey = provider.auth === 'apikey'
  const isOauth = provider.auth === 'oauth'
  const secretFields = provider.secretInputs ?? []
  const missingRequired = secretFields.some((f) => f.required && !(secrets[f.key] ?? '').trim())
  /** 必填配置还缺哪几个:缺了就先把「复用 / 前往授权 / 保存并接入」都按死,免得半截能力接上去也不可用 */
  const missingConfig = provider.configFields.filter((f) => f.required && !(form[f.key] ?? '').trim())

  /**
   * 账号下已保存的凭证(跨项目复用)。放在最上面,因为它是**最省事的那条路**:
   * 同一个 Stripe / GA4 账号接第二个项目时,用户不该再贴一遍 key、也不该再走一次授权页。
   * 只读/可写都适用 —— 复用只写一条项目级绑定,不重传任何密钥。
   */
  const reuseList = reusable.length > 0 && (
    <div className="mt-2.5">
      <p className="mb-1 text-[11px] text-gray-400">
        你的账号里已经保存过 {provider.name} 的凭证,点一下直接接到本项目(不重传密钥{isOauth ? '、不再跳授权页' : ''}):
      </p>
      <div className="space-y-1">
        {reusable.map((c) => (
          <button
            key={c.id}
            onClick={() => void reuse(c.id, c.accountLabel)}
            disabled={busy || missingConfig.length > 0}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-left hover:border-indigo-500 disabled:opacity-40"
          >
            <span className="min-w-0 truncate text-xs text-gray-200">🔑 {c.accountLabel}</span>
            <span className="shrink-0 text-[10px] text-indigo-300">接入 ▸</span>
          </button>
        ))}
      </div>
      {missingConfig.length > 0 && (
        <p className="mt-1.5 text-[11px] text-amber-300">先填下面的「{missingConfig.map((f) => f.label).join('、')}」,再点接入</p>
      )}
    </div>
  )

  /** 非密配置输入框:两种形态都要渲染 —— OAuth 形态也得先填 `propertyId` 这类必填配置才能一次接完 */
  const configForm = provider.configFields.length > 0 && (
    <div className="mt-2.5 space-y-2">
      {provider.configFields.map((f) => (
        <ConfigField
          key={f.key}
          field={f}
          value={form[f.key] ?? ''}
          missing={false}
          onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))}
        />
      ))}
    </div>
  )

  /** 新建一条接入:`apikey`/`config` 形态直接把密钥与配置一次 POST/PUT 落库(不走消息链路) */
  async function save() {
    setBusy(true)
    setError('')
    try {
      if (isApiKey) {
        const res = await api<{ accountLabel: string }>(`/api/connections/${provider.id}/secret`, {
          method: 'POST',
          body: { projectId, env, name, secrets, config: form },
        })
        setSecrets({})
        setDoneLabel(res.accountLabel || provider.name)
        await onSaved(provider.name, res.accountLabel || provider.name)
      } else {
        await api(`/api/projects/${projectId}/connectors`, {
          method: 'PUT',
          body: { provider: provider.id, env, config: form },
        })
        setDoneLabel(provider.name)
        await onSaved(provider.name, provider.name)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 复用账号下**已保存过**的凭证:只写一条项目级绑定,不重传密钥、不重复授权。
   * 这是最常见的一次性动作(同一个 Stripe / GA4 账号服务多个项目),点一下比再贴一遍 key 强得多。
   */
  async function reuse(connectionId: string, label: string) {
    setBusy(true)
    setError('')
    try {
      await api(`/api/projects/${projectId}/connectors`, {
        method: 'PUT',
        body: { provider: provider.id, env, config: form, connectionId },
      })
      setDoneLabel(label)
      await onSaved(provider.name, label)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * OAuth 形态没法在卡片里完成(必须跳到对方授权页);给个直达按钮,不让用户去找面板。
   * 已填的非密配置随 state 一起带过去(见 routes/connections.ts 的 decodeConfigParam),
   * 回调时与 connectionId 一并落库 —— 否则用户回来还是"缺必填配置",仍要被支使去面板。
   */
  function startOauth() {
    const bytes = new TextEncoder().encode(JSON.stringify(form))
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    const cfg = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const q = new URLSearchParams({ projectId, env })
    if (Object.keys(form).length) q.set('config', cfg)
    location.href = `/api/connections/${provider.id}/start?${q.toString()}`
  }

  if (doneLabel) {
    return (
      <div ref={rootRef} className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-200">
              <span>🔑</span>
              <span className="truncate">
                {provider.name} 已接入{isApiKey ? ` · ${doneLabel}` : ''}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-emerald-200/70">
              已绑到{env === 'draft' ? '草稿 / 测试环境' : '线上环境'}。凭证已加密保存,不会出现在对话、源码或产物里。
              {provider.writable
                ? '它带写能力,按规则默认不带上 —— 要用它的那一轮,请在对话栏把它的 chip 点亮。'
                : '之后的生成会默认带上它。'}
            </p>
          </div>
          <button onClick={onClose} aria-label="关闭" className="shrink-0 rounded px-1.5 text-emerald-300/70 hover:text-emerald-100">
            ✕
          </button>
        </div>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="rounded-xl border border-indigo-500/40 bg-indigo-500/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-indigo-100">接入 {provider.name}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${provider.writable ? 'bg-amber-500/15 text-amber-300' : 'bg-gray-800 text-gray-400'}`}>
              {provider.writable ? '可写' : '只读'}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-400">{provider.blurb}</p>
        </div>
        <button onClick={onClose} aria-label="取消" className="shrink-0 rounded px-1.5 text-gray-500 hover:text-gray-300">
          ✕
        </button>
      </div>

      {/* 绑到哪个环境:两个小胶囊,不做成下拉(默认草稿,避免拿测试凭证打真账) */}
      <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-gray-400">
        <span>接入到</span>
        {(['draft', 'live'] as const).map((e) => (
          <button
            key={e}
            onClick={() => setEnv(e)}
            className={`rounded-full border px-2 py-0.5 ${
              env === e ? 'border-indigo-400/60 bg-indigo-500/15 text-indigo-200' : 'border-gray-700 text-gray-400 hover:text-gray-200'
            }`}
          >
            {e === 'draft' ? '草稿 / 测试' : '线上'}
          </button>
        ))}
        {env === 'live' && <span className="text-amber-300">访客打开公开页时就会生效</span>}
      </div>

      {isOauth ? (
        <>
          {reuseList}
          {configForm}
          <p className="mt-2 text-xs leading-relaxed text-gray-400">
            {reusable.length > 0 ? '要换一个账号,则' : '这个连接器要'}授权你自己的 {provider.name} 账号:跳到对方页面点「允许」,回来会自动绑定。
          </p>
          <button
            onClick={startOauth}
            disabled={provider.needsOauthClient || missingConfig.length > 0}
            title={provider.needsOauthClient ? '平台未配置该连接器的 OAuth 客户端' : undefined}
            className={`mt-2 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${
              reusable.length > 0
                ? 'border border-gray-700 text-gray-300 hover:bg-gray-800'
                : 'bg-indigo-600 text-white hover:bg-indigo-500'
            }`}
          >
            {reusable.length > 0 ? `改用其他 ${provider.name} 账号授权` : '前往授权'}
          </button>
          {missingConfig.length > 0 && (
            <p className="mt-1.5 text-[11px] text-amber-300">先填上「{missingConfig.map((f) => f.label).join('、')}」再授权,一次接完</p>
          )}
        </>
      ) : (
        <>
          {reuseList}
          {secretFields.length > 0 && (
            <div className="mt-2.5 space-y-2">
              {reusable.length > 0 && <p className="text-[11px] text-gray-500">或粘贴一把新密钥:</p>}
              {secretFields.map((f) => (
                <SecretField key={f.key} field={f} value={secrets[f.key] ?? ''} onChange={(v) => setSecrets((s) => ({ ...s, [f.key]: v }))} />
              ))}
              <label className="block">
                <span className="mb-1 block text-xs text-gray-300">名称(可选)</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`如:我的 ${provider.name}(test / live)`}
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-xs text-gray-100 outline-none focus:border-indigo-500"
                />
              </label>
            </div>
          )}

          {configForm}

          <div className="mt-2.5 flex items-center gap-2">
            <button
              onClick={() => void save()}
              disabled={busy || (isApiKey && missingRequired) || missingConfig.length > 0}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {busy ? '保存中…' : isApiKey ? '保存并接入' : '绑定'}
            </button>
            <button onClick={onClose} className="rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-400 hover:bg-gray-800">
              取消
            </button>
            {missingConfig.length > 0 && <span className="text-[11px] text-amber-300">还缺:{missingConfig.map((f) => f.label).join('、')}</span>}
          </div>
        </>
      )}

      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      {jobRunning && (
        <p className="mt-2 text-[11px] leading-relaxed text-amber-300">
          本次任务已经在跑,连接器在一开始就固定了 —— 这里保存的凭证从<b>下一次</b>生成开始生效。
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
        密钥只用于生成时调用 {provider.name},加密存放、不会写进你的站点代码,也不会出现在对话记录里。
      </p>
    </div>
  )
}
