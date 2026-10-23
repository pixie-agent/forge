/**
 * 「克隆同款」跨登录流程的待办项。
 *
 * 未登录用户点克隆会先被送到登录页(`/login?clone=<id>`),但登录可能发生在
 * 另一个页面之后:Google 回调直接回 `/projects`,注册又要等邮件验证再回 `/projects`。
 * URL 上的 clone 参数在这些链路里活不下来,于是把它暂存在 sessionStorage,
 * 由 App 里的 CloneResumer 在拿到会话后统一续跑(见 App.tsx)。
 *
 * 只存 sessionStorage:关掉标签页就放弃,避免下次登录时莫名多出一个克隆项目。
 */
const KEY = 'forge.pendingClone'

/** 精选案例 id 是 UUID;别的值一律不认,避免把任意路径拼进接口 */
const ID_RE = /^[0-9a-fA-F-]{8,64}$/

export function savePendingClone(id: string) {
  if (ID_RE.test(id)) sessionStorage.setItem(KEY, id)
}

/** 取出并删除(只消费一次);无待办或读不到时返回 null */
export function takePendingClone(): string | null {
  try {
    const id = sessionStorage.getItem(KEY)
    if (!id) return null
    sessionStorage.removeItem(KEY)
    return ID_RE.test(id) ? id : null
  } catch {
    return null
  }
}

export function clearPendingClone() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // 隐私模式下 sessionStorage 不可用:待办本来也存不进去,无需处理
  }
}
