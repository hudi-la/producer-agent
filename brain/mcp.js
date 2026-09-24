// brain/mcp.js —— 给 Claude Code / GPT 桌面版开的那扇门:Fairwind 的档案做成几个 MCP 工具。
//
// 为什么要这扇门(2026-09-24,他要的):学员在 Claude Code 里说一句「读我的网站,把作品填进 Fairwind」,
// 眼看着 agent 用工具查、用工具写——这正是这门课要教的。页面上的一键导入是另一条路,以后用同一批函数。
//
// 只开档案那一层(第一个包露面的):档案、条目、图片、草稿标记。全部走 pa_* / v_pa_*(6.4 规矩 1)。
// 只听本机:server.js 那头查 remoteAddress 是不是回环地址,不是就 403。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

const KINDS = `kind 只能是这几种:
  work(作品:medium 媒介、year、body 一句话说明、meta.concern 母题、images 图片链接数组、site_path 网站上的路径)
  statement(自述:meta.scope = artist | bio-short | bio-long | research;body 是正文)
  job(工作:meta.org 机构、meta.start、meta.end、meta.location)
  education(教育:meta.school、meta.year、meta.location)
  credit(展览/驻地/获奖/策展:meta.type = 个展 | 群展 | 驻地 | grant | 策展;meta.org、meta.year、meta.location)
  skill(技能:title 就够)
  offer(工作坊/可提供:title + body)`

const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] })
const fail = (e) => ({ content: [{ type: 'text', text: '没成:' + (e?.message || e) }], isError: true })

export function buildMcpServer({ db, version, dataDir, modules }) {
  const server = new McpServer({ name: 'fairwind', version: version || '0.0.0' })
  const rpc = async (fn, args) => { const { data, error } = await db.rpc(fn, args); if (error) throw new Error(`${fn}:${error.message}`); return data }

  server.registerTool('fairwind_info', {
    title: 'Fairwind 是什么、在哪',
    description: '这台机器上的 Fairwind:版本、数据目录、判据文档在哪、哪些模块开着。先调它认认路。',
    inputSchema: {},
  }, async () => text({ version, dataDir, judgmentsDir: dataDir ? `${dataDir}/judgments` : null, modules, kinds: KINDS }))

  server.registerTool('fairwind_profile_get', {
    title: '读「关于你」', description: '艺术家的档案头:名字、作品站、身份、常住、阶段、资助偏好、排除/关注规则、方向。', inputSchema: {},
  }, async () => { try { const { data, error } = await db.from('v_pa_profile').select('*').limit(1); if (error) throw new Error(error.message); return text(data?.[0] || null) } catch (e) { return fail(e) } })

  server.registerTool('fairwind_profile_set', {
    title: '改「关于你」', description: '只改传进来的字段,没传的不动。location / directions 是数组。',
    inputSchema: { name: z.string().optional(), website: z.string().optional(), visa: z.string().optional(), location: z.array(z.string()).optional(), career_stage: z.string().optional(), funding_pref: z.string().optional(), exclude_rule: z.string().optional(), watch_rule: z.string().optional(), directions: z.array(z.string()).optional() },
  }, async ({ name, website, ...data }) => {
    try {
      const patch = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
      await rpc('pa_set_profile', { p_name: name ?? null, p_website: website ?? null, p_data: Object.keys(patch).length ? patch : null })
      return text({ ok: true })
    } catch (e) { return fail(e) }
  })

  server.registerTool('fairwind_entries_list', {
    title: '列档案条目', description: '作品、自述、工作、教育、展览驻地、技能、工作坊。要去重先调它。' + '\n' + KINDS,
    inputSchema: { kind: z.enum(['work', 'statement', 'job', 'education', 'credit', 'skill', 'offer']).optional() },
  }, async ({ kind }) => {
    try {
      let q = db.from('v_pa_entries').select('id, kind, title, medium, year, body, meta, images, site_path, draft')
      if (kind) q = q.eq('kind', kind)
      const { data, error } = await q; if (error) throw new Error(error.message)
      return text(data)
    } catch (e) { return fail(e) }
  })

  server.registerTool('fairwind_entry_add', {
    title: '加一条档案', description: '新加一条。先用 fairwind_entries_list 看有没有同名的,别重复加。' + '\n' + KINDS,
    inputSchema: { kind: z.enum(['work', 'statement', 'job', 'education', 'credit', 'skill', 'offer']), title: z.string(), body: z.string().optional(), medium: z.string().optional(), year: z.string().optional(), meta: z.record(z.string(), z.any()).optional(), images: z.array(z.string()).optional(), site_path: z.string().optional(), draft: z.boolean().optional().describe('还没写完就标 true,写申请时会跳过它') },
  }, async ({ kind, title, body, medium, year, meta, images, site_path, draft }) => {
    try {
      const id = await rpc('pa_add_entry', { p_kind: kind, p_title: title })
      if (body !== undefined || medium !== undefined || year !== undefined || meta !== undefined) await rpc('pa_set_entry', { p_id: id, p_title: null, p_body: body ?? null, p_medium: medium ?? null, p_year: year ?? null, p_meta: meta ?? null })
      if (images || site_path) await rpc('pa_set_entry_images', { p_id: id, p_images: images ?? null, p_site_path: site_path ?? null })
      if (draft !== undefined) await rpc('pa_set_entry_draft', { p_id: id, p_draft: draft })
      return text({ ok: true, id })
    } catch (e) { return fail(e) }
  })

  server.registerTool('fairwind_entry_set', {
    title: '改一条档案', description: '只改传进来的字段。meta 是整块换(先 list 拿到旧的合并了再传)。',
    inputSchema: { id: z.string(), title: z.string().optional(), body: z.string().optional(), medium: z.string().optional(), year: z.string().optional(), meta: z.record(z.string(), z.any()).optional(), images: z.array(z.string()).optional(), site_path: z.string().optional(), draft: z.boolean().optional() },
  }, async ({ id, title, body, medium, year, meta, images, site_path, draft }) => {
    try {
      if ([title, body, medium, year, meta].some((v) => v !== undefined)) await rpc('pa_set_entry', { p_id: id, p_title: title ?? null, p_body: body ?? null, p_medium: medium ?? null, p_year: year ?? null, p_meta: meta ?? null })
      if (images || site_path) await rpc('pa_set_entry_images', { p_id: id, p_images: images ?? null, p_site_path: site_path ?? null })
      if (draft !== undefined) await rpc('pa_set_entry_draft', { p_id: id, p_draft: draft })
      return text({ ok: true })
    } catch (e) { return fail(e) }
  })

  return server
}

/** 每个请求一份无状态的传输(Streamable HTTP)。挂在 server.js 的 /mcp 上。 */
export async function handleMcp(req, res, ctx) {
  const server = buildMcpServer(ctx)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}) })
  await server.connect(transport)
  let body
  if (req.method === 'POST') { const chunks = []; for await (const c of req) chunks.push(c); try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { body = {} } }
  await transport.handleRequest(req, res, body)
}
