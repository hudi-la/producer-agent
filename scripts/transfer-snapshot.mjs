// Fallback for interrupted SCP through the Render SSH gateway. Transfer private
// data only over verified SSH; hash each 1 MiB chunk before writing, then verify
// the complete archive. No credentials or filenames inside the archive are logged.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
const [archive, identity, knownHosts, resume = '1'] = process.argv.slice(2)
if (!archive || !identity || !knownHosts) throw new Error('Usage: transfer-snapshot.mjs ARCHIVE IDENTITY KNOWN_HOSTS [FIRST_CHUNK]')
const bytes = readFileSync(archive)
const sha = x => createHash('sha256').update(x).digest('hex')
const expected = sha(bytes)
const remotePath = '/var/data/fairwind/verified-state-' + expected.slice(0, 16) + '.tar.gz'
const remote = `const fs=require('fs'),crypto=require('crypto');require('readline').createInterface({input:process.stdin}).on('line',input=>{const p=JSON.parse(input),b=Buffer.from(p.data,'base64');if(crypto.createHash('sha256').update(b).digest('hex')!==p.sha)throw Error('chunk checksum');const fd=fs.openSync(p.path,fs.existsSync(p.path)?'r+':'wx',0o600);fs.writeSync(fd,b,0,b.length,p.offset);if(p.last)fs.ftruncateSync(fd,p.total);fs.closeSync(fd);if(p.last){const h=crypto.createHash('sha256').update(fs.readFileSync(p.path)).digest('hex');if(h!==p.expected)throw Error('archive checksum');console.log(JSON.stringify({bytes:p.total,sha256:h,verified:true}));}else console.log('OK');})`
const command = 'node -e ' + "'" + remote.replaceAll("'", "'\\''") + "'"
const args = ['-i', identity, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + knownHosts, 'srv-dbcpchavcj2c73fe55dg@ssh.oregon.render.com', command]
const size = 1024 * 1024
const firstChunk = Number(resume)
if (!Number.isSafeInteger(firstChunk) || firstChunk < 1 || firstChunk > Math.ceil(bytes.length / size)) throw new Error('Invalid resume chunk')
// One SSH connection avoids repeated gateway handshakes/rate limits. Wait for
// each acknowledgment before sending the next chunk (bounded backpressure).
const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] })
const lines = createInterface({ input: child.stdout })
child.stderr.on('data', () => {}) // Never dump transport environment or state.
child.stdin.on('error', () => {})
function ack() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('SSH chunk acknowledgment timed out')), 30000)
    const onLine = line => finish(null, line)
    const onExit = () => finish(new Error('SSH transport disconnected'))
    function finish(err, value) { clearTimeout(timer); lines.off('line', onLine); child.off('exit', onExit); err ? reject(err) : resolve(value) }
    lines.once('line', onLine); child.once('exit', onExit)
  })
}
// Resume only after an observed acknowledgment. Final whole-file SHA-256 also
// validates every retained prefix chunk, so a stale partial file cannot pass.
try { for (let offset = (firstChunk - 1) * size; offset < bytes.length; offset += size) {
  const chunk = bytes.subarray(offset, offset + size), last = offset + size >= bytes.length
  const input = JSON.stringify({ path: remotePath, data: chunk.toString('base64'), offset, sha: sha(chunk), total: bytes.length, last, expected })
  const reply = ack(); child.stdin.write(input + '\n'); const result = await reply
  if (!last && result !== 'OK') throw new Error('SSH chunk verification failed')
  console.log(`chunk ${offset / size + 1}/${Math.ceil(bytes.length / size)} verified`)
  if (last) { const proof = JSON.parse(result); if (!proof.verified || proof.sha256 !== expected) throw new Error('Final checksum differs'); console.log(result) }
} } finally { child.stdin.end(); child.kill('SIGTERM'); lines.close() }
