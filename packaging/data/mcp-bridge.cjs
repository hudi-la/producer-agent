// Fairwind 的 MCP 桥:Claude 桌面版只会起一个 stdio 子进程,够不着本机的 http 地址。
// 这个小程序两头接:这头 stdio 对着 Claude 桌面版,那头 http 对着 Fairwind 的 /mcp,把工具原样转过去。
//   <Fairwind>/node <Fairwind>/mcp-bridge.cjs http://localhost:8788/mcp
// 依赖从旁边的 node_modules 找(打包时带着);开发时从 brain/node_modules 找。
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const http = require('node:http')
const argUrl = process.argv[2] || 'http://localhost:8788/mcp'
const FIXED = process.argv.includes('--fixed')   // 写死就是这台,不探——作者自己那份(云端模式)走这个
const here = __dirname

// Fairwind 每次启动的端口不一定一样(8788 被作者自己的 brain 占着就往后挪)。
// 配置里写死的那个只是起点:先读启动器记下的 <数据目录>/port,再从 8788 往后挨个探,
// 只认答 /health 且 mode=local 的那台——云端版/别的 brain 一律跳过,免得写错地方。
const DATA = process.env.FAIRWIND_DATA_DIR || (process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'Fairwind')
  : path.join(process.env.APPDATA || os.homedir(), 'Fairwind'))
const health = (port) => new Promise((ok) => {
  const rq = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 800 }, (res) => {
    let s = ''; res.on('data', (c) => { s += c }); res.on('end', () => { try { ok(JSON.parse(s)) } catch { ok(null) } })
  }); rq.on('error', () => ok(null)); rq.on('timeout', () => { rq.destroy(); ok(null) })
})
async function findUrl() {
  if (FIXED) return argUrl
  const u = new URL(argUrl)
  const ports = []; let fromFile = false
  try { const p = Number(fs.readFileSync(path.join(DATA, 'port'), 'utf8').trim()); if (p) { ports.push(p); fromFile = true } } catch {}
  ports.push(Number(u.port || 80))
  for (let p = 8788; p < 8800; p++) if (p !== 8789) ports.push(p)
  // 端口文件指的那台(最近一次启动的)优先;不然在探到的本机版里挑版本最高的——
  // 旧版本没退干净还占着口的时候(0.1.1 没有 /quit),别接到它上面去
  const found = []
  for (const p of [...new Set(ports)]) {
    const h = await health(p)
    if (h && h.ok && h.mode === 'local') { if (ports[0] === p && fromFile) return `http://127.0.0.1:${p}/mcp`; found.push({ p, v: String(h.version || '0') }) }
  }
  const num = (v) => v.split('.').map((x) => parseInt(x, 10) || 0)
  found.sort((a, b) => { const x = num(a.v), y = num(b.v); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0 })
  if (found.length) return `http://127.0.0.1:${found[0].p}/mcp`
  return argUrl   // 一个都没探到:按配置里的试,错了也报得清楚
}
let url = argUrl
const roots = [path.join(here, 'node_modules'), path.join(here, 'brain', 'node_modules'), path.join(here, '..', 'brain', 'node_modules'), path.join(here, '..', '..', 'brain', 'node_modules')]
const root = roots.find((r) => fs.existsSync(path.join(r, '@modelcontextprotocol', 'sdk')))
if (!root) { process.stderr.write('mcp-bridge:找不到 @modelcontextprotocol/sdk\n'); process.exit(1) }
const req = (p) => require(path.join(root, '@modelcontextprotocol', 'sdk', 'dist', 'cjs', p))

async function main() {
  const { Client } = req('client/index.js')
  const { StreamableHTTPClientTransport } = req('client/streamableHttp.js')
  const { Server } = req('server/index.js')
  const { StdioServerTransport } = req('server/stdio.js')
  const { ListToolsRequestSchema, CallToolRequestSchema } = req('types.js')

  const client = new Client({ name: 'fairwind-bridge', version: '1' })
  const connect = async () => { try { url = await findUrl(); await client.connect(new StreamableHTTPClientTransport(new URL(url))); return true } catch (e) { process.stderr.write(`mcp-bridge:连不上 ${url}(Fairwind 开着吗?)${e.message}\n`); return false } }
  let up = await connect()

  const server = new Server({ name: 'fairwind', version: '1' }, { capabilities: { tools: { listChanged: true } } })
  // Claude 桌面版只在启动时拿一次工具清单。Fairwind 那头的清单会变(开了邮件模块判据工具才出现;
  // Fairwind 重启、换端口):每 20 秒对一次,变了就通知它重新拿——不用退出 Claude 再开(9/25 学员撞到)
  let lastNames = null
  const poll = async () => {
    try {
      if (!up) up = await connect()
      if (!up) return
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name).sort().join(',')
      if (lastNames !== null && names !== lastNames) { try { await server.sendToolListChanged() } catch (_) {} }
      lastNames = names
    } catch (_) { up = false }
  }
  setInterval(poll, 20000).unref()
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (!up) up = await connect()
    if (!up) return { tools: [] }
    try { return await client.listTools() } catch (e) { up = false; return { tools: [] } }
  })
  server.setRequestHandler(CallToolRequestSchema, async (r) => {
    if (!up) up = await connect()
    if (!up) return { content: [{ type: 'text', text: `连不上 Fairwind(${url})。它开着吗?` }], isError: true }
    try { return await client.callTool({ name: r.params.name, arguments: r.params.arguments || {} }) }
    catch (e) { up = false; return { content: [{ type: 'text', text: '没成:' + e.message }], isError: true } }
  })
  await server.connect(new StdioServerTransport())
}
main().catch((e) => { process.stderr.write('mcp-bridge:' + (e.stack || e) + '\n'); process.exit(1) })
