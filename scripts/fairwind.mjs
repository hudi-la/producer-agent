// 一条命令,整套起来:brain + 页面,浏览器自动开。
//   npm run fairwind
// Ctrl-C 一下,两个一起停。
import { spawn, exec } from 'node:child_process'

const kids = []
function run(name, cmd, args, cwd) {
  const p = spawn(cmd, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  const tag = (line) => line.trim() && console.log(`[${name}] ${line}`)
  p.stdout.on('data', (d) => String(d).split('\n').forEach(tag))
  p.stderr.on('data', (d) => String(d).split('\n').forEach(tag))
  p.on('exit', (code) => {
    console.log(`[${name}] 停了(${code ?? '信号'})`)
    // 一个倒了另一个没必要独活——一起收
    for (const k of kids) if (!k.killed) k.kill()
    process.exit(code ?? 0)
  })
  kids.push(p)
  return p
}

run('brain', 'npm', ['start', '--prefix', 'brain'])
run('web', 'npx', ['vite', '--port', '5173'])

// vite 起来要一两秒;晚一点开浏览器,开早了是白页
setTimeout(() => {
  if (process.platform === 'darwin') exec('open http://localhost:5173')
  else if (process.platform === 'win32') exec('start http://localhost:5173')
  else exec('xdg-open http://localhost:5173')
}, 1800)

process.on('SIGINT', () => { for (const k of kids) k.kill('SIGINT'); process.exit(0) })
