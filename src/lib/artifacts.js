import { t } from '../i18n/index.js'
import { BRAIN, brainFetch, supa } from './backends.js'
export async function artifactRequest(path, owner, extra) {
  const r = await brainFetch(`${BRAIN}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...(owner.pursuitId ? { pursuit_id: owner.pursuitId } : { contact_id: owner.contactId }), ...extra }) })
  const out = await r.json()
  if (!r.ok || out.error) throw new Error(out.error || `HTTP ${r.status}`)
  return out
}

/** Keep the source-message association so dismissed drafts stay dismissed on reload. */
export async function setArtifactDiscarded(id, discarded) {
  if (!supa) throw new Error(t('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）'))
  const { data, error } = await supa.rpc('pa_set_artifact_discarded', { p_id: id, p_discarded: discarded })
  if (error) throw new Error(error.message)
  return data
}
