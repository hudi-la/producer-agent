import { mkdir, appendFile, stat, rename, unlink, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ERROR_LOG_RELEASE, safeErrorEvent, errorOperation, statusKind } from './errorEvents.js'

// Dedicated, bounded logs; no stdout interception and no request/response bodies.
export function createErrorLog({ dir, maxBytes = 1024 * 1024, rotations = 4, retentionMs = 14 * 86400000, now = Date.now } = {}) {
  let pending = Promise.resolve(), queued = 0, lastCleanup = 0
  const prune = async () => {
    let names
    try { names = await readdir(dir) } catch (e) { if (e.code === 'ENOENT') return; throw e }
    for (const name of names) if (/^errors\.jsonl(?:\.[1-9]\d*)?$/.test(name)) {
      const file = join(dir, name), info = await stat(file)
      if (now() - info.mtimeMs > retentionMs) { await unlink(file); continue }
      // A continuously appended file can contain old entries despite a fresh mtime.
      const content = await readFile(file, 'utf8')
      const lines = content.trim().split('\n').filter((line) => { try { return Date.parse(JSON.parse(line).at) >= now() - retentionMs } catch { return false } })
      if (!lines.length) await unlink(file)
      else if (lines.join('\n') + '\n' !== content) await writeFile(file, lines.join('\n') + '\n', { mode: 0o600 })
    }
    lastCleanup = now()
  }
  return {
    prune() { const run = pending.then(prune).catch(() => false); pending = run; return run },
    async write(event) {
      const safe = safeErrorEvent(event)
      if (!safe || !dir || queued >= 200) return false
      queued++
      const run = pending.then(async () => {
        await mkdir(dir, { recursive: true, mode: 0o700 })
        const path = join(dir, 'errors.jsonl')
        if (!lastCleanup || now() - lastCleanup > 3600000) await prune()
        const line = JSON.stringify({ at: new Date(now()).toISOString(), source: event.source === 'server' ? 'server' : 'client', ...safe }) + '\n'
        const size = await stat(path).then((s) => s.size).catch((e) => { if (e.code === 'ENOENT') return 0; throw e })
        if (size + Buffer.byteLength(line) > maxBytes) {
          await unlink(`${path}.${rotations}`).catch((e) => { if (e.code !== 'ENOENT') throw e })
          for (let i = rotations - 1; i >= 0; i--) await rename(i ? `${path}.${i}` : path, `${path}.${i + 1}`).catch((e) => { if (e.code !== 'ENOENT') throw e })
        }
        await appendFile(path, line, { mode: 0o600 })
        return true
      }).catch(() => false).finally(() => { queued-- })
      pending = run
      return run
    },
  }
}

export function createDiagnosticsHandler({ log, allowOrigin, now = Date.now }) {
  let windowStart = 0, count = 0
  const recent = new Map()
  return async (req, res) => {
    const answer = (code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
    if (req.method !== 'POST') return answer(405, { ok: false })
    if (!allowOrigin(req.headers.origin)) return answer(403, { ok: false })
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return answer(415, { ok: false })
    if (now() - windowStart >= 60000) { windowStart = now(); count = 0 }
    if (++count > 120) return answer(429, { ok: false })
    try {
      req.setTimeout?.(5000, () => req.destroy())
      let bytes = 0, raw = ''
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk)
        if (bytes > 2048) { answer(413, { ok: false }); return }
        raw += chunk
      }
      const safe = safeErrorEvent(JSON.parse(raw))
      if (!safe) return answer(400, { ok: false })
      for (const [id, at] of recent) if (now() - at > 86400000) recent.delete(id)
      if (recent.has(safe.id)) return answer(200, { ok: true, id: safe.id })
      const saved = await log.write({ ...safe, source: 'client' })
      if (!saved) return answer(503, { ok: false })
      if (recent.size >= 5000) recent.delete(recent.keys().next().value)
      recent.set(safe.id, now())
      answer(201, { ok: true, id: safe.id })
    } catch { answer(400, { ok: false }) }
  }
}

export function observeRequest(req, res, log) {
  const id = randomUUID()
  res.setHeader('x-fairwind-request-id', id)
  res.diagnosticRequestId = id
  const record = (status, kind) => log.write({ id, requestId: id, kind: kind || statusKind(status), operation: errorOperation(req.url.split('?')[0]), status, release: ERROR_LOG_RELEASE, source: 'server' })
  res.once('finish', () => { if (res.statusCode >= 400) void record(res.statusCode) })
  // SSE has HTTP 200 even when model execution fails.
  res.recordStreamFailure = () => record(500, 'model')
  return id
}
