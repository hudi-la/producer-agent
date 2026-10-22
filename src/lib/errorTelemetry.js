import { describeError, errorText } from './userError.js'
import { ERROR_LOG_RELEASE, ERROR_CODES, errorOperation, safeErrorEvent, UUID } from '../../brain/errorEvents.js'

const STORAGE = 'fairwind-error-log-v1'
export function createErrorReporter({ send, storage, now = Date.now, uuid = () => crypto.randomUUID() }) {
  const recent = new Map()
  let queue = [], running = false
  try { queue = JSON.parse(storage?.getItem(STORAGE) || '[]').filter((e) => safeErrorEvent(e) && Number.isFinite(e.queuedAt) && now() - e.queuedAt < 86400000).slice(-50).map((e) => ({ ...safeErrorEvent(e), queuedAt: e.queuedAt })) } catch {}
  const persist = () => { try { storage?.setItem(STORAGE, JSON.stringify(queue)) } catch {} }
  const flush = async () => {
    if (running) return
    running = true
    try {
      queue = queue.filter((e) => now() - e.queuedAt < 86400000)
      for (const event of queue.slice(0, 5)) {
        try {
          if (!await send(safeErrorEvent(event))) break
          queue = queue.filter((e) => e.id !== event.id)
        } catch { break } // Logging failure never creates another error event.
      }
    } finally { running = false; persist() }
  }
  return {
    flush,
    report(error, context) {
      const kind = describeError(error).kind, operation = errorOperation(context)
      const key = kind + ':' + operation
      const previous = recent.get(key)
      if (previous && now() - previous.at < 60000) return previous.id
      const raw = errorText(error)
      const requestId = error?.requestId || raw.match(/\[request:([0-9a-f-]{36})\]/i)?.[1]
      const status = Number(error?.status || raw.match(/\bHTTP\s+(\d{3})\b/)?.[1])
      const code = ERROR_CODES.find((c) => raw.includes(c))
      const event = { occurredAt: new Date(now()).toISOString(), ...(code ? { code } : {}), id: uuid(), kind, operation, release: ERROR_LOG_RELEASE,
        ...(UUID.test(requestId || '') ? { requestId } : {}), ...(status >= 400 && status <= 599 ? { status } : {}) }
      recent.set(key, { id: event.id, at: now() })
      queue.push({ ...event, queuedAt: now() }); queue = queue.slice(-50); persist()
      void flush()
      return event.id
    },
  }
}

let reporter = null
export function configureErrorLogging(endpoint) {
  if (reporter || typeof window === 'undefined') return
  let storage
  try { storage = window.sessionStorage } catch {}
  reporter = createErrorReporter({ storage, send: async (event) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4000)
    try {
      const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event), credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal })
      return r.ok
    } finally { clearTimeout(timer) }
  } })
  window.addEventListener('online', reporter.flush)
  window.addEventListener('error', (event) => { reporter.report(event.error || event.message || 'Client runtime error', 'other') })
  window.addEventListener('unhandledrejection', (event) => { reporter.report(event.reason || 'Unhandled rejection', 'other') })
  setInterval(() => { if (navigator.onLine) void reporter.flush() }, 60000)
  void reporter.flush()
}
export const logUiError = (error, context) => reporter?.report(error, context) || null
