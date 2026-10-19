/**
 * 连接器凭证的加密(AES-GCM + HKDF 派生)。
 *
 * 为什么不用 Worker secret 直接存用户凭证:secret 是**全局**的,装不下 per-user 凭证;而且只写不可读。
 * 所以用户凭证加密后存 D1(`connections.credentials`),主密钥来自 `CONNECTOR_KEK`。
 *
 * 信任模型(必须对用户讲清楚,见 docs/CONNECTORS.md §8):平台拿这把主密钥**能解开**所有用户的连接凭证。
 * 要规避这一点得等 Workers for Platforms(每个应用独立密钥);当前设计选择"不代持资金密钥"来降低风险。
 * 换掉 CONNECTOR_KEK = 所有用户连接需重新授权(解密失败统一按「请重新授权」处理)。
 *
 * 密文格式:`v1.<iv hex>.<cipher hex>`,带版本号,便于以后换算法时不误读旧数据。
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const CIPHER_VERSION = 'v1'
/** HKDF 的 salt/info:固定值,只用来把 KEK 派生成「仅用于凭证」的子密钥 */
const HKDF_SALT = 'forge-connectors-v1'
const HKDF_INFO = 'credentials'

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  if (!hex.length || hex.length % 2) throw new Error('密文格式不合法')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error('密文格式不合法')
    out[i] = byte
  }
  return out
}

async function aesKey(kek: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(kek), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(HKDF_SALT), info: encoder.encode(HKDF_INFO) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** 加密凭证对象 → 可直接存 D1 的文本 */
export async function encryptCredentials(kek: string, value: Record<string, string>): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(kek), encoder.encode(JSON.stringify(value)))
  return `${CIPHER_VERSION}.${toHex(iv)}.${toHex(new Uint8Array(cipher))}`
}

/** 解密凭证;KEK 换过或数据被改都会抛错,由调用方转成「请重新授权」 */
export async function decryptCredentials(kek: string, blob: string): Promise<Record<string, string>> {
  const [version, ivHex, cipherHex] = blob.split('.')
  if (version !== CIPHER_VERSION || !ivHex || !cipherHex) throw new Error('凭证格式不合法')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(ivHex) }, await aesKey(kek), fromHex(cipherHex))
  const parsed: unknown = JSON.parse(decoder.decode(plain))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('凭证内容不合法')
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}
