/** 极简 className 拼接:只接受字符串,假值(null/undefined/false/'')自动跳过 */
export function cx(...parts) {
  return parts.filter((p) => typeof p === 'string' && p.length > 0).join(' ')
}
