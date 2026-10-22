import { test } from 'node:test'
import assert from 'node:assert/strict'
import { htmlToText, parseDuckDuckGo, toOpenAITool, webFetch, webSearch, builtinTools } from './tools.js'

test('htmlToText:去脚本样式标签、解实体、压空白', () => {
  const t = htmlToText('<html><head><style>x{}</style><script>bad()</script></head><body><h1>Open&nbsp;Call</h1><p>Deadline: <b>Oct&#160;1</b> &amp; more</p><ul><li>a</li><li>b</li></ul></body></html>')
  assert.equal(t, 'Open Call\nDeadline: Oct 1 & more\na\nb')
})

test('parseDuckDuckGo:标题/链接(解 uddg)/摘要', () => {
  const html = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fcall&amp;rut=x">Open <b>Call</b> 2026</a> <a class="result__snippet" href="#">Artists residency, deadline soon</a>'
  assert.deepEqual(parseDuckDuckGo(html), [{ title: 'Open Call 2026', url: 'https://example.org/call', snippet: 'Artists residency, deadline soon' }])
})

test('toOpenAITool:zod shape → function 定义', () => {
  const f = toOpenAITool(webFetch())
  assert.equal(f.type, 'function'); assert.equal(f.function.name, 'WebFetch')
  assert.deepEqual(f.function.parameters.required, ['url']); assert.equal(f.function.parameters.properties.from.type, 'number')
  assert.equal('$schema' in f.function.parameters, false)
})

test('WebFetch:HTML 变文字、超长分段;非 200 说清', async () => {
  const big = '<p>' + 'x'.repeat(30000) + '</p>'
  const fetchImpl = async (url) => url.endsWith('/404') ? { ok: false, status: 404 } : { ok: true, headers: { get: () => 'text/html' }, text: async () => big }
  const r = await webFetch(fetchImpl).handler({ url: 'https://a/b' })
  assert.match(r.content[0].text, /还有 22000 字没给.*from=8000/s)
  const r2 = await webFetch(fetchImpl).handler({ url: 'https://a/404' }); assert.match(r2.content[0].text, /HTTP 404/)
})

test('WebSearch:没结果时说清;builtinTools 按名字挑', async () => {
  const r = await webSearch(async () => ({ ok: true, text: async () => '<html></html>' })).handler({ query: 'q' })
  assert.match(r.content[0].text, /没搜到/)
  assert.deepEqual(builtinTools(['WebSearch', 'ToolSearch', 'WebFetch']).map((t) => t.name), ['WebSearch', 'WebFetch'])
})
