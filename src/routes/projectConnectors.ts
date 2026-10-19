/**
 * 连接器 · 项目级接口(见 docs/CONNECTORS.md §7「完整管理放项目级」)。
 *
 *   GET    /api/projects/:id/connectors?env=live   面板所需的全部信息(可用 provider + 本环境绑定状态)
 *   PUT    /api/projects/:id/connectors            A 类配置 / 把某个连接绑到本项目(该环境)
 *   DELETE /api/projects/:id/connectors/:provider  解绑(不动账号级连接)
 *
 * 为什么单独一个路由文件:projects.ts 已经很长,而这一组接口只服务连接器;
 * Hono 允许多个 router 挂在同一前缀上(src/index.ts 里与 projectRoutes 并列挂载)。
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv, ProjectRow } from '../types'
import { requireUser } from '../lib/auth'
import type { DataEnv } from '../lib/appdata'
import { connectorRedirectUri, getProvider, listProviders, providerProfile } from '../lib/connectors/registry'
import {
  connectorsEnabled,
  getConnection,
  listBindings,
  listConnections,
  parseConfig,
  removeBinding,
  setBinding,
} from '../lib/connectors/store'

const app = new Hono<AppEnv>()
app.use('*', requireUser)

async function ownedProject(c: Context<AppEnv>, id: string): Promise<ProjectRow | null> {
  return c.env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').bind(id, c.get('user').id).first<ProjectRow>()
}

function dataEnvOf(raw: string | undefined | null): DataEnv | null {
  const env = raw ?? 'live'
  return env === 'draft' || env === 'live' ? env : null
}

/** 面板数据:每个 provider 带上「本环境是否已绑定、绑的是哪个账号、缺哪些配置」 */
app.get('/:id/connectors', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const dataEnv = dataEnvOf(c.req.query('env'))
  if (!dataEnv) return c.json({ error: '参数不合法' }, 400)

  const profiles = listProviders().map((p) => providerProfile(p, c.env, connectorRedirectUri(c.env, p.id, c.req.url)))
  if (!connectorsEnabled(c.env)) {
    return c.json({ enabled: false, reason: '未配置 CONNECTOR_KEK', env: dataEnv, providers: profiles, connections: [] })
  }

  const [bindings, connections] = await Promise.all([
    listBindings(c.env.DB, project.id, dataEnv),
    listConnections(c.env.DB, c.get('user').id),
  ])
  const byProvider = new Map(bindings.map((b) => [b.provider, b]))

  const providers = listProviders().map((p) => {
    const binding = byProvider.get(p.id)
    const config = parseConfig(binding?.config_json)
    const connectionId = config.connectionId ?? ''
    const connection = connectionId ? connections.find((x) => x.id === connectionId) ?? null : null
    const missing = p.configFields.filter((f) => f.required && !config[f.key]).map((f) => f.key)
    return {
      ...providerProfile(p, c.env, connectorRedirectUri(c.env, p.id, c.req.url)),
      binding: binding
        ? {
            config,
            connectionId: connectionId,
            accountLabel: connection?.account_label ?? null,
            connectionStatus: connection?.status ?? (p.auth === 'oauth' ? ('missing' as const) : null),
            missing,
            createdAt: binding.created_at,
          }
        : null,
    }
  })

  return c.json({
    enabled: true,
    env: dataEnv,
    providers,
    connections: connections.map((r) => ({
      id: r.id,
      provider: r.provider,
      accountLabel: r.account_label,
      scopes: r.scopes.split(' ').filter(Boolean),
      status: r.status,
    })),
  })
})

/**
 * 绑定 / 更新配置。两种用法其实是同一条写入:
 *   - auth: 'config' → 只填 config(measurementId / 付款链接)
 *   - auth: 'oauth'  → 授权回调已自动绑好;这里用于补配置(propertyId)或换绑另一个账号
 * 只接受 provider.configFields 里声明过的键,写不进未知字段。
 */
app.put('/:id/connectors', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  if (!connectorsEnabled(c.env)) return c.json({ error: '未配置 CONNECTOR_KEK,连接器不可用' }, 400)

  const body = await c.req
    .json<{ provider?: string; env?: string; config?: Record<string, unknown>; connectionId?: string }>()
    .catch(() => null)
  const dataEnv = dataEnvOf(body?.env)
  const provider = body?.provider ? getProvider(body.provider) : null
  if (!dataEnv) return c.json({ error: '参数不合法' }, 400)
  if (!provider) return c.json({ error: '未知的连接器' }, 400)

  const allowed = new Set(provider.configFields.map((f) => f.key))
  const config: Record<string, string> = {}
  for (const [k, v] of Object.entries(body?.config ?? {})) {
    if (!allowed.has(k) || v === undefined || v === null) continue
    config[k] = String(v).trim()
  }
  if (body?.connectionId) {
    const connection = await getConnection(c.env.DB, c.get('user').id, body.connectionId)
    if (!connection) return c.json({ error: '连接不存在' }, 404)
    config.connectionId = connection.id
  }
  // 必填项校验:只在「oauth 已授权」或「config 形态」下强制,避免阻断"先绑后填"的中间态
  for (const field of provider.configFields) {
    if (field.required && !config[field.key]) return c.json({ error: `请填写「${field.label}」` }, 400)
  }

  const existing = await listBindings(c.env.DB, project.id, dataEnv)
  const prev = parseConfig(existing.find((b) => b.provider === provider.id)?.config_json)
  await setBinding(c.env.DB, project.id, provider.id, dataEnv, { ...prev, ...config })
  return c.json({ ok: true, env: dataEnv, provider: provider.id })
})

/** 解绑:只删项目级绑定,账号级连接保留(别的项目可能还在用) */
app.delete('/:id/connectors/:provider', async (c) => {
  const project = await ownedProject(c, c.req.param('id'))
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const dataEnv = dataEnvOf(c.req.query('env'))
  if (!dataEnv) return c.json({ error: '参数不合法' }, 400)
  const provider = getProvider(c.req.param('provider'))
  if (!provider) return c.json({ error: '未知的连接器' }, 404)
  await removeBinding(c.env.DB, project.id, provider.id, dataEnv)
  return c.json({ ok: true })
})

export const projectConnectorRoutes = app
