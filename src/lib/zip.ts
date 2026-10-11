/**
 * 极简 ZIP 打包(仅存储、不压缩):把某版本的源码树打成 .zip 供用户下载交付。
 * 只依赖运行时,无第三方库;文件量与体量小(源码树),够用即可。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface Entry {
  name: Uint8Array
  data: Uint8Array
  crc: number
  offset: number
}

/** 把 { 路径: 内容 } 打包为 zip 字节流(仅存储,UTF-8 文件名) */
export function createZip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const entries: Entry[] = []
  let offset = 0
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes)
    offset += bytes.length
  }

  for (const [path, content] of Object.entries(files)) {
    const name = enc.encode(path)
    const data = enc.encode(content)
    const crc = crc32(data)
    const header = new Uint8Array(30 + name.length)
    const dv = new DataView(header.buffer)
    dv.setUint32(0, 0x04034b50, true) // 本地文件头签名
    dv.setUint16(4, 20, true) // 解压所需版本
    dv.setUint16(6, 0x0800, true) // 通用标志:文件名 UTF-8
    dv.setUint16(8, 0, true) // 压缩方法:0=存储
    dv.setUint16(10, 0, true) // 修改时间
    dv.setUint16(12, 0, true) // 修改日期
    dv.setUint32(14, crc, true)
    dv.setUint32(18, data.length, true) // 压缩后大小
    dv.setUint32(22, data.length, true) // 原始大小
    dv.setUint16(26, name.length, true)
    dv.setUint16(28, 0, true) // 扩展字段长度
    header.set(name, 30)
    entries.push({ name, data, crc, offset })
    push(header)
    push(data)
  }

  const cdStart = offset
  for (const e of entries) {
    const cd = new Uint8Array(46 + e.name.length)
    const dv = new DataView(cd.buffer)
    dv.setUint32(0, 0x02014b50, true) // 中央目录头签名
    dv.setUint16(4, 20, true) // 创建版本
    dv.setUint16(6, 20, true) // 解压所需版本
    dv.setUint16(8, 0x0800, true)
    dv.setUint16(10, 0, true)
    dv.setUint16(12, 0, true)
    dv.setUint16(14, 0, true)
    dv.setUint32(16, e.crc, true)
    dv.setUint32(20, e.data.length, true)
    dv.setUint32(24, e.data.length, true)
    dv.setUint16(28, e.name.length, true)
    dv.setUint16(30, 0, true) // 扩展字段
    dv.setUint16(32, 0, true) // 注释
    dv.setUint16(34, 0, true) // 起始磁盘
    dv.setUint16(36, 0, true) // 内部属性
    dv.setUint32(38, 0, true) // 外部属性
    dv.setUint32(42, e.offset, true) // 本地头偏移
    cd.set(e.name, 46)
    push(cd)
  }
  const cdSize = offset - cdStart

  const eocd = new Uint8Array(22)
  const dv = new DataView(eocd.buffer)
  dv.setUint32(0, 0x06054b50, true) // 中央目录结束记录
  dv.setUint16(4, 0, true)
  dv.setUint16(6, 0, true)
  dv.setUint16(8, entries.length, true)
  dv.setUint16(10, entries.length, true)
  dv.setUint32(12, cdSize, true)
  dv.setUint32(16, cdStart, true)
  dv.setUint16(20, 0, true)
  push(eocd)

  const out = new Uint8Array(offset)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}