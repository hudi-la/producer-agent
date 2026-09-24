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
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { FILES as JUDGMENT_FILES, readJudgmentFiles, writeJudgmentFile } from './judgments.js'

const KINDS = `kind 是自由的:下面七种是出厂默认,有自己的标签和字段;你也可以用自己的类目名(比如「驻地日志」「合作过的人」),
界面上会按类目自己长出一栏,meta 里写什么就显示什么、Fairwind 也全看见。一条都没有的类目不出现。默认的七种:
  work(作品:medium 媒介、year、body 一句话说明、meta.concern 母题、images 图片链接数组、site_path 网站上的路径)
  statement(自述:meta.scope = artist | bio-short | bio-long | research;body 是正文)
  job(工作:meta.org 机构、meta.start、meta.end、meta.location)
  education(教育:meta.school、meta.year、meta.location)
  credit(展览/驻地/获奖/策展:meta.type = 个展 | 群展 | 驻地 | grant | 策展;meta.org、meta.year、meta.location)
  skill(技能:title 就够)
  offer(工作坊/可提供:title + body)`

const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] })
const fail = (e) => ({ content: [{ type: 'text', text: '没成:' + (e?.message || e) }], isError: true })

export function buildMcpServer({ db, version, dataDir, modules, previewJudgments = null }) {
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
    inputSchema: { kind: z.string().optional().describe('不传 = 全部') },
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
    inputSchema: { kind: z.string().describe('默认七种之一,或你自己的类目名'), title: z.string(), body: z.string().optional(), medium: z.string().optional(), year: z.string().optional(), meta: z.record(z.string(), z.any()).optional(), images: z.array(z.string()).optional(), site_path: z.string().optional(), draft: z.boolean().optional().describe('默认 false = 写完的,Fairwind 写申请时会用它。只有内容拿不准/没写完才标 true,那样它会跳过这条,直到人在页面上点「写完了」') },
  }, async ({ kind, title, body, medium, year, meta, images, site_path, draft }) => {
    try {
      const id = await rpc('pa_add_entry', { p_kind: kind, p_title: title })
      if (body !== undefined || medium !== undefined || year !== undefined || meta !== undefined) await rpc('pa_set_entry', { p_id: id, p_title: null, p_body: body ?? null, p_medium: medium ?? null, p_year: year ?? null, p_meta: meta ?? null })
      if (images || site_path) await rpc('pa_set_entry_images', { p_id: id, p_images: images ?? null, p_site_path: site_path ?? null })
      // 库里新建一律 draft=true(页面上「+ 加一条」是人要开始写);这扇门进来的是搬现成的——不传就算写完
      await rpc('pa_set_entry_draft', { p_id: id, p_draft: draft ?? false })
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

  // ── 机会卡:机会线模块开着才有(表全建、能力分装——关着的模块连工具都不露)──
  const STAGES = ['pending', 'matching', 'writing', 'sent', 'replying', 'won', 'paused', 'watch']
  const STAGE_DOC = 'stage:pending 新机会 | matching 匹配项目 | writing 一起写 | sent 发出&提交 | replying 进一步 | won 谈成 | paused 暂停 | watch 持续关注'
  if (modules?.pursuits) {
    server.registerTool('fairwind_pursuits_list', {
      title: '列机会卡', description: '看板上的机会线(卡)。要去重、要改某张先调它拿 id。' + STAGE_DOC,
      inputSchema: { stage: z.enum(STAGES).optional() },
    }, async ({ stage }) => {
      try {
        let q = db.from('v_pa_pursuit_cards').select('id, title, kind, org, location, url, funding, deadline, deadline_at, opens_at, match_stars, eligible, stage, next_action, jot, work_title, created_at')
        if (stage) q = q.eq('stage', stage)
        const { data, error } = await q; if (error) throw new Error(error.message)
        return text(data)
      } catch (e) { return fail(e) }
    })
    server.registerTool('fairwind_pursuit_add', {
      title: '加一张机会卡', description: '一个 open call / 驻地 / grant / 群展 做成一张卡,落在「新机会」那一列。先 fairwind_pursuits_list 看有没有同名的。deadline 是官方原话,deadline_at 是能定到某一天时的 YYYY-MM-DD。eligible=false 表示撞上排除规则(限公民之类),照加但标成资格搁置。',
      inputSchema: { title: z.string(), kind: z.string().optional().describe('驻地 | grant | 奖 | 群展 | 开放征集 | …'), org: z.string().optional(), location: z.string().optional(), funding: z.string().optional(), deadline: z.string().optional(), deadline_at: z.string().optional().describe('YYYY-MM-DD'), opens_at: z.string().optional().describe('YYYY-MM-DD,当前未开放时填预计开放日'), url: z.string().optional(), match_stars: z.number().int().min(1).max(3).optional(), why: z.string().optional().describe('一句话:为什么值得'), notes: z.string().optional(), eligible: z.boolean().optional() },
    }, async (a) => {
      try {
        const r = await rpc('pa_create_pursuit', { p_title: a.title, p_kind: a.kind ?? null, p_org: a.org ?? null, p_location: a.location ?? null, p_funding: a.funding ?? null, p_deadline: a.deadline ?? null, p_deadline_at: a.deadline_at ?? null, p_opens_at: a.opens_at ?? null, p_url: a.url ?? null, p_match_stars: a.match_stars ?? null, p_why: a.why ?? null, p_notes: a.notes ?? null, p_eligible: a.eligible ?? true, p_source: 'mcp', p_task_id: null })
        return text({ ok: true, ...(r && typeof r === 'object' ? r : { id: r }) })
      } catch (e) { return fail(e) }
    })
    server.registerTool('fairwind_pursuit_set', {
      title: '改一张机会卡', description: '改链接/截止/资格/开放日、挪阶段、写小记。只改传进来的。' + STAGE_DOC,
      inputSchema: { id: z.string(), url: z.string().optional(), deadline: z.string().optional(), deadline_at: z.string().optional(), opens_at: z.string().optional(), eligible: z.boolean().optional(), stage: z.enum(STAGES).optional(), jot: z.string().optional().describe('卡上的小记(一句话)') },
    }, async ({ id, url, deadline, deadline_at, opens_at, eligible, stage, jot }) => {
      try {
        if ([url, deadline, deadline_at, opens_at, eligible].some((v) => v !== undefined)) await rpc('pa_set_fields', { p_pursuit_id: id, p_url: url ?? null, p_deadline: deadline ?? null, p_eligible: eligible ?? null, p_opens_at: opens_at ?? null, p_deadline_at: deadline_at ?? null })
        if (stage) await rpc('pa_set_stage', { p_pursuit_id: id, p_stage: stage })
        if (jot !== undefined) await rpc('pa_set_jot', { p_pursuit_id: id, p_jot: jot })
        return text({ ok: true })
      } catch (e) { return fail(e) }
    })
    server.registerTool('fairwind_pursuit_note', {
      title: '在一张卡上记一笔', description: '记一笔手记:打了电话、交了表、见了面。kind:note 备注 | meet 见了面 | decision 拍了板。Fairwind 会按它判下一步(等多久、要不要提醒)。',
      inputSchema: { id: z.string(), text: z.string(), kind: z.enum(['note', 'meet', 'decision']).optional() },
    }, async ({ id, text: t, kind }) => { try { const r = await rpc('pa_add_pursuit_note', { p_pursuit_id: id, p_text: t, p_kind: kind || 'note' }); return text({ ok: true, id: r?.id || r }) } catch (e) { return fail(e) } })
  }

  // ── 判据:学员的口味文档(<数据目录>/judgments/*.md)。骨架在程序里改不了,口味在这几个文件里 ──
  const JFILES = Object.keys(JUDGMENT_FILES)
  const jdir = dataDir ? join(dataDir, 'judgments') : null
  if (modules?.mail) {
  server.registerTool('fairwind_judgments_list', {
    title: '读判据文档',
    description: `Fairwind 每次判断(要不要回、等多久、约了什么时候)前先读这些文件。五个文件名固定:${JFILES.join('、')}(全部.md 每次都带;其余按事件)。内容自由写,像跟熟这行的助手交代。返回每个文件的内容;README 里有写法说明。`,
    inputSchema: {},
  }, async () => {
    try {
      if (!jdir) return fail('云端模式没有判据目录')
      const out = readJudgmentFiles(jdir)
      const readme = existsSync(join(jdir, 'README.md')) ? readFileSync(join(jdir, 'README.md'), 'utf8') : ''
      return text({ dir: jdir, files: out, readme })
    } catch (e) { return fail(e) }
  })
  server.registerTool('fairwind_judgments_write', {
    title: '写判据文档',
    description: `整个文件换成新内容(先 list 拿旧的,改完再写)。file 只能是:${JFILES.join('、')}。字段由骨架定,写「加一个字段」这类话不生效,会在返回里点名。Fairwind 热重载,下一次判断就用新的。`,
    inputSchema: { file: z.enum(JFILES), content: z.string() },
  }, async ({ file, content }) => {
    try {
      if (!jdir) return fail('云端模式没有判据目录')
      const lints = writeJudgmentFile(jdir, file, content)
      return text({ ok: true, file, lints })
    } catch (e) { return fail(e) }
  })
  if (previewJudgments) server.registerTool('fairwind_judgments_preview', {
    title: '看看判据改完会怎么变',
    description: '拿最近判过的 N 件事,用现在的判据文档再判一遍(只判不写),把原来的结论和现在的并排给你。每件事一次模型调用,别一次要太多。',
    inputSchema: { limit: z.number().int().min(1).max(40).optional() },
  }, async ({ limit }) => { try { return text(await previewJudgments({ limit: limit || 10 })) } catch (e) { return fail(e) } })
  }

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
