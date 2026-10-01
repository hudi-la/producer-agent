// ChatGPT subscription through the official, pinned Codex app-server.
// A private CODEX_HOME keeps Fairwind separate from students' Codex projects,
// credentials and MCP configuration. Tokens are owned/refreshed by Codex.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { VERSION } from '../version.js'
import { toOpenAITool } from './tools.js'

const require = createRequire(import.meta.url)
export function codexBinary() {
  const cpu = { arm64: 'aarch64', x64: 'x86_64' }[process.arch]
  const os = { darwin: 'apple-darwin', linux: 'unknown-linux-musl', win32: 'pc-windows-msvc' }[process.platform]
  const root = dirname(require.resolve(`@openai/codex-${process.platform}-${process.arch}/package.json`))
  return join(root, 'vendor', `${cpu}-${os}`, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex')
}

export function codexOptions(dataDir, env = process.env) {
  if (!dataDir) throw new Error('ChatGPT 订阅需要 Fairwind 本机数据目录 / ChatGPT subscription requires local mode')
  const home = resolve(dataDir, 'chatgpt'), cwd = join(home, 'workspace')
  mkdirSync(cwd, { recursive: true, mode: 0o700 })
  // Only forward OS/proxy/certificate variables, never other providers' keys or Codex settings.
  const childEnv = Object.fromEntries(Object.entries(env).filter(([k]) => /^(HOME|USER|LOGNAME|PATH|TMPDIR|TMP|TEMP|SystemRoot|LANG|LC_.*|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|https?_proxy|all_proxy|no_proxy|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS)$/.test(k)))
  childEnv.CODEX_HOME = home
  return { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] }
}

export const CODEX_ARGS = ['app-server', '--listen', 'stdio://',
  '-c', 'forced_login_method="chatgpt"', '-c', 'cli_auth_credentials_store="file"',
  '-c', 'features.shell_tool=false', '-c', 'features.unified_exec=false',
  '-c', 'features.multi_agent=false', '-c', 'features.goals=false',
  '-c', 'features.apps=false', '-c', 'features.plugins=false', '-c', 'features.hooks=false',
  '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0']

// JSONL RPC. Every pending operation fails on exit; closing never leaves a login or turn hanging.
export class CodexClient {
  constructor({ dataDir, spawnImpl = spawn, binary = codexBinary(), timeoutMs = 30_000 } = {}) {
    this.pending = new Map(); this.listeners = new Set(); this.nextId = 0; this.timeoutMs = timeoutMs
    this.child = spawnImpl(binary, CODEX_ARGS, codexOptions(dataDir))
    this.child.stderr.resume() // Do not leak OAuth URLs/tokens or raw provider errors into logs.
    this.lines = createInterface({ input: this.child.stdout })
    this.lines.on('line', (line) => {
      let m; try { m = JSON.parse(line) } catch { return }
      if (m.method) {
        for (const fn of this.listeners) fn(m)
        if (m.id != null && !this.onRequest) this.send({ id: m.id, error: { code: -32601, message: 'Unsupported request' } })
        else if (m.id != null) Promise.resolve(this.onRequest(m)).catch(() => this.send({ id: m.id, error: { code: -32603, message: 'Tool failed' } }))
      } else if (this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.timer)
        if (m.error) p.reject(new Error(m.error.message || 'Codex request failed')); else p.resolve(m.result)
      }
    })
    this.child.stdin.on('error', (e) => this.fail(e))
    this.child.on('error', (e) => this.fail(e))
    this.child.on('exit', () => this.fail(new Error('ChatGPT 连接已关闭 / ChatGPT connection closed')))
  }
  fail(error) {
    if (this.closed) return
    this.closed = error
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error) }
    this.pending.clear()
    for (const fn of this.listeners) fn({ method: 'connection/closed', params: { error } })
  }
  send(m) { if (!this.closed) this.child.stdin.write(JSON.stringify(m) + '\n') }
  request(method, params = {}) {
    if (this.closed) return Promise.reject(this.closed)
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`ChatGPT 请求超时 / Request timed out: ${method}`)) }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params })
    })
  }
  async init() {
    await this.request('initialize', { clientInfo: { name: 'fairwind', title: 'Fairwind', version: VERSION }, capabilities: { experimentalApi: true } })
    this.send({ method: 'initialized' }); return this
  }
  close() { if (this.closing) return; this.closing = true; this.fail(new Error('ChatGPT connection closed')); this.lines.close(); this.child.stdin.destroy(); this.child.kill(); const c = this.child; const timer = setTimeout(() => { if (c.exitCode === null) c.kill('SIGKILL') }, 2000); timer.unref() }
}

const createClient = (dataDir) => new CodexClient({ dataDir })
const authSessions = new Map()
const authErrors = new Map()
const accountView = (a) => ({ connected: a?.type === 'chatgpt', email: a?.type === 'chatgpt' ? a.email : '', plan: a?.type === 'chatgpt' ? a.planType : '' })
export async function chatgptStatus(dataDir, factory = createClient) {
  const session = authSessions.get(dataDir)
  if (session) return { connected: false, pending: true, authUrl: session.authUrl || '' }
  if (authErrors.has(dataDir)) return { connected: false, error: { message: authErrors.get(dataDir) } }
  const c = factory(dataDir)
  try { await c.init(); return accountView((await c.request('account/read', { refreshToken: false })).account) }
  finally { c.close() }
}
export async function chatgptLogin(dataDir, factory = createClient) {
  if (authSessions.has(dataDir)) return { authUrl: authSessions.get(dataDir).authUrl || '', pending: true }
  authErrors.delete(dataDir)
  const c = factory(dataDir), session = { client: c, authUrl: '' }
  authSessions.set(dataDir, session)
  const stop = (error) => { if (authSessions.get(dataDir) !== session) return; authSessions.delete(dataDir); if (error) authErrors.set(dataDir, error.message); clearTimeout(session.timer); c.close() }
  session.timer = setTimeout(() => stop(new Error('登录已超时，请重试 / Sign-in timed out; please try again')), 10 * 60_000); session.timer.unref()
  c.listeners.add((m) => {
    if (m.method === 'account/login/completed') stop(m.params?.success ? null : new Error(m.params?.error || '登录未完成，请重试 / Sign-in did not complete; please try again'))
    if (m.method === 'connection/closed') stop(m.params?.error)
  })
  try {
    await c.init()
    const r = await c.request('account/login/start', { type: 'chatgpt' })
    session.authUrl = r.authUrl
    return { authUrl: r.authUrl, pending: true }
  } catch (e) { stop(e); throw e }
}

