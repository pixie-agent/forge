/**
 * 连接器 provider 注册表。
 *
 * 加一个 provider = 加一个文件(providers/*.ts)并在这里注册,**不改核心代码**、不动 schema。
 *
 * 三种形态(见 docs/CONNECTORS.md §5):
 *   - auth: 'config' → 「配置」:用户自己填个值(GA4 的 measurementId、Stripe 的付款链接)。
 *                      没有 connections 行、没有 OAuth 流程,UI 上就是个输入框。
 *   - auth: 'oauth'  → 「连接」:用户授权自己的外部账号,凭证加密存 connections。
 *   - auth: 'apikey' → 「自带密钥」:用户把第三方控制台里生成的密钥**粘贴**进来,加密存 connections。
 *                      **不需要平台去外部登记任何 OAuth 客户端/回调地址** —— 这就是长尾 provider
 *                      唯一可扩展的形态:平台只提供加密存储与下发通道,不替任何 provider 走审批。
 *
 * 权限分档(§7):scopes 是只读,默认每一轮都带上;writeScopes 非空即「可写」provider,
 * 默认**不**带上,要用户在本轮显式点亮,且 agent 触发写操作时应先取得确认。
 * (`writeScopes` 对 'apikey' 形态只当作「可写能力标签」用 —— 密钥能做什么由对方控制台授权范围决定)
 */

import type { Env } from '../../types'
import { ga4 } from './providers/ga4'
import { stripe } from './providers/stripe'

export type ConnectorAuthKind = 'oauth' | 'config' | 'apikey'

/** OAuth 客户端来源:目前只有 Google(复用登录那套 GOOGLE_CLIENT_ID/SECRET) */
export type OauthClientKind = 'google'

export interface ConnectorConfigField {
  key: string
  label: string
  hint?: string
  placeholder?: string
  /** true = 该值会随生成页下发(window.__FORGE_CONNECTORS__);本来就是公开值(measurementId 这类) */
  public?: boolean
  required?: boolean
}

/** auth:'apikey' 时要用户粘贴的一项密钥(面板渲染成密码输入框,值只上行、不回显) */
export interface ConnectorSecretField {
  key: string
  label: string
  hint?: string
  placeholder?: string
  required?: boolean
}

export interface ConnectorOauthDef {
  clientKind: OauthClientKind
  authorizeUrl: string
  tokenUrl: string
  /** 授权时附加参数(如 Google 的 access_type=offline / prompt=consent) */
  authParams?: Record<string, string>
  /** 用令牌换一个人类可读的账号标识(「已连接 acme.com」);失败返回 null,**不阻断连接** */
  fetchAccountLabel: (accessToken: string) => Promise<string | null>
}

export interface ConnectorProvider {
  id: string
  name: string
  blurb: string
  auth: ConnectorAuthKind
  /** 只读 scope;auth: 'config' 时为 [] */
  scopes: string[]
  /** 可写 scope:非空即「可写」provider → 默认不自动带上(§7 第二条判据) */
  writeScopes: string[]
  configFields: ConnectorConfigField[]
  /** 必须保密、只在生成期交给 agent 的凭证键(agent 侧落在 .forge/connectors.json,随容器销毁) */
  secretFields: string[]
  /** auth:'apikey' 时由用户粘贴的密钥项(渲染成输入框);其他形态留空 */
  secretInputs?: ConnectorSecretField[]
  oauth?: ConnectorOauthDef
  /** 生成期给 agent 的用法说明(拼进 system prompt) */
  agentHint?: string
}

const ALL: ConnectorProvider[] = [ga4, stripe]

export const PROVIDERS: Record<string, ConnectorProvider> = Object.fromEntries(ALL.map((p) => [p.id, p]))

export function getProvider(id: string): ConnectorProvider | null {
  return PROVIDERS[id] ?? null
}

/** 面板里按注册顺序列出全部 provider */
export function listProviders(): ConnectorProvider[] {
  return ALL
}

/** 可写 provider:绑定后不默认带上,需要用户在本轮点亮 */
export function isWritable(p: ConnectorProvider): boolean {
  return p.writeScopes.length > 0
}

/** OAuth 客户端凭据(来自 Worker secret);未配置返回 null → 该 provider 的连接入口不可用 */
export function oauthClient(env: Env, p: ConnectorProvider): { clientId: string; clientSecret: string } | null {
  if (!p.oauth) return null
  if (p.oauth.clientKind === 'google') {
    const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = env
    return clientId && clientSecret ? { clientId, clientSecret } : null
  }
  return null
}

/** profile:给前端的 provider 形状(剥掉函数与内部字段,secretFields 只给个数用于文案) */
export interface ProviderProfile {
  id: string
  name: string
  blurb: string
  auth: ConnectorAuthKind
  writable: boolean
  configFields: ConnectorConfigField[]
  /** 该 provider 是否需要 OAuth 客户端(前端据此提示「未配置」) */
  needsOauthClient: boolean
  /** OAuth 回调地址:必须由用户在外部控制台原样登记,面板直接展示出来免得靠猜 */
  redirectUri?: string
  /** auth:'apikey' 时要用户粘贴的密钥项(面板据此渲染输入框;永不回显已存的值) */
  secretInputs?: ConnectorSecretField[]
}

/**
 * 连接器的 OAuth 回调地址:优先 PUBLIC_BASE_URL(必须与外部控制台登记的完全一致)。
 *
 * 这个值**必须原样**填进 Google Cloud Console 的「已获授权的重定向 URI」,否则授权页直接
 * 返回 400 redirect_uri_mismatch(错误发生在 Google 侧,平台收不到任何回调,无法兜底提示)。
 * 所以把它作为数据下发到面板,而不是写在文档里让人手抄。
 */
export function connectorRedirectUri(env: Env, providerId: string, requestUrl: string): string {
  const base = env.PUBLIC_BASE_URL?.replace(/\/+$/, '') || new URL(requestUrl).origin
  return `${base}/api/connections/${providerId}/callback`
}

export function providerProfile(p: ConnectorProvider, env: Env, redirectUri?: string): ProviderProfile {
  return {
    id: p.id,
    name: p.name,
    blurb: p.blurb,
    auth: p.auth,
    writable: isWritable(p),
    configFields: p.configFields,
    needsOauthClient: p.auth === 'oauth' && !oauthClient(env, p),
    redirectUri: p.auth === 'oauth' ? redirectUri : undefined,
    secretInputs: p.auth === 'apikey' ? (p.secretInputs ?? []) : undefined,
  }
}
