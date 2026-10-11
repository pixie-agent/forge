/**
 * 每项目 × 每环境一个独立 SQLite 库(Durable Object,`new_sqlite_classes`)。
 *
 * 一个 DO 实例 = 一个 SQLite 文件,name = `${projectId}:${dataEnv}`(draft/live 各一个),
 * 天然做到「项目之间」「测试/线上之间」互不可见——不同于共享 D1 里靠 project_id 列过滤,
 * 这里的隔离是物理的。
 *
 * 承载两类流量:
 *   1. 生成应用的「文档」接口(db/:collection):集合 → 一张固定列的表(id/data/created_at/client_ip),
 *      HTTP 契约与旧的 D1 site_data 完全一致,所以已生成的应用无需改动。
 *   2. owner 的「SQL 控制台」:任意 SQL(建表、建索引、查询),走通用 exec。
 *
 * 说明:Durable Object 的 SQLite 是标准 SQLite(DDL/DML/索引/json_extract 均可用),
 * 但不支持 ATTACH,部分扩展(如 FTS5)是否可用以运行时为准,报错会原样回给控制台。
 */

import type { Env } from '../types'
import type { DataEnv } from './appdata'

export interface SqlResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowsRead: number
  rowsWritten: number
}

export interface SqlObject {
  type: 'table' | 'index' | 'view' | 'trigger'
  name: string
  sql: string
  count: number | null
}

export interface SeedRow {
  collection: string
  id: string
  data: string
  created_at: string
  client_ip: string
}

const COLLECTION_RE = /^[a-z][a-z0-9_-]{0,31}$/
const META_TABLE = '_forge_meta'

