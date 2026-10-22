// Public state deliberately excludes provider error text, which may contain credentials.
export function modelFailure(err, now = Date.now()) {
  if (err?.name === 'QuotaError') return err.quota
  const text = String(err?.message || '')
  const auth = err?.status === 401 || /invalid_api_key|incorrect api key|authentication_error|not logged in|unauthorized|回 401|sign in.*first/i.test(text)
  return { kind: auth ? 'auth' : 'modelerror', resetAt: new Date(now + 5 * 60_000).toISOString() }
}
