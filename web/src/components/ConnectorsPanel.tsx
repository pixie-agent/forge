import { useState } from 'react'
import { api } from '../lib/api'
import { useT, type DictKey } from '../lib/i18n'
import RichText from './RichText'
import { ConfigField, SecretField } from './ConnectorFields'
import type { ConnectorConnection, ProjectConnectorProvider, ProjectConnectorsResponse, SiteDataEnv } from '../lib/types'

interface Props {
  projectId: string
  /** 两个环境的绑定状态(草稿/线上各取一次);null = 还在加载 */
  data: { draft: ProjectConnectorsResponse; live: ProjectConnectorsResponse } | null
  onClose: () => void
  /** 面板内任何写操作成功后调用,由父组件重新拉取绑定状态 */
  onChanged: () => void | Promise<unknown>
}

const ENV_LABEL_KEY: Record<SiteDataEnv, DictKey> = { draft: 'env.draftLabel', live: 'env.liveLabel' }

/**
 * 项目级「连接器」面板(见 docs/CONNECTORS.md §7「完整管理放项目级」)。
 *
 * 分工:对话栏的能力条只做**本轮开关**,这里管**慢变量** —— 接入/换账号/撤销、draft 与 live
 * 各绑什么、非密配置(measurementId、publishable key)。绑定带 env 维度,避免"草稿的测试付款打进真账"。
 *
 * 三种形态在这里是三种交互:
 *   - oauth  → 「连接」:跳外部授权页(平台已登记 OAuth 客户端);
 *   - apikey → 「贴密钥」:用户自己把第三方控制台生成的 key 粘进来(平台不去外部登记任何东西);
 *   - config → 只有输入框。
 */
