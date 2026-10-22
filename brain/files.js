// 把一份文件变成 Fairwind 能读的东西。
//
// 这个文件存在的全部意义，是让「哪种格式怎么读」这件事**只活在这里**。
// Fairwind 那边看到的永远是同一件事：给个文件名，拿回能读的东西。它不知道
// PDF 要解析、Excel 要遍历工作表、MD 直接就是文本——它也不该知道，
// 因为一旦它知道，它就会开始为不同格式说不同的话。
//
// 出口有两种，不是一种：
//   { kind: 'text',  text }              —— 文档那一类
//   { kind: 'image', data, mimeType }    —— 图片：原样交给模型，它自己看
//
// 图片这条路以前是不存在的：`toText` 的签名是「拿回一个字符串」，图片没地方放，
// 于是只能抛错，那句错还写着「需要 OCR」。那是句错话——OCR 是把图变成文字，
// 而模型要的根本不是文字，它直接看得见图。
//
// 读不了的格式一律明说读不了，不返回半通不通的乱码。乱码比"读不了"更糟：
// 它会被当成内容，然后被引用进一封真的信里。

import ExcelJS from 'exceljs'
import { extractText, getDocumentProxy } from 'unpdf'

// 一次最多给出去多少字。不是省钱，是省注意力——一份 200 页的 PDF 全量倒进
// 上下文，那条线后面的每一轮都要重付一次，而且它会淹掉真正相关的那几段。
// 超了不截断了事：告诉它总共多长、下一段从哪儿接，它想看完自己接着要。
export const CHUNK = 40000

const extOf = (name) => (name || '').split('.').pop()?.toLowerCase() || ''

// 纯文本那一类。按扩展名认，认不出再看 mime——
// 只看 mime 的话，很多地方上传 .md 会给 application/octet-stream。
const TEXT_EXT = new Set([
  'md', 'markdown', 'txt', 'text', 'csv', 'tsv', 'json', 'yaml', 'yml',
  'html', 'htm', 'xml', 'log', 'rtf', 'srt', 'vtt',
])
const isText = (ext, mime) =>
  TEXT_EXT.has(ext) || (mime || '').startsWith('text/') ||
  mime === 'application/json' || mime === 'application/xml'

const SHEET_EXT = new Set(['xlsx', 'xlsm', 'xltx'])

// 模型看得了的图片格式，只有这四种。别的（heic、svg、tiff、bmp…）不是「读不了」，
// 是格式不对——话得说准，不然他会以为图坏了，其实只要转存一下就能看。
const IMG_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp',
}
const IMG_EXT = new Set(Object.keys(IMG_MIME))

/**
 * 不下载就认得出这份是不是「模型看得了的图」。
 * 清单那边要用：标出哪几份进来是要按图收费的，它才谈得上「按需开」。
 * 看不了的图（heic、svg…）在这儿算 false —— 清单上不该写着"图"勾他去开一个开不了的东西。
 */
export const isImage = (filename, mime) =>
  IMG_EXT.has(extOf(filename)) ||
  Object.values(IMG_MIME).includes((mime || '').toLowerCase())

// 单张图的体积上限。API 那边按 base64 之后的大小算，base64 会把字节撑大三分之一，
// 所以这里卡在原始字节 3.5MB —— 撑完还在它 5MB 的线以内。
// 超了在这儿拦，比让它传上去再被拒收强：那边拒收的话，这一轮就白跑了。
export const IMG_MAX_BYTES = 3.5 * 1024 * 1024

// 一条对话最多进几张图。
//
// 为什么要有这个数：图跟文本的成本形状不一样。一段文本开出来，是这一轮的工具结果，
// 说完就沉进历史；一张图进了上下文，**这条对话后面每一轮都要重付一次**。
// 开三张图聊二十轮，等于付了六十张图。
//
// 所以「按需开」不能只写在提示词里指望它自觉——提示词是劝，这个数是拦。
export const IMG_CAP = 3

/**
 * 一条对话的图片额度。每次开对话现造一个，跟着那条对话活。
 * 挡两件事：同一张图重复进上下文、一口气把整条线的图全拉进来。
 */
export function imageBudget(cap = IMG_CAP) {
  const seen = new Set()
  return {
    admit(filename) {
      if (seen.has(filename)) {
        return { ok: false, why: `《${filename}》这张图上面已经开过了，就在这条对话里，往上翻能看到——再开一次是把同一张图又付一遍钱。` }
      }
      if (seen.size >= cap) {
        return { ok: false, why: `这条对话里已经进了 ${cap} 张图，到顶了。图进来就一直占着上下文，每一轮都重付。真要看这张，开条新对话。` }
      }
      seen.add(filename)
      return { ok: true }
    },
    // 文本不占额度——它开完就沉进历史，不是每轮重付的东西
    text() {},
  }
}

