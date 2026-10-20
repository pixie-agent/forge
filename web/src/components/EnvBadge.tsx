import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n'

/**
 * 平台环境角标:只有非 production 环境(目前是 staging)才渲染。
 *
 * 必须运行时取(而不是 Vite 构建期变量):生产与 staging 共用同一份 `web/dist`,
 * 构建期注入会把 staging 角标一起打进生产包里。
 */
export default function EnvBadge() {
  const [env, setEnv] = useState<string | null>(null)
  const t = useT()

  useEffect(() => {
    let alive = true
    fetch('/api/auth/config')
      .then((r) => (r.ok ? (r.json() as Promise<{ environment?: string }>) : null))
      .then((d) => {
        if (alive && d?.environment) setEnv(d.environment)
      })
      .catch(() => {
        // 取不到就不显示角标,不影响页面
      })
    return () => {
      alive = false
    }
  }, [])

  if (!env || env === 'production') return null

  return (
    <span
      className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300"
      title={t('env.stagingHint')}
    >
      {env.toUpperCase()}
    </span>
  )
}
