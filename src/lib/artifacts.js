import { BRAIN, brainFetch } from './backends.js'
export async function artifactRequest(path, owner, extra) {
  const r = await brainFetch(`${BRAIN}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...(owner.pursuitId ? { pursuit_id: owner.pursuitId } : { contact_id: owner.contactId }), ...extra }) })
  const out = await r.json()
  if (!r.ok || out.error) throw new Error(out.error || `HTTP ${r.status}`)
  return out
}
