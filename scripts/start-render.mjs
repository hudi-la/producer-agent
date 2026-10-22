// Separate deployment entry, so local/DO start commands retain their behavior.
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deploymentConfig, standbyServer } from './render-runtime.mjs'

try {
  const config = deploymentConfig(process.env)
  if (config.state === 'standby') {
    const server = standbyServer()
    server.listen(config.port, '0.0.0.0', () => console.log('Fairwind migration standby; business workers disabled'))
    process.on('SIGTERM', () => server.close(() => process.exit(0)))
  } else {
    const data = resolve(process.env.FAIRWIND_DATA_DIR)
    await access(data, constants.R_OK | constants.W_OK)
    if (process.env.RENDER === 'true') {
      const mounts = await readFile('/proc/self/mountinfo', 'utf8')
      if (!mounts.split('\n').some(line => line.split(' ')[4] === data)) {
        throw new Error('FAIRWIND_DATA_DIR must be the persistent disk mount, not ephemeral storage')
      }
    }
    process.env.BRAIN_PORT = String(config.port)
    process.env.BRAIN_HOST = '0.0.0.0'
    process.chdir(fileURLToPath(new URL('../brain/', import.meta.url)))
    await import('../brain/server.js')
  }
} catch (error) {
  console.error('Fairwind startup refused:', error.message)
  process.exitCode = 1
}