async function fromPdf(buf) {
  // 2026-09-16 改成静态 import:打包成字节码后没有动态 import 的回调(packaging/SPIKE.md 第 2 条)。
  // unpdf 会把 pdfjs 一起拉起来,几百毫秒——现在付在启动时,不付在第一次开 PDF 时。
  const doc = await getDocumentProxy(new Uint8Array(buf))
  const { text, totalPages } = await extractText(doc, { mergePages: true })
  const body = (Array.isArray(text) ? text.join('\n\n') : text || '').trim()
  if (!body) {
    throw new Error('这份 PDF 里抽不出文字——多半是扫描件（整页是图）。它需要 OCR，现在没接。')
  }
  return `〔PDF · ${totalPages} 页〕\n\n${body}`
}

async function fromSheet(buf) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const out = []
  wb.eachSheet((ws) => {
    out.push(`## 工作表：${ws.name}（${ws.rowCount} 行 × ${ws.columnCount} 列）`)
    ws.eachRow({ includeEmpty: false }, (row) => {
      // 取 values 的 1..n —— exceljs 的第 0 位永远是空的
      const cells = (row.values || []).slice(1).map((v) => {
        if (v == null) return ''
        if (v instanceof Date) return v.toISOString().slice(0, 10)
        // 公式格、富文本格、超链接格都是对象，取得出结果就取结果
        if (typeof v === 'object') return String(v.result ?? v.text ?? v.hyperlink ?? '')
        return String(v)
      })
      // 制表符分隔而不是逗号：单元格里本来就常有逗号，用逗号会把一行切错
      out.push(cells.join('\t').trimEnd())
    })
    out.push('')
  })
  const body = out.join('\n').trim()
  if (!body) throw new Error('这个表是空的。')
  return body
}

function asImage(buf, filename, ext) {
  if (buf.length > IMG_MAX_BYTES) {
    const mb = (buf.length / 1024 / 1024).toFixed(1)
    throw new Error(`这张图 ${mb}MB，太大了（上限 ${(IMG_MAX_BYTES / 1024 / 1024).toFixed(1)}MB）。导出成小一点的再传。`)
  }
  return { kind: 'image', data: Buffer.from(buf).toString('base64'), mimeType: IMG_MIME[ext] }
}

/**
 * buf（Buffer/ArrayBuffer）→ Fairwind 能读的东西：
 *   { kind: 'text', text } 或 { kind: 'image', data, mimeType }
 *
 * 读不了就抛，抛的话要说人话——那句话会原样进到 Fairwind 眼里，
 * 它得据此告诉你「这份我读不了」，还有到底卡在哪。
 */
export async function read(buf, filename, mime) {
  const ext = extOf(filename)
  const asText = (t) => ({ kind: 'text', text: t })

  // 图片先认，且**按扩展名优先**：很多地方上传图片给的 mime 是
  // application/octet-stream，只看 mime 的话一张 png 会掉进最后那个「不认识」。
  if (IMG_EXT.has(ext)) return asImage(buf, filename, ext)
  if ((mime || '').startsWith('image/')) {
    // 到这儿说明是张图，但不是那四种。这不是「读不了」，是格式的事——
    // 说清楚能转成什么，比说「不支持」有用。
    throw new Error(`.${ext || '(无扩展名)'} 这种图模型看不了。能看的只有 PNG、JPEG、GIF、WebP —— 转存一下再传。`)
  }

  if (isText(ext, mime)) return asText(Buffer.from(buf).toString('utf8'))
  if (ext === 'pdf' || mime === 'application/pdf') return asText(await fromPdf(buf))
  if (SHEET_EXT.has(ext) || (mime || '').includes('spreadsheetml')) return asText(await fromSheet(buf))
  if (ext === 'xls') throw new Error('这是老式 .xls（97-2003）。转存成 .xlsx 再传一次就能读了。')
  if (ext === 'doc' || ext === 'docx') throw new Error('Word 文档现在读不了。导成 PDF 或 .md 再传。')
  throw new Error(`不认识 .${ext || '(无扩展名)'} 这种格式，读不了。`)
}

/** 取第 from 个字符开始的一段，并说清楚还剩多少。 */
export function slice(text, from = 0) {
  const start = Math.max(0, Math.min(from | 0, text.length))
  const body = text.slice(start, start + CHUNK)
  const end = start + body.length
  const more = end < text.length
  return {
    body,
    note: more
      ? `\n\n〔还没完：这份文件一共 ${text.length} 字，上面是第 ${start}–${end} 字。要接着看，用同一个文件名、from=${end} 再开一次。〕`
      : start > 0
        ? `\n\n〔到这儿是全文的结尾（共 ${text.length} 字）。〕`
        : '',
  }
}
