/**
 * Forge 平台后端 SDK:生成应用用它读写数据,无需任何密钥。
 * 后端能力(由平台提供,按项目命名空间隔离):
 *   - db   :文档集合(留言板、报名表、评论、点赞…)→ 平台 D1
 *   - kv   :键值(配置、计数器…)→ 平台 KV
 *   - blob :对象存储(上传文件、图片…)→ 平台 R2
 *
 * 基址由平台在页面注入:window.__FORGE_API_BASE__(发布页 = 线上数据,预览页 = 草稿数据)。
 * 页面加载时先读取并渲染已有数据,提交成功后重新拉取刷新;请求失败要给出友好提示,不要让页面报错。
 * 只保存访问者主动提交或页面运行产生的数据;禁止收集密码、支付信息等敏感内容。
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

export const db = {
  /** 读取集合最新 100 条:返回 { items: [{ id, data, created_at }] } */
  list(collection) {
    return fetch(`${API_BASE}/db/${collection}`).then(toJson)
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
  /** 写入任意 JSON 值 */
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

export const blob = {
  /** 读取对象,成功返回 Blob,不存在返回 null */
  async get(key) {
    const res = await fetch(`${API_BASE}/blob/${key}`)
    return res.ok ? res.blob() : null
  },
  /** 上传对象(body 可为 Blob/File/字符串) */
  put(key, body, contentType = 'application/octet-stream') {
    return fetch(`${API_BASE}/blob/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body,
    }).then(toJson)
  },
  remove(key) {
    return fetch(`${API_BASE}/blob/${key}`, { method: 'DELETE' }).then(toJson)
  },
}