/**
 * Google Analytics 4(第一个连接器,只读)。
 *
 * 为什么它打头:零资金风险、能同时验证「public 值下发」与「生成期读真实数据」两条链路,
 * 且**逼不出任何平台侧后端** —— 框架立不立得住,在这个 provider 上一眼可见(见 docs/CONNECTORS.md §0)。
 *
 * 只读:scopes 只有 analytics.readonly,writeScopes 为空 → 默认每一轮都带上,不需要用户点亮。
 * 两个配置项:
 *   - propertyId    非密,agent 用它调 Data API 读报表(必填)
 *   - measurementId 公开,会随页面下发,用于生成的应用上报访问(可选)
 */

import type { ConnectorProvider } from '../registry'

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const GA_ADMIN_ACCOUNT_SUMMARIES = 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=50'

/** 用令牌取账号标识(仅展示用)。Admin API 未启用 / 无权限时返回 null,不影响连接建立 */
async function fetchAccountLabel(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(GA_ADMIN_ACCOUNT_SUMMARIES, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) return null
    const data = (await res.json()) as {
      accountSummaries?: { displayName?: string; propertySummaries?: unknown[] }[]
    }
    const first = data.accountSummaries?.[0]
    if (!first) return null
    const props = first.propertySummaries?.length ?? 0
    return props > 0 ? `${first.displayName ?? 'Google Analytics'}(${props} 个资源)` : first.displayName ?? 'Google Analytics'
  } catch {
    return null
  }
}

export const ga4: ConnectorProvider = {
  id: 'ga4',
  name: 'Google Analytics 4',
  blurb: '让 agent 读到真实访问数据,生成的应用也能上报访问',
  auth: 'oauth',
  scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  writeScopes: [],
  configFields: [
    {
      key: 'propertyId',
      label: 'GA4 资源 ID',
      placeholder: '123456789',
      hint: 'GA4 → 管理 → 资源设置里的一串数字;agent 用它读报表',
      required: true,
    },
    {
      key: 'measurementId',
      label: '数据流 ID(可选)',
      placeholder: 'G-XXXXXXXXXX',
      hint: '填了会随页面下发,供生成的应用上报访问',
      public: true,
    },
  ],
  secretFields: ['accessToken', 'refreshToken'],
  oauth: {
    clientKind: 'google',
    authorizeUrl: GOOGLE_AUTHORIZE,
    tokenUrl: GOOGLE_TOKEN,
    // offline + consent:拿到 refresh_token(access_token 一小时就过期,只用于当次生成够用,长效读取靠 refresh)
    authParams: { access_type: 'offline', prompt: 'consent' },
    fetchAccountLabel,
  },
  agentHint: [
    'GA4(只读):本次已授权一个 GA4 账号,凭证与配置在 `.forge/connectors.json` 的 `ga4` 下。',
    '- 读报表用 bash + curl(不要自己新写后端):',
    '  curl -s -X POST "https://analyticsdata.googleapis.com/v1beta/properties/<propertyId>:runReport" \\',
    '    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\',
    '    -d \'{"dateRanges":[{"startDate":"28daysAgo","endDate":"today"}],"metrics":[{"name":"sessions"},{"name":"screenPageViews"},{"name":"totalUsers"}],"dimensions":[{"name":"date"}]}\'',
    '  其中 propertyId 取 `config.propertyId`,TOKEN 取 `credentials.accessToken`。',
    '- **必须用真实数字**渲染统计区块;取不到(403/404)就在交付说明里如实说明原因,禁止编造数据。',
    '- 凭证绝不能写进源码或 src/ 下任何文件(会被打进产物、进版本库)。',
  ].join('\n'),
}
