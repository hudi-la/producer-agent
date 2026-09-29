// brain/engine/openaiCompat.js —— GPT / Gemini 那条路:OpenAI 兼容的 chat/completions + 我们自己的工具循环。
//
// Claude 那条路的循环是 Agent SDK 包好的(起 Claude Code 子进程);这儿是同一件事的手写版:
//   发消息 → 流式收字(边收边报给界面)→ 有 tool_calls 就跑 handler、把结果塞回去再问 → 直到它不再要工具或到 maxTurns。
// 产出跟 SDK 那条路同形状:blocks(text / tool_use 按发生顺序)、usage——server.js 的 foldReply 原样能用。
// 图片工具结果:OpenAI 格式的 tool 消息只能是文字,所以图另起一条 user 消息用 image_url(data:)带进去,两家都认。
import { toOpenAITool } from './tools.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 解析一段 SSE 文本流里的 chat.completion.chunk;回调每个 chunk 的 JSON。 */
export async function* sseChunks(body) {
  const reader = body.getReader(); const dec = new TextDecoder(); let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      try { yield JSON.parse(data) } catch (_) {}
    }
  }
}

/**
 * @param {object} o
 * @param {string} o.baseURL      如 https://api.openai.com/v1
 * @param {string} o.apiKey
 * @param {string} o.model
 * @param {string|string[]} o.system
 * @param {string} o.prompt
 * @param {object[]} o.tools      tools.js 的 spec 数组
 * @param {number} o.maxTurns
 * @param {(e:object)=>void} [o.onEvent]   { t:'delta', text } / { t:'tool', name }
 * @param {AbortController} [o.abortController]
 * @param {Function} [o.fetchImpl]
 * @returns {Promise<{ blocks: object[], usage: object }>}
 */
export async function runAgent({ baseURL, apiKey, model, fallbacks = [], system, prompt, tools = [], maxTurns = 20, onEvent = null, abortController = null, fetchImpl = (...a) => globalThis.fetch(...a), log = () => {} }) {
  const spare = [...fallbacks]   // 这个型号不行就换下一个(下线 / 没额度 / 挤不上)
  const sys = Array.isArray(system) ? system.map((s) => (typeof s === 'string' ? s : s?.text || '')).join('\n') : (system || '')
  const messages = [...(sys ? [{ role: 'system', content: sys }] : []), { role: 'user', content: prompt }]
  const byName = new Map(tools.map((t) => [t.name, t]))
  const toolDefs = tools.map(toOpenAITool)
  const blocks = []
  const usage = { ms: 0, turns: 0, subtype: 'success', firstMs: null, inp: 0, cacheRead: 0, cacheWrite: 0, out: 0, usd: 0 }
  const tell = onEvent ? (e) => { try { onEvent(e) } catch (_) {} } : null
  const t0 = Date.now()
  let said = false

  for (let turn = 0; turn < maxTurns; turn++) {
    usage.turns = turn + 1
    const body = { model, messages, stream: true, stream_options: { include_usage: true }, ...(toolDefs.length ? { tools: toolDefs } : {}) }
    let res
    for (let attempt = 0; ; attempt++) {
      res = await fetchImpl(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body),
        ...(abortController ? { signal: abortController.signal } : {}),
      })
      if (res.ok) break
      const txt = await res.text().catch(() => '')
      const quota = res.status === 429 && /quota|billing/i.test(txt)   // 429 两种:挤(等等再试)和没额度(等也没用,换型号)
      if ((res.status === 429 || res.status >= 500) && !quota && attempt < 2) { log(`  ↳ ${res.status},${2 ** attempt}s 后重试`); await sleep(1000 * 2 ** attempt); continue }
      // 模型下线了(Gemini 对新用户回 404 并点名接替的型号,9/25 学员撞到):照它说的换一次再试
      const hint = res.status === 404 && txt.match(/models\/([\w.-]+)/g)?.map((m) => m.slice(7)).find((m) => m !== model)
      if (hint && attempt < 2 && !spare.includes(hint)) { log(`  ↳ ${model} 没了,换 ${hint}`); model = hint; body.model = hint; continue }
      // 下线 / 没额度 / 重试完还是挤:顺着备选链换下一个
      if ((res.status === 404 || quota || res.status === 429 || res.status >= 500) && spare.length) { const next = spare.shift(); log(`  ↳ ${model} ${res.status}${quota ? '(没额度)' : ''},换 ${next}`); model = next; body.model = next; attempt = -1; continue }
      throw new Error(`模型接口回 ${res.status}:${txt.slice(0, 300)}`)
    }
    // 收流:文字边收边报;tool_calls 按 index 拼
    let text = ''
    const calls = []   // { id, name, args }
    if (said) tell?.({ t: 'delta', text: '\n' })
    for await (const c of sseChunks(res.body)) {
      if (c.usage) { usage.inp += c.usage.prompt_tokens || 0; usage.out += c.usage.completion_tokens || 0; usage.cacheRead += c.usage.prompt_tokens_details?.cached_tokens || 0 }
      const d = c.choices?.[0]?.delta
      if (!d) continue
      if (d.content) {
        if (usage.firstMs === null) { usage.firstMs = Date.now() - t0; log(`  ↳ 首字 ${(usage.firstMs / 1000).toFixed(1)}s`) }
        text += d.content; said = true; tell?.({ t: 'delta', text: d.content })
      }
      for (const tc of d.tool_calls || []) {
        const i = tc.index ?? calls.length
        if (!calls[i]) { calls[i] = { id: tc.id || `call_${turn}_${i}`, name: '', args: '', extra: null } }
        if (tc.id) calls[i].id = tc.id
        // Gemini 3.x 在 tool_call 上带 extra_content.google.thought_signature,下一轮**必须原样带回去**,不然 400(9/29 学员机器上撞到)
        if (tc.extra_content) calls[i].extra = tc.extra_content
        if (tc.function?.name) { calls[i].name += tc.function.name; log(`  ↳ 动工具 ${((Date.now() - t0) / 1000).toFixed(1)}s:${calls[i].name}`); tell?.({ t: 'tool', name: calls[i].name }) }
        if (tc.function?.arguments) calls[i].args += tc.function.arguments
      }
    }
    if (text) blocks.push({ type: 'text', text })
    const live = calls.filter(Boolean)
    if (!live.length) break
    // 跑工具
    messages.push({ role: 'assistant', content: text || null, tool_calls: live.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' }, ...(c.extra ? { extra_content: c.extra } : {}) })) })
    const images = []
    for (const c of live) {
      let input = {}; try { input = JSON.parse(c.args || '{}') } catch (_) {}
      blocks.push({ type: 'tool_use', id: c.id, name: c.name, input })
      const spec = byName.get(c.name)
      let out
      if (!spec) out = { content: [{ type: 'text', text: `没有叫 ${c.name} 的工具` }] }
      else { try { out = await spec.handler(input) } catch (e) { out = { content: [{ type: 'text', text: `工具出错:${e.message}` }] } } }
      if (typeof out === 'string') out = { content: [{ type: 'text', text: out }] }   // handler 直接回字符串也收
      const texts = [], imgs = []
      for (const part of out?.content || []) { if (part.type === 'text') texts.push(part.text); else if (part.type === 'image') imgs.push(part) }
      messages.push({ role: 'tool', tool_call_id: c.id, content: texts.join('\n') || (imgs.length ? '(图在下一条消息里)' : '(空)') })
      images.push(...imgs)
    }
    if (images.length) messages.push({ role: 'user', content: images.map((p) => ({ type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } })) })
  }
  usage.ms = Date.now() - t0
  return { blocks, usage }
}
