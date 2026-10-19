import { useId } from 'react'
import { cx } from '../../lib/cx.js'

/**
 * 表单控件。label / 错误提示 / 无障碍属性自动关联,直接用即可:
 *   <Input label="你的名字" value={name} onChange={e => setName(e.target.value)} error={err} />
 *   <Textarea label="留言" rows={4} … />
 *   <Select label="分类" options={[{value:'a',label:'A'}]} … />
 */
const base =
  'w-full rounded-field border bg-canvas px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted/70 ' +
  'transition-colors duration-200 ease-soft focus:outline-none focus:ring-2 focus:ring-brand/35 disabled:opacity-50'

export function Field({ label, hint, error, required = false, htmlFor, className = '', children }) {
  return (
    <div className={cx('w-full', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink">
          {label}
          {required ? <span className="ml-0.5 text-danger">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1.5 text-[13px] text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[13px] text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

export function Input({ label, hint, error, required = false, className = '', id, ...rest }) {
  const auto = useId()
  const fieldId = id ?? auto
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={fieldId}>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        className={cx(base, error ? 'border-danger' : 'border-line', className)}
        {...rest}
      />
    </Field>
  )
}

export function Textarea({ label, hint, error, required = false, rows = 4, className = '', id, ...rest }) {
  const auto = useId()
  const fieldId = id ?? auto
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={fieldId}>
      <textarea
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        className={cx(base, 'resize-y leading-relaxed', error ? 'border-danger' : 'border-line', className)}
        {...rest}
      />
    </Field>
  )
}

export function Select({ label, hint, error, required = false, options = [], className = '', id, children, ...rest }) {
  const auto = useId()
  const fieldId = id ?? auto
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={fieldId}>
      <select
        id={fieldId}
        className={cx(base, 'appearance-none pr-9', error ? 'border-danger' : 'border-line', className)}
        {...rest}
      >
        {children ??
          options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
      </select>
    </Field>
  )
}

/** 开关:适合设置项、筛选。受控用法 checked + onChange(next) */
export function Switch({ checked = false, onChange, label, disabled = false, className = '' }) {
  return (
    <label className={cx('inline-flex items-center gap-2.5 select-none', disabled && 'opacity-50', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={cx(
          'relative h-6 w-11 shrink-0 rounded-pill transition-colors duration-250 ease-soft',
          checked ? 'bg-brand' : 'bg-panel-2 border border-line',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-card transition-transform duration-300 ease-soft',
            checked ? 'left-0.5 translate-x-5' : 'left-0.5',
          )}
        />
      </button>
      {label ? <span className="text-[15px] text-ink">{label}</span> : null}
    </label>
  )
}
