/**
 * 连接器的读写与解析(D1 两张表:connections 账号级、project_connectors 项目级)。
 * 见 docs/CONNECTORS.md §4 的数据模型与 §5 的 provider 定义。
 *
 * 三条边界:
 *   1) 凭证永远加密后再落库(encryptCredentials);明文只活在内存与一次 dispatch 里。
 *   2) 项目级绑定带 env 维度(draft/live),与 KV/R2/DO 的「项目 × 环境」口径一致。
 *   3) 解析给 agent 的授权(resolveGrants)遵循「只读默认开、可写要显式点亮」(§7)。
 */

import type { ConnectionRow, ConnectorGrant, Env, ProjectConnectorRow } from '../../types'
import type { DataEnv } from '../appdata'
import { decryptCredentials, encryptCredentials } from './crypto'
import { getProvider, isWritable } from './registry'

/** 未配置 CONNECTOR_KEK 时连接器整体不可用(不影响其他功能) */
export function connectorsEnabled(env: Env): boolean {
  return Boolean(env.CONNECTOR_KEK)
}

export function requireKek(env: Env): string {
  if (!env.CONNECTOR_KEK) throw new Error('未配置 CONNECTOR_KEK,连接器不可用')
  return env.CONNECTOR_KEK
}

/** config_json 容错解析:损坏的配置按空对象处理,不让一行脏数据打挂整个面板 */
export function parseConfig(json: string | null | undefined): Record<string, string> {
  if (!json) return {}
  try {
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
      else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v)
    }
    return out
  } catch {
    return {}
  }
}

// ─────────────────────────── 账号级连接 ───────────────────────────

export async function listConnections(db: D1Database, userId: string): Promise<ConnectionRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM connections WHERE user_id = ? ORDER BY provider, created_at DESC')
    .bind(userId)
    .all<ConnectionRow>()
  return results
}

export async function getConnection(db: D1Database, userId: string, id: string): Promise<ConnectionRow | null> {
  return db.prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?').bind(id, userId).first<ConnectionRow>()
}

/**
 * 新建或更新一条连接(同一 provider + 同一账号标识视为同一条:重新授权即覆盖凭证)。
 * 授权成功即 status='active';refresh_token 缺失(用户此前已授权过、Google 不再发 refresh_token)时保留旧值。
 */
export async function saveConnection(
  env: Env,
  userId: string,
  providerId: string,
  credentials: Record<string, string>,
  accountLabel: string,
  scopes: string[]
): Promise<ConnectionRow> {
  const kek = requireKek(env)
  const existing = await env.DB
    .prepare('SELECT * FROM connections WHERE user_id = ? AND provider = ? AND account_label = ?')
    .bind(userId, providerId, accountLabel)
    .first<ConnectionRow>()

  const merged = { ...credentials }
  if (!merged.refreshToken && existing) {
    try {
      const old = await decryptCredentials(kek, existing.credentials)
      if (old.refreshToken) merged.refreshToken = old.refreshToken
    } catch {
      // 旧凭证解不开(KEK 换过)→ 直接用新凭证
    }
  }

  const encrypted = await encryptCredentials(kek, merged)
  const id = existing?.id ?? crypto.randomUUID()
  await env.DB
    .prepare(
      `INSERT INTO connections (id, user_id, provider, account_label, scopes, credentials, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', datetime('now'))
       ON CONFLICT(user_id, provider, account_label) DO UPDATE SET
         scopes = excluded.scopes, credentials = excluded.credentials, status = 'active', updated_at = datetime('now')`
    )
    .bind(id, userId, providerId, accountLabel, scopes.join(' '), encrypted)
    .run()
  const row = await getConnection(env.DB, userId, id)
  if (!row) throw new Error('连接保存失败')
  return row
}

/** 撤销:只改状态不删行(项目绑定仍指向它,面板上显示「已撤销,需重新授权」) */
export async function revokeConnection(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE connections SET status = 'revoked', updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run()
  return Boolean(res.meta.changes)
}

/** 解密一条连接的凭证;失败统一抛「请重新授权」(KEK 换过 / 数据被改 / 上游已吊销) */
export async function decryptConnection(env: Env, row: ConnectionRow): Promise<Record<string, string>> {
  try {
    return await decryptCredentials(requireKek(env), row.credentials)
  } catch {
    throw new Error('连接凭证已失效,请在「连接器」里重新授权')
  }
}

// ─────────────────────────── 项目级绑定 ───────────────────────────

export async function listBindings(db: D1Database, projectId: string, dataEnv?: DataEnv): Promise<ProjectConnectorRow[]> {
  const sql = dataEnv
    ? 'SELECT * FROM project_connectors WHERE project_id = ? AND env = ? ORDER BY provider'
    : 'SELECT * FROM project_connectors WHERE project_id = ? ORDER BY env, provider'
  const stmt = dataEnv ? db.prepare(sql).bind(projectId, dataEnv) : db.prepare(sql).bind(projectId)
  const { results } = await stmt.all<ProjectConnectorRow>()
  return results
}