function parseJson(text: unknown): unknown {
  if (typeof text !== 'string') return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

/** 安全引用 SQLite 标识符(表/列名可能由用户在 SQL 控制台里自定义) */
function quoteId(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export class ProjectDb implements DurableObject {
  private sql: SqlStorage

  constructor(private ctx: DurableObjectState, _env: unknown) {
    this.sql = ctx.storage.sql
    // 元数据表:记录该库已初始化/已从旧 D1 site_data 回填过
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ${META_TABLE} (k TEXT PRIMARY KEY, v TEXT)`)
  }

  async fetch(request: Request): Promise<Response> {
    let payload: Record<string, unknown>
    try {
      payload = (await request.json()) as Record<string, unknown>
    } catch {
      return json({ error: '非法请求体' }, 400)
    }
    try {
      switch (payload.op) {
        case 'exec':
          return json(this.exec(String(payload.sql ?? ''), (payload.params as SqlStorageValue[]) ?? []))
        case 'schema':
          return json({ objects: this.schema() })
        case 'db.list':
          return json(this.listDocuments(String(payload.collection), Number(payload.limit ?? 100)))
        case 'db.add':
          return this.addDocument(payload)
        case 'db.update':
          return this.updateDocument(payload)
        case 'db.remove':
          this.removeDocument(String(payload.collection), String(payload.id))
          return json({ ok: true })
        case 'db.collections':
          return json({ collections: this.listCollections() })
        case 'seed':
          return json(this.seed(payload.rows as SeedRow[] | undefined))
        case 'seeded':
          return json({ seeded: this.isSeeded() })
        case 'destroy':
          this.ctx.storage.deleteAll()
          return json({ ok: true })
        default:
          return json({ error: `未知操作:${String(payload.op)}` }, 400)
      }
    } catch (err) {
      return json({ error: (err as Error).message || '执行失败' }, 400)
    }
  }

  // ---------- 通用 SQL(owner 控制台) ----------

  private exec(sql: string, params: SqlStorageValue[]): SqlResult {
    if (!sql.trim()) throw new Error('SQL 不能为空')
    const cursor = this.sql.exec(sql, ...params)
    return {
      columns: cursor.columnNames,
      rows: cursor.toArray() as unknown as Record<string, unknown>[],
      rowsRead: cursor.rowsRead,
      rowsWritten: cursor.rowsWritten,
    }
  }

  private schema(): SqlObject[] {
    // 隐藏平台内部对象:sqlite_* 以及下划线开头(如 _forge_meta、本地 dev 的 __miniflare_do_name)
    const raw = this.sql
      .exec(
        `SELECT type, name, COALESCE(sql,'') AS sql FROM sqlite_master
         WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_%' ESCAPE '\\'
         ORDER BY type, name`
      )
      .toArray() as unknown as { type: string; name: string; sql: string }[]
    return raw.map((o) => ({
      type: o.type as SqlObject['type'],
      name: o.name,
      sql: o.sql,
      count: o.type === 'table' ? this.rowCount(o.name) : null,
    }))
  }

  private rowCount(table: string): number {
    const row = this.sql.exec(`SELECT COUNT(*) AS n FROM ${quoteId(table)}`).one() as { n: number }
    return Number(row?.n ?? 0)
  }

  // ---------- 生成应用的「文档」接口 ----------

  private listDocuments(collection: string, limit = 100) {
    this.ensureTable(collection)
    const n = Math.min(200, Math.max(1, Number(limit) || 100))
    const rows = this.sql
      .exec(`SELECT id, data, created_at FROM ${quoteId(collection)} ORDER BY rowid DESC LIMIT ?`, n)
      .toArray() as unknown as { id: string; data: string; created_at: string }[]
    return { items: rows.map((r) => ({ id: r.id, data: parseJson(r.data), created_at: r.created_at })) }
  }

  /** owner 控制台:列出该库里所有「文档集合」(表)及行数,排除平台内部表 */
  private listCollections(): { name: string; count: number }[] {
    return this.schema()
      .filter((o) => o.type === 'table')
      .map((o) => ({ name: o.name, count: o.count ?? 0 }))
  }

  private addDocument(payload: Record<string, unknown>): Response {
    const collection = String(payload.collection)
    this.ensureTable(collection)
    const table = quoteId(collection)
    const clientIp = String(payload.clientIp ?? '')
    const rateLimit = Number(payload.rateLimit ?? 20)
    const maxRows = Number(payload.maxRows ?? 500)

    const recent = (this.sql
      .exec(`SELECT COUNT(*) AS n FROM ${table} WHERE client_ip = ? AND created_at > datetime('now','-60 seconds')`, clientIp)
      .one() as { n: number }).n
    if (recent >= rateLimit) return json({ error: '提交太频繁,请稍后再试' }, 429)

    const total = (this.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one() as { n: number }).n
    if (total >= maxRows) return json({ error: '该站点数据已满' }, 409)

    const id = crypto.randomUUID()
    this.sql.exec(`INSERT INTO ${table} (id, data, client_ip) VALUES (?, ?, ?)`, id, JSON.stringify(payload.data ?? {}), clientIp)
    return json({ id }, 201)
  }

  private updateDocument(payload: Record<string, unknown>): Response {
    const collection = String(payload.collection)
    this.ensureTable(collection)
    const table = quoteId(collection)
    const id = String(payload.id)
    const found = this.sql.exec(`SELECT data FROM ${table} WHERE id = ?`, id).toArray() as unknown as { data: string }[]
    if (!found.length) return json({ error: '记录不存在' }, 404)
    // 合并式更新(PATCH 语义):只覆盖传入字段,如 { done: true }
    const merged = parseJson(found[0].data) as Record<string, unknown>
    Object.assign(merged, (payload.patch as Record<string, unknown>) ?? {})
    this.sql.exec(`UPDATE ${table} SET data = ? WHERE id = ?`, JSON.stringify(merged), id)
    return json({ ok: true })
  }

  private removeDocument(collection: string, id: string): void {
    this.ensureTable(collection)
    this.sql.exec(`DELETE FROM ${quoteId(collection)} WHERE id = ?`, id)
  }

  private ensureTable(collection: string): void {
    if (!COLLECTION_RE.test(collection)) throw new Error('集合名不合法')
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS ${quoteId(collection)} (
         id         TEXT PRIMARY KEY,
         data       TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT (datetime('now')),
         client_ip  TEXT NOT NULL DEFAULT ''
       )`
    )
  }

  // ---------- 迁移:把旧 D1 site_data 的行回填进来 ----------

  private isSeeded(): boolean {
    const row = this.sql.exec(`SELECT v FROM ${META_TABLE} WHERE k = 'seeded'`).toArray() as unknown as { v: string }[]
    return row.length > 0
  }

  private seed(rows: SeedRow[] | undefined): { seeded: number } {
    let n = 0
    for (const r of rows ?? []) {
      this.ensureTable(r.collection)
      this.sql.exec(
        `INSERT OR IGNORE INTO ${quoteId(r.collection)} (id, data, created_at, client_ip) VALUES (?, ?, ?, ?)`,
        r.id,
        r.data,
        r.created_at,
        r.client_ip ?? ''
      )
      n++
    }
    this.sql.exec(`INSERT INTO ${META_TABLE} (k, v) VALUES ('seeded', datetime('now')) ON CONFLICT(k) DO UPDATE SET v = datetime('now')`)
    return { seeded: n }
  }
}

// ---------- Worker 侧调用封装 ----------

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

/** 定位某项目某环境对应的 DO 实例并调用;所有调用都走这里,保证 key 规则唯一 */
export async function callProjectDb<T = unknown>(
  env: Env,
  projectId: string,
  dataEnv: DataEnv,
  op: string,
  payload: Record<string, unknown> = {}
): Promise<{ status: number; body: T }> {
  const stub = env.PROJECT_DB.get(env.PROJECT_DB.idFromName(`${projectId}:${dataEnv}`))
  const res = await stub.fetch('https://project-db/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, ...payload }),
  })
  const body = (await res.json().catch(() => ({}))) as T
  return { status: res.status, body }
}

