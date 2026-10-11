/**
 * 列表数据的统一状态管理:让「新增 / 完成 / 删除」与列表、统计**始终联动**。
 *
 * 用法(强烈建议任何"列表 + 统计"型应用都这样写):
 *   import { useCollection } from './lib/store.js'
 *   const { items, loading, error, add, toggle, remove } = useCollection('todos')
 *   // 列表:items.map(t => ...)    长度:items.length
 *   // 统计:items.filter(t => !t.done).length   ← 一律从 items 派生,不要再建一份计数 state
 *
 * 关键约定:列表渲染与所有统计数字都从同一个 items 派生。不要把数量单独存在别的 useState 里,
 * 否则新增/删除后数字会和列表对不上(这是最常见的 bug)。
 */
import { useCallback, useEffect, useState } from 'react'
import { db } from './forge.js'

/** 把服务端 {id,data,created_at} 摊平成 {id,created_at,...data},用起来更顺手 */
function flatten(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({ ...(r.data ?? {}), id: r.id, created_at: r.created_at }))
}

export function useCollection(collection, options = {}) {
  const { sort } = options
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      setError('')
      const res = await db.list(collection)
      const list = flatten(res.items)
      setItems(sort ? [...list].sort(sort) : list)
      return list
    } catch (e) {
      setError(e?.message || '加载失败')
      return []
    } finally {
      setLoading(false)
    }
  }, [collection]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    reload()
  }, [reload])

  /** 新增:写库成功后重新拉取,保证列表与统计一起更新 */
  const add = useCallback(
    async (data) => {
      await db.add(collection, data)
      await reload()
    },
    [collection, reload],
  )

  /** 更新:如把某条标记完成 toggle({ done: !t.done }) */
  const update = useCallback(
    async (id, patch) => {
      await db.update(collection, id, patch)
      await reload()
    },
    [collection, reload],
  )

  /** 便捷:切换布尔字段(默认 done) */
  const toggle = useCallback(
    async (id, field = 'done', current) => update(id, { [field]: !current }),
    [update],
  )

  const remove = useCallback(
    async (id) => {
      await db.remove(collection, id)
      await reload()
    },
    [collection, reload],
  )

  return { items, loading, error, reload, add, update, toggle, remove }
}