// brain/engine/tools.js —— 工具只定义一次,两种引擎各自取用。
//
// Claude 那条路:工具是 Agent SDK 的 MCP server(createSdkMcpServer + tool());
// GPT / Gemini 那条路:工具是 OpenAI 格式的 function(JSON schema),由我们自己的循环调 handler。
// 所以工具在这儿写成一个普通对象 { name, description, shape(zod), handler },两边各做一层转换。
// handler 的返回形状沿用 MCP 的 { content: [{type:'text',text} | {type:'image',data,mimeType}] }。
import { z } from 'zod'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'

export const defineTool = (spec) => spec

/** 给 Claude:一组工具 → 一个 SDK MCP server。specs 挂在返回对象上,别的引擎从这儿拿回去。 */
export function toSdkServer(name, specs) {
  const server = createSdkMcpServer({ name, tools: specs.map((s) => tool(s.name, s.description, s.shape, s.handler)) })
  server.__specs = specs.map((s) => ({ ...s, fullName: `mcp__${name}__${s.name}` }))
  return server
}

/** 给 OpenAI 兼容接口:一个工具 → function 定义。 */
export function toOpenAITool(spec) {
  const schema = z.toJSONSchema(z.object(spec.shape))
  delete schema.$schema
  return { type: 'function', function: { name: spec.name, description: spec.description, parameters: schema } }
}

// ── 内建两样:联网查、抓网页。Claude 那条路是 SDK 自带的 WebSearch / WebFetch;这儿是给别的引擎的平替 ──

// 一页先给这么多字,再长按 from 接着要。开放征集页的要点(截止、资格、交什么)几乎都在前面;
// 原来 24_000,找机会一轮读二三十页、每轮又把读过的全带着,Gemini 免费档 / ChatGPT Plus 跑一次就超额(10/1)
const CAP = 8_000

/** 网页 → 纯文字(去 script/style、标签、实体;压空白)。不追求完美,追求不塞垃圾。 */
export function htmlToText(html) {
  let s = String(html || '')
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|br|section|article|header|footer)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<[^>]+>/g, ' ')
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  return s.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export const webFetch = (fetchImpl = (...a) => globalThis.fetch(...a)) => defineTool({
  name: 'WebFetch',
  description: '打开一个网址,拿回页面正文(纯文字)。太长会分段给,按提示用 from 接着要下一段。读过的页面过几轮会被收起、只剩开头,所以读完立刻把要点(名称、机构、截止、链接、现在开不开放)写进你的回复里,别指望回头再看。',
  shape: { url: z.string().describe('完整网址,http(s) 开头'), from: z.number().optional().describe('从第几个字接着看。第一次不用传') },
  handler: async ({ url, from = 0 }) => {
    try {
      const r = await fetchImpl(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; Fairwind/0.1)', accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' }, signal: AbortSignal.timeout(20_000) })
      if (!r.ok) return { content: [{ type: 'text', text: `打不开(HTTP ${r.status}):${url}` }] }
      const ct = r.headers.get('content-type') || ''
      const raw = await r.text()
      const text = /html|xml/i.test(ct) || /^\s*</.test(raw) ? htmlToText(raw) : raw
      const body = text.slice(from, from + CAP)
      const note = text.length > from + CAP ? `\n\n(还有 ${text.length - from - CAP} 字没给。要看后面的,再调一次,from=${from + CAP})` : ''
      return { content: [{ type: 'text', text: `# ${url}\n\n${body}${note}` }] }
    } catch (e) { return { content: [{ type: 'text', text: `打不开:${url}(${e.message})` }] } }
  },
})

/** DuckDuckGo 的 HTML 版结果页,不要 key。解析标题 / 链接 / 摘要。 */
export function parseDuckDuckGo(html) {
  const out = []
  // 按每条结果的 result__a 切段:一段里先是标题链接,后面(下一段之前)可能有 result__snippet
  // 注意 split 在位置 0 的零宽匹配不产生空段,所以不能 slice(1),按内容过滤
  const parts = String(html || '').split(/(?=<a[^>]+class="result__a")/).filter((p) => /class="result__a"/.test(p))
  for (const seg of parts) {
    const a = seg.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!a) continue
    let url = a[1]
    const u = url.match(/[?&]uddg=([^&]+)/); if (u) url = decodeURIComponent(u[1])
    const sn = seg.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i)
    out.push({ title: htmlToText(a[2]), url, snippet: htmlToText(sn ? sn[1] : '') })
    if (out.length >= 10) break
  }
  return out
}

export const webSearch = (fetchImpl = (...a) => globalThis.fetch(...a)) => defineTool({
  name: 'WebSearch',
  description: '联网搜索,拿回前几条结果的标题、网址、摘要。要看正文再用 WebFetch 打开那个网址。',
  shape: { query: z.string().describe('搜索词') },
  handler: async ({ query }) => {
    try {
      const r = await fetchImpl('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Fairwind/0.1)' }, signal: AbortSignal.timeout(20_000) })
      if (!r.ok) return { content: [{ type: 'text', text: `搜索没成(HTTP ${r.status})` }] }
      const rows = parseDuckDuckGo(await r.text())
      if (!rows.length) return { content: [{ type: 'text', text: `「${query}」没搜到什么。换个说法再试,或者直接 WebFetch 你知道的网址。` }] }
      return { content: [{ type: 'text', text: rows.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`).join('\n\n') }] }
    } catch (e) { return { content: [{ type: 'text', text: `搜索没成:${e.message}` }] } }
  },
})

/** 按名字挑内建工具(Claude 那条路的 allowedTools 名字直接复用)。 */
export function builtinTools(names, fetchImpl) {
  const all = { WebSearch: webSearch(fetchImpl), WebFetch: webFetch(fetchImpl) }
  return names.map((n) => all[n]).filter(Boolean)
}