export async function runCodex({ dataDir = process.env.FAIRWIND_DATA_DIR, model, system, prompt, tools = [], maxTurns = 20, onEvent, abortController, clientFactory = createClient, timeoutMs = 10 * 60_000 }) {
  const c = clientFactory(dataDir), start = Date.now(), blocks = []
  const usage = { ms: 0, turns: 1, subtype: 'success', firstMs: null, inp: 0, cacheRead: 0, cacheWrite: 0, out: 0, usd: 0 }
  const tell = (e) => { try { onEvent?.(e) } catch {} }
  const byName = new Map(tools.map((t) => [t.name, t]))
  let finish, fail, timer, threadId, toolCalls = 0, settled = false
  const done = new Promise((resolve, reject) => { finish = resolve; fail = reject })
  done.catch(() => {}) // startup/abort may fail before we reach await done
  const stop = (e) => { if (!settled) { settled = true; fail(e) }; c.close() }
  const abort = () => stop(new Error('ChatGPT 请求已取消 / Request cancelled'))
  try {
    abortController?.signal.addEventListener('abort', abort, { once: true })
    if (abortController?.signal.aborted) throw new Error('ChatGPT 请求已取消 / Request cancelled')
    timer = setTimeout(() => stop(new Error('ChatGPT 请求超时 / Request timed out')), timeoutMs)
    await c.init()
    const account = (await c.request('account/read', { refreshToken: false })).account
    if (account?.type !== 'chatgpt') throw new Error('请先在模型来源里登录 ChatGPT 订阅 / Sign in with ChatGPT in model settings first')
    c.onRequest = async (m) => {
      if (m.method !== 'item/tool/call') { c.send({ id: m.id, error: { code: -32601, message: 'Only Fairwind tools are available' } }); return }
      const p = m.params, spec = byName.get(p.tool)
      if (p.threadId !== threadId || !spec || settled) { c.send({ id: m.id, result: { success: false, contentItems: [{ type: 'inputText', text: 'Tool not allowed' }] } }); return }
      if (++toolCalls > maxTurns) { stop(new Error('ChatGPT 工具调用达到上限 / Tool call limit reached')); return }
      blocks.push({ type: 'tool_use', id: p.callId, name: p.tool, input: p.arguments }); tell({ t: 'tool', name: p.tool })
      let out
      try { out = await spec.handler(p.arguments) } catch (e) { out = { isError: true, content: [{ type: 'text', text: e.message }] } }
      if (typeof out === 'string') out = { content: [{ type: 'text', text: out }] }
      const contentItems = (out?.content || []).flatMap((x) => x.type === 'text' ? [{ type: 'inputText', text: x.text }] : x.type === 'image' ? [{ type: 'inputImage', imageUrl: `data:${x.mimeType};base64,${x.data}` }] : [])
      c.send({ id: m.id, result: { success: !out?.isError, contentItems: contentItems.length ? contentItems : [{ type: 'inputText', text: '(empty)' }] } })
    }
    c.listeners.add((m) => {
      const p = m.params || {}
      if (m.method === 'connection/closed') { if (!settled) { settled = true; fail(p.error) }; return }
      if (p.threadId !== threadId) return
      if (m.method === 'item/agentMessage/delta') { if (usage.firstMs === null) usage.firstMs = Date.now() - start; tell({ t: 'delta', text: p.delta }) }
      if (m.method === 'item/completed' && p.item?.type === 'agentMessage') blocks.push({ type: 'text', text: p.item.text })
      if (m.method === 'thread/tokenUsage/updated') { const u = p.tokenUsage?.total || {}; usage.inp = u.inputTokens || 0; usage.out = u.outputTokens || 0; usage.cacheRead = u.cachedInputTokens || 0 }
      if (m.method === 'turn/completed' && !settled) {
        settled = true
        if (p.turn?.status === 'completed') finish()
        else fail(new Error(p.turn?.error?.message || `ChatGPT: ${p.turn?.status || 'incomplete'}`))
      }
    })
    const sys = Array.isArray(system) ? system.map((s) => typeof s === 'string' ? s : s?.text || '').join('\n') : system || ''
    const r = await c.request('thread/start', { ...(model ? { model } : {}), ephemeral: true, environments: [], sandbox: 'read-only', approvalPolicy: 'never', baseInstructions: sys || 'You are Fairwind, an artist’s producer assistant.',
      dynamicTools: tools.map((t) => { const f = toOpenAITool(t).function; return { type: 'function', name: f.name, description: f.description, inputSchema: f.parameters } }) })
    threadId = r.thread.id
    await c.request('turn/start', { threadId, input: [{ type: 'text', text: prompt }] })
    await done
    usage.ms = Date.now() - start; usage.turns = toolCalls + 1
    return { blocks, usage }
  } finally { clearTimeout(timer); abortController?.signal.removeEventListener('abort', abort); c.close() }
}
