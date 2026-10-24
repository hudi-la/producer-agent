import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
// Minimal hook harness exercises the real send/error control flow without a DOM.
let state = [], cursor = 0, transport
mock.module('react', { namedExports: {
  useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] },
  useRef(value) { return { current: value } }, useCallback(fn) { return fn },
} })
mock.module('./chat.js', { namedExports: { sendMessageStream: (...args) => transport(...args), stopThinking: async () => ({ ok: true }) } })
mock.module('./useLiveReply.js', { namedExports: { useLiveReply: () => ({ live: '', act: '', onEvent() {}, reset() {} }) } })
const { useChat } = await import('./useChat.js')
const render = (opts) => { cursor = 0; return useChat(opts) }
test('health-down never turns an explicit chat command into a note', async () => {
  state = []; let called = 0
  transport = async (owner, text) => { called++; assert.equal(text, 'Please draft a reply'); return { mine: { id: 'new', role: 'artist', content: text } } }
  const hook = render({ owner: 'line', reload: async () => [], rewind: async () => {}, offline: { up: false, note: () => assert.fail('chat must never become a note') } })
  await hook.send('Please draft a reply')
  assert.equal(called, 1)
  assert.equal(state[0][0].id, 'new')
})
test('network failure preserves input even when older history contains the same text', async () => {
  const old = { id: 'old', role: 'artist', content: 'Please reply' }
  state = [[old], 'Please reply', false, null, null]
  transport = async () => { throw new Error('offline') }
  await render({ owner: 'line', reload: async () => [old] }).send()
  assert.equal(state[1], 'Please reply')
  assert.match(state[3], /你的话还在框里/)
})
test('acknowledged saved input stays saved even if error recovery cannot reload', async () => {
  state = [[], 'Please reply', false, null, null]
  transport = async (_o, text, _x, _id, event) => { event({ t: 'mine', row: { id: 'saved', role: 'artist', content: text } }); throw new Error('model failed') }
  await render({ owner: 'line', reload: async () => { throw new Error('offline') } }).send()
  assert.equal(state[1], '')
  assert.match(state[3], /你的话存下了/)
  assert.equal(state[0][0].id, 'saved')
})
