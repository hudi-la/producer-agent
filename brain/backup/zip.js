// brain/backup/zip.js —— 一个够用的 ZIP 读写器,不带依赖。
//
// 备份包是给学员**自己拿着走**的东西(设计稿 2026-10-02 D16):公司撤了,他拿着这个文件装本机版点「恢复」。
// 所以格式必须是他的电脑双击就能打开看一眼的——zip,不是 tar.gz,也不是我们自造的什么。
// 为什么自己写而不装一个包:packaging/ 把 brain 编成字节码随包走,每多一个依赖就多一处要对拍的地方;
// 写 zip 只要 local header / central directory / EOCD 三段,读 zip 从末尾找 EOCD 往回走,一百来行的事。
//
// 写:ZipWriter 一条一条 add(),每条当场给出该写出去的字节(http 响应边下边写,不用整包攒在内存);
//     finish() 给中央目录 + 结尾。JSON 用 deflate,附件原样存(多半已经是压过的图和 pdf)。
// 读:readZip(buffer) → [{ name, data }]。只认 store / deflate 两种方法,别的报错——我们写的只有这两种。
import { deflateRawSync, inflateRawSync } from 'node:zlib'

// ── CRC-32(zip 用的那种,多项式 0xEDB88320)──
const TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TABLE[i] = c >>> 0 }
export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// zip 里的时间是 DOS 格式:两字节日期、两字节时间,精度 2 秒,1980 年起
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

const SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_EOCD = 0x06054b50
const FLAG_UTF8 = 0x0800            // 文件名按 UTF-8 存(盒子里的文件名常有中文)
const STORE = 0, DEFLATE = 8

export class ZipWriter {
  constructor({ now = () => new Date() } = {}) { this.entries = []; this.offset = 0; this.now = now }

  /**
   * 加一条。返回这一条该写出去的字节(local header + 数据)。
   * @param {string} name   包内路径,'/' 分隔
   * @param {Buffer|string} data
   * @param {{deflate?: boolean}} [opts]  deflate=true 压一下(JSON);附件默认原样存
   */
  add(name, data, { deflate = false } = {}) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')
    const nameBuf = Buffer.from(name, 'utf8')
    const body = deflate ? deflateRawSync(raw) : raw
    const method = deflate ? DEFLATE : STORE
    const crc = crc32(raw)
    const { time, date } = dosTime(this.now())
    const head = Buffer.alloc(30)
    head.writeUInt32LE(SIG_LOCAL, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(FLAG_UTF8, 6); head.writeUInt16LE(method, 8)
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(body.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(nameBuf.length, 26); head.writeUInt16LE(0, 28)
    this.entries.push({ nameBuf, method, time, date, crc, csize: body.length, usize: raw.length, offset: this.offset })
    const out = Buffer.concat([head, nameBuf, body])
    this.offset += out.length
    return out
  }

  /** 中央目录 + EOCD。调完这个包就完整了。 */
  finish() {
    const parts = []
    for (const e of this.entries) {
      const h = Buffer.alloc(46)
      h.writeUInt32LE(SIG_CENTRAL, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(FLAG_UTF8, 8); h.writeUInt16LE(e.method, 10)
      h.writeUInt16LE(e.time, 12); h.writeUInt16LE(e.date, 14); h.writeUInt32LE(e.crc, 16); h.writeUInt32LE(e.csize, 20); h.writeUInt32LE(e.usize, 24)
      h.writeUInt16LE(e.nameBuf.length, 28); h.writeUInt16LE(0, 30); h.writeUInt16LE(0, 32); h.writeUInt16LE(0, 34); h.writeUInt16LE(0, 36); h.writeUInt32LE(0, 38); h.writeUInt32LE(e.offset, 42)
      parts.push(h, e.nameBuf)
    }
    const cd = Buffer.concat(parts)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(SIG_EOCD, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(this.entries.length, 8); end.writeUInt16LE(this.entries.length, 10)
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(this.offset, 16); end.writeUInt16LE(0, 20)
    return Buffer.concat([cd, end])
  }
}

/** 一步到位:整包攒成一个 Buffer(测试和小包用;响应流用 ZipWriter 边写边出)。 */
export function zipAll(entries, opts) {
  const w = new ZipWriter(opts)
  const parts = entries.map((e) => w.add(e.name, e.data, { deflate: Boolean(e.deflate) }))
  return Buffer.concat([...parts, w.finish()])
}

/**
 * 读一个 zip:从末尾找 EOCD,按中央目录走。返回 [{ name, data }]。
 * 只认 store / deflate;别的方法、CRC 对不上都报错——备份包坏了就该当场说,不该导进半截。
 */
export function readZip(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) { if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break } }
  if (eocd < 0) throw new Error('不是 zip 文件(找不到结尾记录)')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = []
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('zip 中央目录坏了')
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24)
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8')
    p += 46 + nlen + xlen + clen
    if (buf.readUInt32LE(off) !== SIG_LOCAL) throw new Error(`zip 里 ${name} 的本地头坏了`)
    const dataStart = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28)   // 本地头的名字/扩展长度可能跟中央目录不同,以本地为准
    const body = buf.subarray(dataStart, dataStart + csize)
    let data
    if (method === STORE) data = Buffer.from(body)
    else if (method === DEFLATE) data = inflateRawSync(body)
    else throw new Error(`zip 里 ${name} 用了不认识的压缩方法 ${method}`)
    if (data.length !== usize || crc32(data) !== crc) throw new Error(`zip 里 ${name} 校验不过(文件坏了?)`)
    if (!name.endsWith('/')) out.push({ name, data })
  }
  return out
}
