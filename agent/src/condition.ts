/**
 * 极简条件表达式求值器(见 docs/FORGE2.md §17.14 的 `if` 语法):
 *   `a == b` / `a != b`(等值,右值可带引号)、`a contains b`(子串)、裸变量(非空即真)。
 *
 * 左值按 vars 解析,支持两种写法:
 *   - `{{ answer }}`(后台/文档示例的推荐写法)
 *   - 裸变量名 `answer` / `answerChoice` / `steps.<id>.outputs.<field>`
 * 无法解析的左值视为 true(不跳过该节点,避免脏配置默默吞掉一个节点)。
 */

/** 解析左值变量名:`{{ answer }}` → answer;裸 `steps.x.outputs.y` → 原样 */
function varNameOf(token: string): string {
  const t = token.trim()
  const m = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(t)
  return m ? m[1] : t
}

export function evalCondition(expr: string, vars: Record<string, string>): boolean {
  const s = expr.trim()
  if (!s) return true
  const unquote = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, '$2')
  const resolve = (token: string): string | undefined => {
    const name = varNameOf(token)
    // 用 hasOwnProperty 区分「变量不存在」与「存在但为空串」:前者 → true(不跳过),后者才参与比较
    return Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : undefined
  }

  const eq = s.indexOf('==')
  if (eq >= 0) {
    const left = resolve(s.slice(0, eq))
    return left === undefined ? true : left === unquote(s.slice(eq + 2))
  }
  const ne = s.indexOf('!=')
  if (ne >= 0) {
    const left = resolve(s.slice(0, ne))
    return left === undefined ? true : left !== unquote(s.slice(ne + 2))
  }
  const ct = s.indexOf(' contains ')
  if (ct >= 0) {
    const left = resolve(s.slice(0, ct))
    return left === undefined ? true : left.includes(unquote(s.slice(ct + 10)))
  }
  const left = resolve(s)
  return left === undefined ? true : left !== ''
}
