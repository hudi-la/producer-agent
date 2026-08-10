// 把一份文件变成文本。
//
// 这个文件存在的全部意义，是让「三种格式」这件事**只活在这里**。
// Fairwind 那边看到的永远是同一件事：给个文件名，拿回文字。它不知道
// PDF 要解析、Excel 要遍历工作表、MD 直接就是文本——它也不该知道，
// 因为一旦它知道，它就会开始为不同格式说不同的话。
//
// 读不了的格式一律明说读不了，不返回半通不通的乱码。乱码比"读不了"更糟：
// 它会被当成内容，然后被引用进一封真的信里。

import ExcelJS from 'exceljs'

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

async function fromPdf(buf) {
  // 动态 import：unpdf 会把 pdfjs 一起拉起来，几百毫秒。没人开 PDF 的那些
  // 请求不该为它付这个启动成本。
  const { extractText, getDocumentProxy } = await import('unpdf')
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

/**
 * buf（Buffer/ArrayBuffer）→ 文本。读不了就抛，抛的话要说人话——
 * 那句话会原样进到 Fairwind 眼里，它得据此告诉你「这份我读不了」。
 */
export async function toText(buf, filename, mime) {
  const ext = extOf(filename)
  if (isText(ext, mime)) return Buffer.from(buf).toString('utf8')
  if (ext === 'pdf' || mime === 'application/pdf') return fromPdf(buf)
  if (SHEET_EXT.has(ext) || (mime || '').includes('spreadsheetml')) return fromSheet(buf)
  if (ext === 'xls') throw new Error('这是老式 .xls（97-2003）。转存成 .xlsx 再传一次就能读了。')
  if (ext === 'doc' || ext === 'docx') throw new Error('Word 文档现在读不了。导成 PDF 或 .md 再传。')
  if ((mime || '').startsWith('image/')) throw new Error('这是张图，不是文本。图里的字需要 OCR，现在没接。')
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
