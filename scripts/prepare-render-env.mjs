// Operator-only migration helper. Credentials never enter Git or command output.
// Usage: node scripts/prepare-render-env.mjs /absolute/private/directory
import { execFileSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { writeFileSync, statSync } from 'node:fs'
import { resolve, relative, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = process.argv[2]
const root = fileURLToPath(new URL('../', import.meta.url))
if (!dir || !isAbsolute(dir) || !relative(root, resolve(dir)).startsWith('..')) throw new Error('Use a private absolute directory outside the repository')
if ((statSync(dir).mode & 0o077) !== 0) throw new Error('Directory must have mode 700')
const readRemote = path => parseEnv(execFileSync('ssh', ['-i', '/Users/mgao/.config/enterprise-ai-week06/digitalocean-erp-ed25519', '-o', 'BatchMode=yes', 'root@64.23.225.65', `cat ${path}`], {encoding:'utf8'}))
const backend = readRemote('/etc/fairwind/env')
const frontend = readRemote('/home/fairwind/producer-agent/.env.production')
const out = {
  NODE_VERSION: '24.9.0', NODE_ENV: 'production', VITE_HOSTED: '1',
  FAIRWIND_DEPLOYMENT_STATE: 'standby', FAIRWIND_CUTOVER_CONFIRMED: 'false',
  FAIRWIND_MODE: 'hosted', FAIRWIND_DATA_DIR: '/var/data/fairwind',
  BRAIN_ORIGIN: 'https://fairwind.hudiworks.com',
}
for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET']) {
  if (!backend[key]) throw new Error(`Missing ${key}`)
  out[key] = backend[key]
}
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
  if (!frontend[key]) throw new Error(`Missing ${key}`)
  out[key] = frontend[key]
}
// Public frontend key must not accidentally be the privileged server key.
if (out.VITE_SUPABASE_ANON_KEY === out.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Privileged key cannot enter frontend')
const path = join(dir, 'render.env')
writeFileSync(path, Object.entries(out).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join('\n')+'\n', {mode:0o600,flag:'wx'})
console.log(`Prepared ${Object.keys(out).length} variables in a private import file; values omitted.`)
