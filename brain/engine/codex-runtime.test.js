// Exercise the pinned, packaged native runtime against a loopback fake Responses
// server. No personal Codex home, account, external inference or billing is used.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { z } from 'zod'
import { CodexClient, runCodex } from './codex.js'

test('pinned native runtime: dynamic tool round trip, streamed final reply, no environment tools', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fw-native-test-')), requests = [], events = []
  let calls = 0, client
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    if (!req.url.endsWith('/responses')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); return }
    const body = JSON.parse(raw); requests.push(body)
    const first = requests.length === 1
    const item = first
      ? { type: 'function_call', id: 'fc_test', call_id: 'call_test', name: 'lookup', arguments: '{"name":"art"}', status: 'completed' }
      : { id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', phase: 'final_answer', content: [{ type: 'output_text', text: 'Found art', annotations: [] }] }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const stream = [
      { type: 'response.created', response: { id: `resp_${requests.length}`, object: 'response', status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', ...(first ? { arguments: '' } : { content: [] }) } },
      ...(first ? [] : [{ type: 'response.output_text.delta', output_index: 0, item_id: 'msg_test', content_index: 0, delta: 'Found art' }]),
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: `resp_${requests.length}`, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } },
    ]
    for (const e of stream) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    res.end()
  })
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const base = `http://127.0.0.1:${server.address().port}/v1`
    client = new CodexClient({ dataDir: dir, spawnImpl: (bin, args, opts) => spawn(bin, [...args,
      '-c', 'model_provider="test"', '-c', 'model="test"', '-c', 'model_providers.test.name="Test"',
      '-c', `model_providers.test.base_url="${base}"`, '-c', 'model_providers.test.wire_api="responses"',
      '-c', 'model_providers.test.requires_openai_auth=false'], opts) })
    // Only account detection is faked; initialize, thread, tools, events and turn
    // completion cross the actual child-process protocol.
    const request = client.request.bind(client)
    client.request = (method, params) => method === 'account/read' ? Promise.resolve({ account: { type: 'chatgpt' } }) : request(method, params)
    const result = await runCodex({ clientFactory: () => client, prompt: 'Look up art', model: 'test', onEvent: (e) => events.push(e),
      tools: [{ name: 'lookup', description: 'Find artwork', shape: { name: z.string() }, handler: async ({ name }) => { calls++; assert.equal(name, 'art'); return 'art record' } }] })
    assert.equal(calls, 1); assert.equal(result.blocks.at(-1).text, 'Found art')
    assert.ok(events.some((e) => e.t === 'delta' && e.text === 'Found art'))
    assert.ok(requests[1].input.some((i) => i.type === 'function_call_output' && JSON.stringify(i).includes('art record')))
    // request_user_input is intrinsic to Codex, but Fairwind rejects its RPC;
    // there must be no shell, filesystem, external MCP, goals or subagents.
    assert.deepEqual(requests[0].tools.map((t) => t.name).sort(), ['lookup', 'request_user_input'])
  } finally {
    if (client) { const exited = client.child.exitCode === null ? once(client.child, 'exit') : Promise.resolve(); client.close(); await exited }
    server.closeAllConnections(); await new Promise((r) => server.close(r))
    rmSync(dir, { recursive: true, force: true })
  }
})
