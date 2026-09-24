// Fairwind 的 MCP 桥:Claude 桌面版只会起一个 stdio 子进程,够不着本机的 http 地址。
// 这个小程序两头接:这头 stdio 对着 Claude 桌面版,那头 http 对着 Fairwind 的 /mcp,把工具原样转过去。
//   <Fairwind>/node <Fairwind>/mcp-bridge.cjs http://localhost:8788/mcp
// 依赖从旁边的 node_modules 找(打包时带着);开发时从 brain/node_modules 找。
const path = require('node:path')
const fs = require('node:fs')
const url = process.argv[2] || 'http://localhost:8788/mcp'
const here = __dirname
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
  const connect = async () => { try { await client.connect(new StreamableHTTPClientTransport(new URL(url))); return true } catch (e) { process.stderr.write(`mcp-bridge:连不上 ${url}(Fairwind 开着吗?)${e.message}\n`); return false } }
  let up = await connect()

  const server = new Server({ name: 'fairwind', version: '1' }, { capabilities: { tools: {} } })
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
