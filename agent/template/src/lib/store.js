/**
 * 数据 hooks:列表、统计、键值、计数、上传。把「读数据 / 写数据 / 三态 / 刷新」打包好,
 * 页面只负责渲染,避免「新增了但计数没变」「刷新一下就没了」这类问题。
 *
 * 用法(列表 + 统计,最常见):
 *   import { useCollection } from './lib/store.js'
 *   const { items, total, loading, error, add, toggle, remove, query, setQuery, hasMore, loadMore } = useCollection('todos')
 *   // 列表:items.map(...)   总条数:total(服务端返回的真实总数,不是 items.length)
 *   // 关键字搜索:<Input value={query} onChange={e => setQuery(e.target.value)} />
 *
 * 关键约定:列表与所有统计都从同一份数据派生(统计用 total 或 items 现场算),
 * 不要另建一份 count 之类的并行 state,否则数字会和列表对不上(这是最常见的 bug)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { blob, counter, db, kv, uploadKey } from './forge.js'

/** 把服务端 {id,data,created_at} 摊平成 {id,created_at,...data},用起来更顺手 */
function flatten(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({ ...(r.data ?? {}), id: r.id, created_at: r.created_at }))
}

/** 值防抖:搜索框这类高频输入用(默认 300ms) */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * 集合(列表)hook。
 *   options.sort      前端排序函数(可选)
 *   options.pageSize  每页条数(默认 100,服务端上限 200)
 *   options.query     初始搜索关键字
 */
export function useCollection(collection, options = {}) {
  const { sort, pageSize = 100, query: initialQuery = '' } = options
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState(initialQuery)
  const keyword = useDebounced(query, 300)
  const sortRef = useRef(sort)
  sortRef.current = sort

  const order = useCallback((list) => (sortRef.current ? [...list].sort(sortRef.current) : list), [])

  /** 拉第一页(offset=0);reload 也走它 */
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setError('')
      const res = await db.list(collection, { limit: pageSize, offset: 0, q: keyword })
      setItems(order(flatten(res.items)))
      setTotal(Number(res.total ?? 0))
      return true
    } catch (e) {
      setError(e?.message || '加载失败')
      return false
    } finally {
      setLoading(false)
    }
  }, [collection, pageSize, keyword, order])

  useEffect(() => {
    reload()
  }, [reload])

  /** 追加下一页(「加载更多」按钮 / 无限滚动) */
  const loadMore = useCallback(async () => {
    if (loadingMore || loading) return
    setLoadingMore(true)
    try {
      setError('')
      const res = await db.list(collection, { limit: pageSize, offset: items.length, q: keyword })
      const next = flatten(res.items)
      setItems((prev) => order([...prev, ...next.filter((n) => !prev.some((p) => p.id === n.id))]))
      setTotal(Number(res.total ?? 0))
    } catch (e) {
      setError(e?.message || '加载失败')
    } finally {
      setLoadingMore(false)
    }
  }, [collection, pageSize, keyword, items.length, loading, loadingMore, order])

  /** 新增:写库成功后重新拉取,保证列表与统计一起更新 */
  const add = useCallback(
    async (data) => {
      await db.add(collection, data)
      await reload()
    },
    [collection, reload],
  )

  /** 更新:先本地生效(界面立刻响应),失败再回滚 */
  const update = useCallback(
    async (id, patch) => {
      const before = items
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
      try {
        await db.update(collection, id, patch)
      } catch (e) {
        setItems(before)
        setError(e?.message || '更新失败')
        throw e
      }
    },
    [collection, items],
  )

  /** 便捷:切换布尔字段(默认 done) */
  const toggle = useCallback((id, field = 'done', current) => update(id, { [field]: !current }), [update])

  /** 删除:同样先本地移除,失败回滚 */
  const remove = useCallback(
    async (id) => {
      const before = items
      setItems((prev) => prev.filter((it) => it.id !== id))
      setTotal((t) => Math.max(0, t - 1))
      try {
        await db.remove(collection, id)
        await reload()
      } catch (e) {
        setItems(before)
        setTotal((t) => t + 1)
        setError(e?.message || '删除失败')
        throw e
      }
    },
    [collection, items, reload],
  )

  const hasMore = items.length < total

  return { items, total, loading, loadingMore, error, query, setQuery, reload, loadMore, hasMore, add, update, toggle, remove }
}