export default function ConnectorsPanel({ projectId, data, onClose, onChanged }: Props) {
  const t = useT()
  const [env, setEnv] = useState<SiteDataEnv>('draft')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const current = data?.[env] ?? null
  const enabled = data ? data.draft.enabled && data.live.enabled : true
  const reason = data?.draft.reason ?? data?.live.reason ?? ''

  /** 写操作统一入口:成功返回 true(调用方据此决定是否清掉本地输入);失败返回 false 并展示原因 */
  async function mutate(key: string, fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(key)
    setError('')
    try {
      await fn()
      await onChanged()
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
      <div
        className="mt-8 w-full max-w-2xl rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-gray-100">{t('conn.title')}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{t('conn.panelSubtitle')}</p>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200">
            ✕
          </button>
        </div>

        <div className="flex gap-1 border-b border-gray-800 px-4 pt-2">
          {(['draft', 'live'] as const).map((e) => (
            <button
              key={e}
              onClick={() => setEnv(e)}
              className={`rounded-t-lg px-3 py-1.5 text-xs ${
                env === e ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t(ENV_LABEL_KEY[e])}
              {data && data[e].providers.some((p) => p.binding) && <span className="ml-1.5 text-emerald-400">●</span>}
            </button>
          ))}
        </div>

        <div className="max-h-[65vh] space-y-3 overflow-y-auto p-4">
          {!data ? (
            <p className="py-6 text-center text-sm text-gray-500">{t('common.loading')}</p>
          ) : !enabled ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <RichText text={t('conn.disabled', { reason: reason ? `:${reason}` : '' })} />
            </div>
          ) : (
            current?.providers.map((p) => (
              <ProviderRow
                key={`${env}:${p.id}`}
                projectId={projectId}
                env={env}
                provider={p}
                connections={current.connections.filter((c) => c.provider === p.id)}
                busy={busy}
                onMutate={mutate}
              />
            ))
          )}
          {error && <p className="text-xs text-red-300">{error}</p>}
        </div>

        <div className="border-t border-gray-800 px-4 py-3 text-[11px] leading-relaxed text-gray-500">
          <RichText text={t('conn.panelFooter')} />
        </div>
      </div>
    </div>
  )
}

/** 单个 provider 一行:状态 + (密钥/配置) 输入 + 接入/换账号/解绑 */
function ProviderRow({
  projectId,
  env,
  provider,
  connections,
  busy,
  onMutate,
}: {
  projectId: string
  env: SiteDataEnv
  provider: ProjectConnectorProvider
  /** 该 provider 的账号级连接(已按 provider 过滤);用于「用已有的密钥」 */
  connections: ConnectorConnection[]
  busy: string
  onMutate: (key: string, fn: () => Promise<unknown>) => Promise<boolean>
}) {
  const t = useT()
  const binding = provider.binding
  const [form, setForm] = useState<Record<string, string>>(() => ({ ...(binding?.config ?? {}) }))
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  // apikey:已上传后默认折叠密钥输入,点「重新上传」才展开
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)

  const connected = binding?.connectionStatus === 'active'
  const isOauth = provider.auth === 'oauth'
  const isApiKey = provider.auth === 'apikey'
  const busyThis = busy.startsWith(provider.id)

  const reusable = connections.filter((c) => c.status === 'active')
  const canReuse = reusable.some((c) => c.id !== binding?.connectionId)

  /** OAuth 授权是全页跳转(回调后回到工作台);state 里带上项目与环境 */
  function connect() {
    location.href = `/api/connections/${provider.id}/start?projectId=${encodeURIComponent(projectId)}&env=${env}`
  }

  function save() {
    void onMutate(`${provider.id}:save`, () =>
      api(`/api/projects/${projectId}/connectors`, {
        method: 'PUT',
        body: { provider: provider.id, env, config: form, connectionId: binding?.connectionId || undefined },
      }),
    )
  }

  /** 上传密钥:一次请求完成「加密落库 + 写入非密配置 + 绑定到本环境」(见 routes/connections.ts) */
  async function saveSecret() {
    const ok = await onMutate(`${provider.id}:secret`, () =>
      api(`/api/connections/${provider.id}/secret`, {
        method: 'POST',
        body: { projectId, env, name, secrets, config: form },
      }),
    )
    if (ok) {
      setSecrets({})
      setName('')
      setEditing(false)
    }
  }

  /** 用已有密钥:只把账号级连接绑到本项目(不重新上传) */
  function reuse(connectionId: string) {
    void onMutate(`${provider.id}:reuse`, () =>
      api(`/api/projects/${projectId}/connectors`, {
        method: 'PUT',
        body: { provider: provider.id, env, config: form, connectionId },
      }),
    )
  }

  function unbind() {
    void onMutate(`${provider.id}:unbind`, () =>
      api(`/api/projects/${projectId}/connectors/${provider.id}?env=${env}`, { method: 'DELETE' }),
    )
  }

  const showSecretForm = isApiKey && (!connected || editing)
  const showConfigForm = provider.configFields.length > 0 && (!isOauth || connected)

  return (
    <div className={`rounded-xl border p-3 ${binding ? 'border-gray-700 bg-gray-950/40' : 'border-gray-800'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-gray-100">{provider.name}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${provider.writable ? 'bg-amber-500/15 text-amber-300' : 'bg-gray-800 text-gray-400'}`}>
              {t(provider.writable ? 'conn.writable' : 'conn.readonly')}
            </span>
            {isOauth && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${connected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-800 text-gray-500'}`}>
                {connected
                  ? t('conn.status.connected', { label: binding?.accountLabel ?? '' })
                  : binding?.connectionStatus === 'revoked'
                    ? t('conn.status.revoked')
                    : t('conn.status.unauthorized')}
              </span>
            )}
            {isApiKey && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${connected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-800 text-gray-500'}`}>
                {connected
                  ? t('conn.status.keySaved', { label: binding?.accountLabel ?? '' })
                  : binding
                    ? t('conn.status.awaitKey')
                    : t('conn.status.notConnected')}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500">{provider.blurb}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isOauth && !connected && (
            <button
              onClick={connect}
              disabled={provider.needsOauthClient}
              title={provider.needsOauthClient ? t('conn.noOauthClient') : t('conn.oauthJump')}
              className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {t('conn.action.connect')}
            </button>
          )}
          {isOauth && connected && (
            <button onClick={connect} title={t('conn.action.reconnectTitle')} className="rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-800">
              {t('conn.action.reconnect')}
            </button>
          )}
          {isApiKey && connected && !editing && (
            <button
              onClick={() => setEditing(true)}
              title={t('conn.action.reuploadTitle')}
              className="rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-800"
            >
              {t('conn.action.reupload')}
            </button>
          )}
          {binding && (
            <button
              onClick={unbind}
              disabled={busyThis}
              title={t('conn.action.unbindTitle')}
              className="rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-400 hover:border-red-500/50 hover:text-red-300 disabled:opacity-40"
            >
              {t('conn.action.unbind')}
            </button>
          )}
        </div>
      </div>

      {isOauth && !connected && provider.redirectUri && (
        <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-2">
          <p className="text-[11px] leading-relaxed text-amber-200/90">
            <RichText text={t('conn.redirectWarn')} />
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-gray-950 px-2 py-1 font-mono text-[11px] text-gray-300">
              {provider.redirectUri}
            </code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(provider.redirectUri ?? '').catch(() => {})
                setCopied(true)
                setTimeout(() => setCopied(false), 1600)
              }}
              className="shrink-0 rounded-lg border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-800"
            >
              {copied ? t('common.copied') : t('common.copy')}
            </button>
          </div>
        </div>
      )}

      {/* 自带密钥:密钥输入框(值只上行,永不回显) */}
      {showSecretForm && (
        <div className="mt-2.5 space-y-2 rounded-lg border border-gray-800 bg-gray-900/60 p-2.5">
          {provider.secretInputs?.map((f) => (
            <SecretField
              key={f.key}
              field={f}
              value={secrets[f.key] ?? ''}
              onChange={(v) => setSecrets((s) => ({ ...s, [f.key]: v }))}
            />
          ))}
          <label className="block">
            <span className="mb-1 block text-xs text-gray-300">{t('conn.nameLabel')}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('conn.namePlaceholder', { provider: provider.name })}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-xs text-gray-100 outline-none focus:border-indigo-500"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void saveSecret()}
              disabled={busyThis}
              className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {busyThis ? t('common.saving') : connected ? t('conn.action.overwrite') : t('conn.action.saveBind')}
            </button>
            {editing && (
              <button
                onClick={() => {
                  setEditing(false)
                  setSecrets({})
                  setName('')
                }}
                className="rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-400 hover:bg-gray-800"
              >
                {t('common.cancel')}
              </button>
            )}
            {canReuse && (
              <select
                defaultValue=""
                disabled={busyThis}
                onChange={(e) => {
                  if (e.target.value) reuse(e.target.value)
                }}
                title={t('conn.action.reuseTitle')}
                className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300 outline-none focus:border-indigo-500 disabled:opacity-40"
              >
                <option value="">{t('conn.action.reuseOption')}</option>
                {reusable
                  .filter((c) => c.id !== binding?.connectionId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.accountLabel}
                    </option>
                  ))}
              </select>
            )}
          </div>
        </div>
      )}

      {showConfigForm && (
        <div className="mt-2.5 space-y-2">
          {provider.configFields.map((f) => (
            <ConfigField
              key={f.key}
              field={f}
              value={form[f.key] ?? ''}
              missing={Boolean(binding?.missing.includes(f.key))}
              onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))}
            />
          ))}
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={busyThis}
              className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {busyThis ? t('common.saving') : binding ? t('conn.action.saveConfig') : t('conn.action.bind')}
            </button>
            {binding?.missing.length ? (
              <span className="text-[11px] text-amber-300">{t('conn.missing', { fields: binding.missing.join(t('chat.listSep')) })}</span>
            ) : binding ? (
              <span className="text-[11px] text-emerald-400">{t('conn.effective')}</span>
            ) : null}
          </div>
        </div>
      )}

      {isOauth && !connected && binding && (
        <p className="mt-2 text-[11px] text-amber-300">{t('conn.oauthUnavailable')}</p>
      )}
      {isApiKey && !connected && binding && (
        <p className="mt-2 text-[11px] text-amber-300">{t('conn.keyMissing')}</p>
      )}
    </div>
  )
}
