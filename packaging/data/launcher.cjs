// Fairwind 启动器。数据在用户目录,程序在这个文件夹;这个文件夹更新时整个换。
//
// 双击的三种情况:
//   · 已经在跑(端口上答 /health 且是本机模式)→ 只把页面开出来,退出
//   · 端口被别的东西占着(比如作者自己的 brain 在 8788)→ 往后找一个空的口
//   · 没在跑 → 起 brain,起来后开页面
// 日志写在 <数据目录>/fairwind.log,出了事有地方看。
const path = require('node:path'), os = require('node:os'), fs = require('node:fs'), http = require('node:http'), net = require('node:net')
const APP = __dirname
const MY_VERSION = (() => { try { return fs.readFileSync(path.join(APP, 'VERSION'), 'utf8').trim() } catch { return '' } })()
const DATA = process.env.FAIRWIND_DATA_DIR || (process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'Fairwind')
  : process.platform === 'win32' ? path.join(process.env.APPDATA || os.homedir(), 'Fairwind') : path.join(os.homedir(), '.fairwind'))
fs.mkdirSync(DATA, { recursive: true })
const LOG = fs.createWriteStream(path.join(DATA, 'fairwind.log'), { flags: 'a' })
const say = (s) => { const line = new Date().toISOString().slice(11, 19) + ' ' + s; LOG.write(line + '\n'); try { process.stdout.write(line + '\n') } catch (_) {} }
const openBrowser = (url) => {
  if (process.env.FAIRWIND_NO_OPEN) return
  const { spawn } = require('node:child_process')
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try { spawn(opener, args, { stdio: 'ignore', detached: true }).unref() } catch (_) {}
}
const health = (port) => new Promise((ok) => {
  const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 800 }, (res) => {
    let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => { try { ok(JSON.parse(s)) } catch { ok(null) } })
  }); req.on('error', () => ok(null)); req.on('timeout', () => { req.destroy(); ok(null) })
})
// 探空口:跟 brain 一样不指定地址——作者自己的 brain 听在 *:8788,只探 127.0.0.1 会误判成空的(2026-09-24 撞过)
const free = (port) => new Promise((ok) => { const s = net.createServer(); s.once('error', () => ok(false)); s.listen(port, () => s.close(() => ok(true))) })

process.on('uncaughtException', (e) => { say('✗ ' + (e && e.stack || e)); process.exit(1) })

async function main() {
  const want = Number(process.env.BRAIN_PORT || 8788)
  let chosen = null
  // 8789 留给 Gmail 授权的本机回调口(brain/mail/auth.js),别拿它当 brain 的口
  // 第一遍:整段口上凡是别的版本的本机 Fairwind,都请它退——旧版本可能在更靠后的口上(8788 被别的 brain 占过的话)
  for (let port = want; port < want + 12; port++) {
    if (port === 8789) continue
    const h = await health(port)
    if (h && h.mode === 'local' && MY_VERSION && h.version && h.version !== MY_VERSION) {
      say('请 ' + port + ' 上的旧版 ' + h.version + ' 退出')
      await new Promise((ok) => { const rq = http.request({ host: '127.0.0.1', port, path: '/quit', method: 'POST', timeout: 2000 }, (rs) => { rs.resume(); rs.on('end', ok) }); rq.on('error', ok); rq.on('timeout', () => { rq.destroy(); ok() }); rq.end() })
    }
  }
  await new Promise((r) => setTimeout(r, 600))
  for (let port = want; port < want + 12; port++) {
    if (port === 8789) continue
    const h = await health(port)
    if (h && h.mode === 'local' && h.version) {
      if (!MY_VERSION || h.version === MY_VERSION) { say('已经在跑(' + port + ', ' + h.version + '),只开页面'); openBrowser('http://localhost:' + port); return process.exit(0) }
      // 更新过了,跑着的还是旧版:叫它退场,等口空出来,再往下起新的
      say('跑着的是 ' + h.version + ',这儿是 ' + MY_VERSION + ':叫旧的退场')
      await new Promise((ok) => { const rq = http.request({ host: '127.0.0.1', port, path: '/quit', method: 'POST', timeout: 2000 }, (rs) => { rs.resume(); rs.on('end', ok) }); rq.on('error', ok); rq.on('timeout', () => { rq.destroy(); ok() }); rq.end() })
      for (let i = 0; i < 20 && !(await free(port)); i++) await new Promise((r) => setTimeout(r, 250))
      if (await free(port)) { chosen = port; break }
      say(port + ' 旧的没让出来,换下一个'); continue
    }
    if (h) { say(port + ' 上是别的 Fairwind/brain(' + (h.mode || '?') + '),换下一个'); continue }
    if (await free(port)) { chosen = port; break }
    say(port + ' 被别的程序占着,换下一个')
  }
  if (!chosen) { say('✗ ' + want + ' 起的十个端口都被占了'); return process.exit(1) }
  process.env.BRAIN_PORT = String(chosen)
  process.env.FAIRWIND_DATA_DIR = DATA
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(path.join(DATA, 'port'), String(chosen)) } catch (e) { say('端口没记下来:' + e.message) }   // 桥(mcp-bridge)靠这个找到今天的端口
  process.env.FAIRWIND_DIST_DIR = path.join(APP, 'dist')
  process.env.FAIRWIND_APP_ROOT = process.env.FAIRWIND_APP_ROOT || path.dirname(APP)
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k]   // 这个包只走本机库
  // brain 的 console 也进日志
  const orig = { log: console.log, error: console.error, warn: console.warn }
  for (const k of Object.keys(orig)) console[k] = (...a) => { LOG.write(a.map(String).join(' ') + '\n'); orig[k](...a) }
  say('起 brain,端口 ' + chosen)
  require('bytenode')
  require(path.join(APP, 'brain.jsc'))
  // 起来了再开页面:等 /health 答话,最多 20 秒
  const url = 'http://localhost:' + chosen
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 500)); if (await health(chosen)) { openBrowser(url); return } }
  say('20 秒了 brain 还没答话,看上面的日志')
}
main().catch((e) => { say('✗ ' + (e && e.stack || e)); process.exit(1) })