/** 集合 + 派生统计:一次拿到列表、总数与若干自定义计数,用于统计卡片 */
export function useCollectionStats(collection, predicates = {}) {
  const { items, total, loading, error, reload } = useCollection(collection, { pageSize: 200 })
  const stats = useMemo(() => {
    const out = {}
    for (const [name, fn] of Object.entries(predicates)) out[name] = items.filter(fn).length
    return out
  }, [items, predicates])
  return { items, total, stats, loading, error, reload }
}

/** 键值:像 useState 一样用,值会自动存到平台(键名建议小写英文,如 'settings') */
export function useKv(key, initialValue = null) {
  const [value, setValue] = useState(initialValue)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const v = await kv.get(key, initialValue)
        if (alive) setValue(v)
      } catch (e) {
        if (alive) setError(e?.message || '加载失败')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
    // initialValue 只作为首次兜底,不参与依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  /** 更新并持久化(先改界面,失败回滚并提示) */
  const update = useCallback(
    async (next) => {
      const before = value
      const resolved = typeof next === 'function' ? next(before) : next
      setValue(resolved)
      try {
        await kv.set(key, resolved)
      } catch (e) {
        setValue(before)
        setError(e?.message || '保存失败')
        throw e
      }
    },
    [key, value],
  )

  return { value, set: update, loading, error }
}

/** 原子计数:访问量、点赞数。incr() 并发安全,页面进入即计数用 autoIncr: true */
export function useCounter(key, { autoIncr = false } = {}) {
  const [value, setValue] = useState(0)
  const [loading, setLoading] = useState(true)
  const counted = useRef(false)

  const refresh = useCallback(async () => {
    try {
      setValue(await counter.get(key))
    } catch {
      /* 计数失败不影响主流程 */
    } finally {
      setLoading(false)
    }
  }, [key])

  useEffect(() => {
    if (autoIncr && !counted.current) {
      counted.current = true
      setLoading(true)
      counter
        .incr(key)
        .then(setValue)
        .catch(() => refresh())
        .finally(() => setLoading(false))
      return
    }
    refresh()
  }, [key, autoIncr, refresh])

  const incr = useCallback(
    async (by = 1) => {
      const v = await counter.incr(key, by)
      setValue(v)
      return v
    },
    [key],
  )

  return { value, loading, incr, refresh }
}

/**
 * 对象上传(图片 / 附件)。
 *   const upload = useUpload()
 *   const key = await upload.put(file)   → 'uploads/xxx.png',用 blob.url(key) 显示
 */
export function useUpload(dir = 'uploads') {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)

  const put = useCallback(
    async (file) => {
      setUploading(true)
      setError('')
      setProgress(10)
      try {
        const key = uploadKey(file, dir)
        await blob.put(key, file, file.type || 'application/octet-stream')
        setProgress(100)
        return key
      } catch (e) {
        setError(e?.message || '上传失败')
        throw e
      } finally {
        setUploading(false)
      }
    },
    [dir],
  )

  return { put, uploading, error, progress, url: blob.url }
}

/** 对象列表(相册 / 附件):删除后自动刷新 */
export function useBlobs(prefix = '', { limit = 100 } = {}) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setError('')
      const res = await blob.list(prefix, { limit })
      setItems(res.items ?? [])
    } catch (e) {
      setError(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [prefix, limit])

  useEffect(() => {
    reload()
  }, [reload])

  const remove = useCallback(
    async (key) => {
      setItems((prev) => prev.filter((it) => it.key !== key))
      try {
        await blob.remove(key)
      } catch (e) {
        setError(e?.message || '删除失败')
        await reload()
      }
    },
    [reload],
  )

  return { items, loading, error, reload, remove, url: blob.url }
}
