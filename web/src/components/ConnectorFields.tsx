import type { ConnectorConfigField, ConnectorSecretField } from '../lib/types'

/**
 * 连接器的两类输入框(连接器面板与「对话内凭证卡片」共用,避免两处漂移)。
 *
 *   - SecretField:密钥。type=password、不自动填充、不拼写检查;**值只上行,永不回显**。
 *   - ConfigField:非密配置。标了 public 的会随页面下发,必须在 UI 上说清楚。
 */

/** 密钥输入框:值只上行、永不回显 */
export function SecretField({
  field,
  value,
  onChange,
}: {
  field: ConnectorSecretField
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs text-gray-300">
        {field.label}
        {field.required && <span className="text-red-400">*</span>}
        <span className="rounded bg-gray-800 px-1 text-[10px] text-gray-500">保密</span>
      </span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 font-mono text-xs text-gray-100 outline-none focus:border-indigo-500"
      />
      {field.hint && <span className="mt-1 block text-[11px] leading-relaxed text-gray-500">{field.hint}</span>}
    </label>
  )
}

/** 非密配置输入框:public 的会被下发到生成页,标注出来免得用户以为它是私密的 */
export function ConfigField({
  field,
  value,
  missing,
  onChange,
}: {
  field: ConnectorConfigField
  value: string
  missing: boolean
  onChange: (v: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs text-gray-300">
        {field.label}
        {field.required && <span className="text-red-400">*</span>}
        {field.public && <span className="rounded bg-gray-800 px-1 text-[10px] text-gray-500">会在页面上公开</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className={`w-full rounded-lg border bg-gray-900 px-2.5 py-1.5 text-xs text-gray-100 outline-none focus:border-indigo-500 ${
          missing ? 'border-amber-500/60' : 'border-gray-700'
        }`}
      />
      {field.hint && <span className="mt-1 block text-[11px] text-gray-500">{field.hint}</span>}
    </label>
  )
}