/** 绑定(幂等):config 全量覆盖,connectionId 一并写进 config_json */
export async function setBinding(
  db: D1Database,
  projectId: string,
  providerId: string,
  dataEnv: DataEnv,
  config: Record<string, string>
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO project_connectors (project_id, provider, env, config_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, provider, env) DO UPDATE SET config_json = excluded.config_json`
    )
    .bind(projectId, providerId, dataEnv, JSON.stringify(config))
    .run()
}

export async function removeBinding(db: D1Database, projectId: string, providerId: string, dataEnv: DataEnv): Promise<void> {
  await db
    .prepare('DELETE FROM project_connectors WHERE project_id = ? AND provider = ? AND env = ?')
    .bind(projectId, providerId, dataEnv)
    .run()
}

/** 删除项目时清掉它的绑定(凭证属于账号,保留) */
export async function deleteProjectBindings(db: D1Database, projectId: string): Promise<void> {
  await db.prepare('DELETE FROM project_connectors WHERE project_id = ?').bind(projectId).run()
}

// ─────────────────────────── 解析 ───────────────────────────

export interface ResolveOptions {
  /** 用户在本轮显式关掉的 provider(per-turn 临时开关,见 §7) */
  disabled?: string[]
  /** 用户在本轮显式点亮的「可写」provider;只读 provider 不需要出现在这里 */
  enabled?: string[]
}

/**
 * 解析出「本次生成可用的能力」。规则:
 *   - 该环境下没有绑定的 provider → 跳过
 *   - 可写 provider 未在本轮点亮 → 跳过(默认问,§7)
 *   - oauth provider 的凭证解不开 / 连接已撤销 → 跳过(面板负责提示重连,不让生成直接失败)
 *   - auth: 'config' 的 provider 无需授权,直接作为能力下发
 */
export async function resolveGrants(
  env: Env,
  userId: string,
  projectId: string,
  dataEnv: DataEnv,
  opts: ResolveOptions = {}
): Promise<ConnectorGrant[]> {
  if (!connectorsEnabled(env)) return []
  const disabled = new Set(opts.disabled ?? [])
  const enabled = new Set(opts.enabled ?? [])
  const bindings = await listBindings(env.DB, projectId, dataEnv)
  const grants: ConnectorGrant[] = []

  for (const binding of bindings) {
    const provider = getProvider(binding.provider)
    if (!provider || disabled.has(provider.id)) continue
    const writable = isWritable(provider)
    if (writable && !enabled.has(provider.id)) continue

    const config = parseConfig(binding.config_json)
    // 必填配置没填齐 → 这个能力对 agent 其实不可用(比如 GA4 少了 propertyId,读报表必然 404):
    // 与其把半截能力递过去让它白跑,不如跳过 —— 面板/卡片负责告诉用户还缺什么(与 binding.missing 同口径)
    if (provider.configFields.some((f) => f.required && !config[f.key])) continue

    if (provider.auth === 'config') {
      grants.push({ provider: provider.id, accountLabel: provider.name, scopes: [], writable, config, hint: provider.agentHint })
      continue
    }

    const connectionId = config.connectionId ?? ''
    const row = connectionId ? await getConnection(env.DB, userId, connectionId) : null
    if (!row || row.status !== 'active') continue

    let creds: Record<string, string>
    try {
      creds = await decryptConnection(env, row)
    } catch {
      continue
    }
    const secrets: Record<string, string> = {}
    for (const key of provider.secretFields) {
      if (creds[key]) secrets[key] = creds[key]
    }
    grants.push({
      provider: provider.id,
      accountLabel: row.account_label,
      scopes: row.scopes.split(' ').filter(Boolean),
      writable,
      credentials: secrets,
      config,
      hint: provider.agentHint,
    })
  }
  return grants
}

/**
 * 下发给生成页的**公开**配置(注入 window.__FORGE_CONNECTORS__)。
 * 只取 provider.configFields 里标了 public 的键 —— 凭证与内部配置一律不下发(页面是 opaque origin 的公开产物)。
 */
export async function publicConfig(env: Env, projectId: string, dataEnv: DataEnv): Promise<Record<string, Record<string, string>>> {
  if (!connectorsEnabled(env)) return {}
  const bindings = await listBindings(env.DB, projectId, dataEnv)
  const out: Record<string, Record<string, string>> = {}
  for (const binding of bindings) {
    const provider = getProvider(binding.provider)
    if (!provider) continue
    const config = parseConfig(binding.config_json)
    const publicKeys = provider.configFields.filter((f) => f.public).map((f) => f.key)
    const picked: Record<string, string> = {}
    for (const key of publicKeys) {
      if (config[key]) picked[key] = config[key]
    }
    if (Object.keys(picked).length) out[provider.id] = picked
  }
  return out
}
