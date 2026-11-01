import { t } from '../i18n/index.js'
// Fetch bytes explicitly: storage may serve HTML as text/plain without charset.
export function attachmentKind(file) {
  const mime = (file.mime || '').split(';')[0].toLowerCase()
  if (mime === 'text/html' || /\.html?$/i.test(file.filename || '')) return 'html'
  if (mime.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(file.filename || '')) return 'text'
  if (mime === 'application/pdf') return 'pdf'
  if (/^image\/(png|jpeg|gif|webp|avif)$/.test(mime)) return 'image'
  return 'download'
}

export async function loadAttachment(file, { sign, signal, fetcher = fetch, urls = URL }) {
  if (!file.storage_key) throw new Error(t('这份附件没有可读取的文件'))
  const signed = await sign(file.storage_key)
  signal?.throwIfAborted()
  try {
    const response = await fetcher(signed, { signal })
    if (!response.ok) throw new Error(t('附件读取失败（HTTP {status}），请重试', { status: response.status }))
    const bytes = await response.arrayBuffer()
    signal?.throwIfAborted()
    const kind = attachmentKind(file)
    const text = kind === 'html' || kind === 'text' ? new TextDecoder('utf-8').decode(bytes) : undefined
    const url = urls.createObjectURL(new Blob([bytes], { type: file.mime || 'application/octet-stream' }))
    return { kind, text, url, release: () => urls.revokeObjectURL(url) }
  } catch (error) {
    error.downloadUrl = signed
    throw error
  }
}

export function isolatedHtml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html')
  // Disable navigation and active content, in addition to the empty iframe sandbox.
  doc.querySelectorAll('script, iframe, frame, object, embed, base, form, meta[http-equiv], link').forEach(el => el.remove())
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || ['href', 'action', 'formaction', 'target', 'srcdoc', 'ping'].includes(attr.name)) el.removeAttribute(attr.name)
    }
  }
  const csp = doc.createElement('meta')
  csp.httpEquiv = 'Content-Security-Policy'
  csp.content = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'"
  doc.head.prepend(csp)
  return '<!doctype html>' + doc.documentElement.outerHTML
}
