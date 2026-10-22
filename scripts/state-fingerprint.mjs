// Read-only migration evidence: never print tenant IDs, filenames or contents.
// Call on a frozen/extracted snapshot. A live directory is not a consistent
// backup; repeat after draining the source before a production cutover.
import { readdir, lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const root = process.argv[2]
if (!root) throw new Error('Usage: node scripts/state-fingerprint.mjs STATE_ROOT')
const digest = createHash('sha256')
let files = 0, bytes = 0
async function visit(rel) {
  const path = join(root, rel)
  const s = await lstat(path)
  if (s.isSymbolicLink()) throw new Error('State snapshot must not contain symlinks')
  if (s.isDirectory()) {
    for (const name of (await readdir(path)).sort()) await visit(join(rel, name))
  } else if (s.isFile()) {
    const content = await readFile(path)
    const hash = createHash('sha256').update(content).digest('hex')
    digest.update(JSON.stringify([rel, content.length, hash]) + '\n')
    files++; bytes += content.length
  } else throw new Error('State snapshot contains a non-regular file')
}
for (const rel of ['users', 'error-logs']) await visit(rel)
console.log(JSON.stringify({ files, bytes, sha256: digest.digest('hex') }))
