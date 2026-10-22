import { useEffect } from 'react'

/**
 * Cloudflare Web Analytics(平台自身页面访问量 / 国家分布)。
 *
 * 为什么是运行时注入而不是写进 index.html:
 *   - 生产与 staging 共用同一份 `web/dist`,构建期写死会把 staging 的访问也算进生产;
 *   - beacon token 由 Worker 通过 `/api/auth/config` 下发,各环境在 `vars` 里配自己的
 *     站点 token(生产与 staging 是两个 site,统计数据互不混入);为空 → 不上报。
 *
 * `spa: true` 必须带:平台是 BrowserRouter 单页应用,不带这个只会记录首次整页加载,
 * 站内路由切换的 pageview 会全部丢失。自动注入不保证带该参数,所以走手动 snippet。
 */
export default function CloudflareAnalytics() {
  useEffect(() => {
    let alive = true
    fetch('/api/auth/config')
      .then((r) => (r.ok ? (r.json() as Promise<{ web_analytics_token?: string }>) : null))
      .then((cfg) => {
        const token = cfg?.web_analytics_token
        if (!alive || !token) return
        if (document.querySelector('script[data-forge-analytics]')) return
        const script = document.createElement('script')
        script.src = 'https://static.cloudflareinsights.com/beacon.min.js'
        script.type = 'module'
        script.defer = true
        script.setAttribute('data-cf-beacon', JSON.stringify({ token, spa: true }))
        script.setAttribute('data-forge-analytics', '1')
        document.head.appendChild(script)
      })
      .catch(() => {
        // 统计失败不影响页面
      })
    return () => {
      alive = false
    }
  }, [])

  return null
}