/** owner SQL 控制台执行任意 SQL;失败抛出带原因的错误 */
export async function runProjectSql(
  env: Env,
  projectId: string,
  dataEnv: DataEnv,
  sql: string,
  params: SqlStorageValue[] = []
): Promise<SqlResult> {
  const { status, body } = await callProjectDb<SqlResult & { error?: string }>(env, projectId, dataEnv, 'exec', { sql, params })
  if (status >= 400) throw new Error(body?.error ?? 'SQL 执行失败')
  return body
}

/** 列出某环境 SQLite 的表/索引/视图(含表行数) */
export async function projectSchema(env: Env, projectId: string, dataEnv: DataEnv): Promise<SqlObject[]> {
  const { body } = await callProjectDb<{ objects: SqlObject[] }>(env, projectId, dataEnv, 'schema', {})
  return body.objects ?? []
}

/** 项目删除时清空其两个环境的 SQLite 库 */
export async function destroyProjectDb(env: Env, projectId: string): Promise<void> {
  for (const dataEnv of ['draft', 'live'] as const) {
    try {
      await callProjectDb(env, projectId, dataEnv, 'destroy', {})
    } catch {
      // 库可能从未创建过;忽略
    }
  }
}

/** 把旧 D1 site_data 的行回填到该环境 SQLite(幂等,INSERT OR IGNORE) */
export async function seedProjectDocs(env: Env, projectId: string, dataEnv: DataEnv, rows: SeedRow[]): Promise<number> {
  if (!rows.length) return 0
  const { body } = await callProjectDb<{ seeded: number }>(env, projectId, dataEnv, 'seed', { rows })
  return body.seeded ?? 0
}

/** 该库是否已从旧 D1 回填过 */
export async function isProjectDbSeeded(env: Env, projectId: string, dataEnv: DataEnv): Promise<boolean> {
  const { body } = await callProjectDb<{ seeded: boolean }>(env, projectId, dataEnv, 'seeded', {})
  return Boolean(body.seeded)
}