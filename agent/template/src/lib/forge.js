/**
 * Forge 平台后端 SDK:生成应用用它读写数据,无需任何密钥。
 * 后端能力(由平台提供,按「项目 × 环境」隔离:预览页写的是测试数据,发布页写的是线上数据):
 *   - db      文档集合(留言板、报名、评论、待办、订单…)→ 项目独立 SQLite
 *   - kv      键值(设置项、开关、少量全局配置)
 *   - counter 原子计数(访问量、点赞数;并发自增不会丢)
 *   - blob    对象存储(图片、附件上传与读取)
 *
 * 基址由平台在页面注入:window.__FORGE_API_BASE__(发布页 = 线上数据,预览页 = 草稿数据)。
 *
 * 两条硬规则:
 *   1) 页面加载时先读已有数据渲染;写成功后重新拉取,让列表与所有统计一起变。
 *   2) 不要直接用 localStorage / sessionStorage —— 页面跑在沙箱里,访问它们会抛 SecurityError 导致白屏。
 *      需要「记住」的临时界面状态用下面的 storage.get/set(已做安全兜底);业务数据一律进 db / kv。
 */

const API_BASE = (typeof window !== 'undefined' && window.__FORGE_API_BASE__) || './api'

async function toJson(res) {
  if (!res.ok) {
    let msg = `请求失败(${res.status})`
    try {
      const body = await res.json()
      if (body && body.error) msg = body.error
    } catch {
      /* 非 JSON 响应 */
    }
    throw new Error(msg)
  }
  return res.json()
}

function qs(params) {
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null || v === '') continue
    out.set(k, String(v))
  }
  const s = out.toString()
  return s ? `?${s}` : ''
}

export const db = {
  /**
   * 读取集合:返回 { items:[{id,data,created_at}], total, limit, offset }
   * 分页 / 搜索 / 排序都在服务端做,不要把数据全拉回来自己算:
   *   db.list('todos', { limit: 10, offset: page * 10 })   分页
   *   db.list('todos', { q: keyword })                     子串搜索(匹配 JSON 文本)
   *   db.list('todos', { order: 'asc' })                   最早在前(默认最新在前)
   * total 是「符合条件的总条数」,页码与「共 N 条」都用它。
   */
  list(collection, { limit = 100, offset = 0, order, q } = {}) {
    return fetch(`${API_BASE}/db/${collection}${qs({ limit, offset, order, q })}`).then(toJson)
  },
  /** 只取总数(内部拉一页读 total);统计卡片用它,不要用 items.length 冒充总数 */
  async count(collection, { q } = {}) {
    const r = await fetch(`${API_BASE}/db/${collection}${qs({ limit: 1, q })}`).then(toJson)
    return Number(r.total ?? 0)
  },
  /** 新增一条:data 为 JSON 对象,返回 { id } */
  add(collection, data) {
    return fetch(`${API_BASE}/db/${collection}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(toJson)
  },
  /** 更新一条:patch 为要覆盖的字段(合并式,如 { done: true }),返回 { ok: true } */
  update(collection, id, patch) {
    return fetch(`${API_BASE}/db/${collection}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(toJson)
  },
  /** 删除一条 */
  remove(collection, id) {
    return fetch(`${API_BASE}/db/${collection}/${id}`, { method: 'DELETE' }).then(toJson)
  },
}

export const kv = {
  /** 读取键值;不存在返回 fallback */
  async get(key, fallback = null) {
    const r = await fetch(`${API_BASE}/kv/${key}`).then(toJson)
    return r.value === undefined || r.value === null ? fallback : r.value
  },
  /** 写入任意 JSON 值(单值上限 25KB) */
  set(key, value) {
    return fetch(`${API_BASE}/kv/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    }).then(toJson)
  },
  remove(key) {
    return fetch(`${API_BASE}/kv/${key}`, { method: 'DELETE' }).then(toJson)
  },
}

export const counter = {
  /**
   * 原子自增并返回新值。用于访问量、点赞数、下载次数这类「每次访问都要 +1」的数字。
   * 并发安全(服务端单条 UPDATE),比「先 get 再 set」可靠。
   *   const n = await counter.incr('pageviews')      → 1, 2, 3…
   *   const left = await counter.incr('likes', -1)   → 取消点赞
   */
  async incr(key, by = 1, start = 0) {
    const r = await fetch(`${API_BASE}/kv/${key}/incr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ by, start }),
    }).then(toJson)
    return Number(r.value ?? 0)
  },
  /** 读当前值(不存在返回 0) */
  async get(key) {
    const r = await fetch(`${API_BASE}/kv/${key}/incr`).then(toJson)
    return Number(r.value ?? 0)
  },
}

export const blob = {
  /** 读取对象,成功返回 Blob,不存在返回 null */
  async get(key) {
    const res = await fetch(`${API_BASE}/blob/${key}`)
    return res.ok ? res.blob() : null
  },
  /** 上传对象(body 可为 Blob/File/字符串);单文件上限 2MB */
  async put(key, body, contentType = 'application/octet-stream') {
    const size = body && typeof body === 'object' && 'size' in body ? Number(body.size) : 0
    if (size > 2 * 1024 * 1024) throw new Error('文件太大,请压缩到 2MB 以内再上传')
    return toJson(
      await fetch(`${API_BASE}/blob/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body,
      }),
    )
  },
  remove(key) {
    return fetch(`${API_BASE}/blob/${key}`, { method: 'DELETE' }).then(toJson)
  },
  /** 可直接用于 <img src> / <video src> 的地址 */
  url(key) {
    return `${API_BASE}/blob/${key}`
  },
  /** 列举对象(相册、附件列表):{ items:[{key,size,uploaded}], cursor, truncated } */
  list(prefix = '', { limit = 100, cursor } = {}) {
    return fetch(`${API_BASE}/blob${qs({ prefix, limit, cursor })}`).then(toJson)
  },
}

/** 生成一个不容易重复的对象键:uploads/1750000000000-8f3a1b.png */
export function uploadKey(file, dir = 'uploads') {
  const ext = (file?.name?.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)
  const rand = Math.random().toString(16).slice(2, 8)
  return `${dir}/${Date.now()}-${rand}${ext ? `.${ext}` : ''}`
}

/**
 * 本地存储的安全包装。页面跑在沙箱(opaque origin)里时 localStorage 会抛 SecurityError,
 * 直接用它会把整页打白;这里统一 try/catch,失败时退化为内存 —— 需要长期保存的数据请用 db / kv。
 *   storage.set('lastTab', 'list');  const tab = storage.get('lastTab', 'list')
 */
const memoryStore = new Map()
export const storage = {
  get(key, fallback = null) {
    try {
      const raw = window.localStorage.getItem(key)
      return raw === null ? (memoryStore.has(key) ? memoryStore.get(key) : fallback) : JSON.parse(raw)
    } catch {
      return memoryStore.has(key) ? memoryStore.get(key) : fallback
    }
  },
  set(key, value) {
    memoryStore.set(key, value)
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* 沙箱下不可用,内存兜底即可 */
    }
  },
  remove(key) {
    memoryStore.delete(key)
    try {
      window.localStorage.removeItem(key)
    } catch {
      /* 同上 */
    }
  },
}
