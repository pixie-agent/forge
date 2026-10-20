import { useState } from 'react'
import { useT } from '../lib/i18n'
import type { ConnectorProviderProfile, SiteDataEnv } from '../lib/types'

/** 能力条上的一个 chip(由 Workspace 组装:哪些 provider 已绑定、本轮是否生效) */
export interface ConnectorChip {
  id: string
  name: string
  /** 含可写能力:默认关,需要本轮点亮 */
  writable: boolean
  /** 该绑定实际生效的环境(draft 优先于 live,与生成链路一致) */
  env: SiteDataEnv
  /** 本轮是否生效 */
  on: boolean
}

interface Props {
  chips: ConnectorChip[]
  /** 全部可选 provider(点「+ 连接」时列出);未配置 CONNECTOR_KEK 时父组件传空数组 */
  providers: ConnectorProviderProfile[]
  /** 任务进行中:凭证在 dispatch 时已定,不能中途改,chip 只读 */
  locked: boolean
  /** 本轮临时开关(不落库);locked 时不响应 */
  onToggle: (id: string, next: boolean) => void
  /** 选中某个 provider → 在对话里展开「接入」凭证卡片 */
  onPick: (id: string) => void
  /** 打开项目级「连接器」面板(换账号 / 解绑 / draft 与 live 分开配) */
  onOpenPanel: () => void
  /** 全局开关(未配置 CONNECTOR_KEK 等)关闭时整条隐藏 */
  enabled: boolean
}

/**
 * 对话栏上方的「本轮可用外部系统」能力条(见 docs/CONNECTORS.md §7)。
 *
 * 核心规则:**绑定即默认全生效,只有 override 才需要动手**。
 *   - 只读 provider:默认亮,点一下变灰 = 本轮临时关掉(不落库);
 *   - 可写 provider:默认灰,点一下才亮 = 本轮授权它动手(agent 写操作前还会再确认)。
 * 这样用户多数轮次零操作,不会变成"每次都要重选"的第二个附件。
 *
 * 「+ 连接」展开的是**内联列表**(不用浮层):移动端不会被视口裁掉,也不会挡住输入框;
 * 选中后由 Workspace 在对话流里展开凭证卡片,用户不用离开对话。
 */
export default function ConnectorChips({ chips, providers, locked, onToggle, onPick, onOpenPanel, enabled }: Props) {
  const t = useT()
  const [pickerOpen, setPickerOpen] = useState(false)
  if (!enabled) return null

  const picker = pickerOpen && (
    <div className="mt-1.5 w-full rounded-xl border border-gray-700 bg-gray-900/80 p-1.5">
      {providers.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-gray-500">{t('conn.none')}</p>
      ) : (
        providers.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setPickerOpen(false)
              onPick(p.id)
            }}
            className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-gray-800"
          >
            <span className="mt-0.5 shrink-0 text-xs">
              {chips.some((c) => c.id === p.id) ? '🔌' : '＋'}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-gray-200">{p.name}</span>
                <span className={`rounded px-1 text-[10px] ${p.writable ? 'bg-amber-500/15 text-amber-300' : 'bg-gray-800 text-gray-500'}`}>
                  {p.writable ? t('conn.writable') : t('conn.readonly')}
                </span>
                {chips.some((c) => c.id === p.id) && <span className="text-[10px] text-emerald-400">{t('conn.connected')}</span>}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-gray-500">{p.blurb}</span>
            </span>
          </button>
        ))
      )}
      <button
        onClick={() => {
          setPickerOpen(false)
          onOpenPanel()
        }}
        className="mt-0.5 flex w-full items-center gap-1.5 rounded-lg border-t border-gray-800 px-2 py-1.5 text-left text-[11px] text-gray-400 hover:text-gray-200"
      >
        {t('conn.manageAll')}
      </button>
    </div>
  )

  return (
    <div className="mb-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => {
          const kind = c.writable ? t('conn.writable') : t('conn.readonly')
          const title = locked
            ? t('conn.chipLocked')
            : c.on
              ? t('conn.chipOnTitle', { name: c.name, kind })
              : t('conn.chipOffTitle', { name: c.name, hint: c.writable ? t('conn.chipWritableHint') : '' })
          return (
            <button
              key={c.id}
              onClick={() => !locked && onToggle(c.id, !c.on)}
              disabled={locked}
              title={title}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                c.on ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200' : 'border-gray-700 bg-gray-900 text-gray-500'
              } ${locked ? 'cursor-not-allowed opacity-60' : 'hover:border-indigo-400'}`}
            >
              <span aria-hidden="true">{c.on ? '🔌' : '○'}</span>
              <span className="max-w-[140px] truncate">{c.name}</span>
              <span
                className={`rounded px-1 text-[10px] ${
                  c.writable ? (c.on ? 'bg-amber-500/20 text-amber-300' : 'bg-gray-800 text-gray-500') : 'bg-gray-800 text-gray-400'
                }`}
              >
                {c.writable ? t('conn.writable') : t('conn.readonly')}
              </span>
              {c.env === 'live' && <span className="text-[10px] text-gray-500">{t('env.live')}</span>}
              {locked && <span className="text-[10px] text-gray-500">🔒</span>}
            </button>
          )
        })}
        <button
          onClick={() => setPickerOpen((v) => !v)}
          title={t('conn.chipsAddTitle')}
          className={`flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs hover:border-indigo-500 hover:text-gray-200 ${
            pickerOpen ? 'border-indigo-500 text-gray-200' : 'border-gray-700 text-gray-400'
          }`}
        >
          <span>🔌</span>
          <span>{t('conn.connectExternal')}</span>
          <span className="text-gray-600">{pickerOpen ? '▾' : '+'}</span>
        </button>
      </div>
      {picker}
    </div>
  )
}
