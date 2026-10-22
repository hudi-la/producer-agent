// Operator-only migration probe. Never expose a second live worker against the
// production database. This mode requires loopback + an explicit approved owner,
// does not serve the browser app (which can write directly to Supabase), and
// allows only audited read routes. Normal tenant authentication still applies.
export function acceptanceConfig(env = process.env) {
  if (env.FAIRWIND_ACCEPTANCE_READONLY !== 'true') return { enabled: false }
  if (env.FAIRWIND_MODE !== 'hosted' || !['127.0.0.1', '::1'].includes(env.BRAIN_HOST)) {
    throw new Error('Acceptance probes require hosted mode on loopback only')
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.FAIRWIND_ACCEPTANCE_OWNER || '')) {
    throw new Error('Acceptance probes require an explicitly approved owner UUID')
  }
  return { enabled: true, owner: env.FAIRWIND_ACCEPTANCE_OWNER }
}
const reads = new Set(['/health', '/me', '/settings', '/modules', '/calendar/status', '/judgments/files'])
export function acceptanceRequestAllowed(method, url) {
  return method === 'GET' && reads.has(new URL(url, 'http://localhost').pathname)
}
