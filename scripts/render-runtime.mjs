// Render adapter. Existing Fairwind business code is intentionally unchanged.
// Standby must never import server.js: importing it starts background jobs.
import { createServer } from 'node:http'
import { isAbsolute } from 'node:path'

export function deploymentConfig(env) {
  const state = env.FAIRWIND_DEPLOYMENT_STATE || 'standby'
  if (!['standby', 'live'].includes(state)) throw new Error('Invalid FAIRWIND_DEPLOYMENT_STATE')
  const port = Number(env.PORT || 10000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
  if (state === 'live') {
    if (env.FAIRWIND_CUTOVER_CONFIRMED !== 'true') throw new Error('Cutover confirmation required: stop the old worker before activating this one')
    if (env.FAIRWIND_MODE !== 'hosted') throw new Error('Render requires hosted mode')
    if (!env.FAIRWIND_DATA_DIR || !isAbsolute(env.FAIRWIND_DATA_DIR)) throw new Error('Persistent data directory must be absolute')
    for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'BRAIN_ORIGIN']) {
      if (!env[name]) throw new Error(`Missing ${name}`) // Never print values.
    }
    const origin = new URL(env.BRAIN_ORIGIN)
    if (origin.protocol !== 'https:' || origin.origin !== env.BRAIN_ORIGIN) throw new Error('BRAIN_ORIGIN must be an HTTPS origin without a trailing slash')
  }
  return { state, port }
}

export function standbyServer() {
  return createServer((req, res) => {
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('content-type', 'application/json; charset=utf-8')
    const health = req.method === 'GET' && req.url === '/health'
    res.statusCode = health ? 200 : 503
    if (!health) res.setHeader('retry-after', '60')
    res.end(JSON.stringify({ ok: health, deployment: 'standby', businessReady: false,
      message: 'Migration candidate only. No database connections, model calls, mail or calendar workers are running.' }))
  })
}
