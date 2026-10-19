/**
 * Forge 连接器 SDK:读取「用户已为本项目接好的外部系统」的**公开配置**(非密值)。
 * 由平台在页面注入:window.__FORGE_CONNECTORS__(见后端 src/lib/artifacts.ts 的 injectRuntime)。
 *
 * 边界(务必理解):
 *   - 这里只有**公开值**(GA4 的 measurementId、地图 key、Stripe 的 publishable key…),**永远没有密钥**。
 *     需要密钥的能力(如用 Stripe secret key 建收款链接)**只在生成期**发生 —— 密钥在
 *     `.forge/connectors.json` 里,只给 agent 用,不进产物、不随页面下发;页面运行期不能携带密钥。
 *   - 未接任何连接器时该全局不存在:用 connector(id) 判断后再决定渲染什么,不要假设一定有。
 *   - 平台文件,不可修改;要新能力请让用户去「连接器」面板接入。
 *
 * 用法:
 *   import { connector, hasConnector } from './lib/connectors.js'
 *   const ga = connector('ga4')            // { measurementId: 'G-XXXX' } | null
 *   if (ga?.measurementId) loadGtag(ga.measurementId)
 */

const REGISTRY = (typeof window !== 'undefined' && window.__FORGE_CONNECTORS__) || null

/** 取某个连接器的公开配置;未接入返回 null(不要假设一定存在) */
export function connector(providerId) {
  return (REGISTRY && REGISTRY[providerId]) || null
}

/** 是否接入了某个连接器 */
export function hasConnector(providerId) {
  return Boolean(connector(providerId))
}

/** 已接入的连接器 id 列表 */
export function connectorIds() {
  return REGISTRY ? Object.keys(REGISTRY) : []
}

/**
 * 加载 Google Analytics 4 上报脚本(仅当用户填了 measurementId 时)。
 * 无配置时静默跳过 —— 没有接入的应用不应该报错。
 */
export function loadGA4(measurementId) {
  const id = measurementId || connector('ga4')?.measurementId
  if (!id || typeof document === 'undefined') return false
  if (document.querySelector(`script[data-forge-ga4="${id}"]`)) return true
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
  s.dataset.forgeGa4 = id
  document.head.appendChild(s)
  window.dataLayer = window.dataLayer || []
  function gtag() {
    window.dataLayer.push(arguments)
  }
  window.gtag = window.gtag || gtag
  gtag('js', new Date())
  gtag('config', id)
  return true
}
