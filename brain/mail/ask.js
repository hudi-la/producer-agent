// 邮件这条链上唯一会用到模型的地方。
//
// 为什么不复用 server.js 里的 think()：那个文件在模块顶层就 listen 起了
// HTTP 服务，import 一下就会占端口。判定这件事该能脱开服务单独跑
// （`npm run mail:classify`），所以另起一个薄壳。
//
// **默认不给任何工具。** 判定要的东西全在地址卡里（署名、域名、主题行、
// 来往封数、首末日期），放它去联网只会让每一批慢十倍，而且给了它编故事
// 的材料。认不出就该说认不出，不该去搜一个看起来合理的答案回来。
import { query } from '@anthropic-ai/claude-agent-sdk'
import { db } from './store.js'
import { engineOf, providerConfig } from '../engine/index.js'
import { runCodex } from '../engine/codex.js'
import { runAgent } from '../engine/openaiCompat.js'
import { currentTenant, childEnv } from '../tenant.js'
import { quotaOf, QuotaError } from '../quota.js'
import { LANG_RULE, outputLang } from '../prompt.js'
import { builtinTools } from '../engine/tools.js'
import { foldReply } from '../reply.js'
import { modelFor, CHEAP } from '../models.js'

let _profile
/**
 * 画像。判「跟这摊事有关吗」得先知道这摊事是什么。
 * 线上一个进程替好多人判(2026-10-07 修):画像按人缓存在 marks 里——原来是模块级一份,
 * 第一个跑分类的人的画像会被拿去判后面所有人的地址。个人版 / 本机版只有一个人,还是模块级那份。
 */
export async function profile() {
  const t = currentTenant()
  const box = t?.mode === 'hosted' && t.marks ? t.marks : null
  if (box ? box.askProfile !== undefined : _profile !== undefined) return box ? box.askProfile : _profile
  const { data } = await db().from('v_pa_profile').select('*').limit(1)
  const p = data?.[0] || null
  if (box) box.askProfile = p; else _profile = p
  return p
}

function systemFor(p) {
  if (!p) return '你在帮一位艺术家整理他的邮件联系人。'
  const d = p.data || {}
  const loc = Array.isArray(d.location) ? d.location.join(' / ') : d.location
  return [
    `你在帮 ${p.name || '一位艺术家'} 整理邮件联系人。`,
    p.website ? `作品站：${p.website}` : '',
    d.visa ? `身份：${d.visa}` : '',
    loc ? `常住：${loc}` : '',
    d.email ? `本人邮箱：${d.email}` : '',
    '',
    '他这摊事包括：驻地、grant、奖项、群展、开放征集、机构合作、策展人和',
    '项目负责人的往来、学校与教学、艺术家同行。',
    '**不包括**：账单、订阅、平台通知、购物、旅行确认、招聘广告、',
    '跟艺术事业无关的私人琐事。',
  ].filter(Boolean).join('\n')
}

/** 问一次。返回纯文本，解析交给调用方。 */
export async function ask(prompt, { tools = [], maxTurns = 2 } = {}) {
  // 英文版:认人(来路、名字)、写摘要也一律英文(2026-10-08;这条路不经过 server.js 的 think)
  if (outputLang() === 'en' && !prompt.includes('**Language:')) prompt += LANG_RULE()
  const p = await profile()
  // GPT / Gemini / ChatGPT 订阅:走各自的引擎(原来只认 ChatGPT 订阅,选了 GPT / Gemini 的人这里照样去调 Claude)
  const cfg = providerConfig(CHEAP)
  if (cfg) {
    let blocks
    try { ({ blocks } = await (cfg.name === 'chatgpt-subscription' ? runCodex : runAgent)({ ...cfg, prompt, system: systemFor(p), tools: builtinTools(tools), maxTurns, log: () => {} })) }
    catch (e) { const q = quotaOf(e); throw q ? new QuotaError(q) : e }   // 额度用完要认得出来,界面上说「X 点重置」
    const { text } = foldReply(blocks)
    if (!text) throw new Error('空回复')
    return text
  }
  // 邮件小活全走便宜档(models.js);没配环境变量时 model 不进 options,行为照旧。
  const model = modelFor(CHEAP)
  const out = []
  for await (const m of query({
    prompt,
    options: {
      systemPrompt: systemFor(p),
      allowedTools: tools,          // 默认空数组：一个工具都不给
      permissionMode: 'bypassPermissions',
      maxTurns,
      env: childEnv(),              // 这个人自己的 key / 订阅令牌(2026-10-07 补:原来没带,线上会用服务器本机登录的那份)
      ...(model ? { model } : {}),
    },
  })) {
    if (m.type === 'assistant') {
      for (const b of m.message.content) if (b.type === 'text') out.push(b.text)
    }
    if (m.type === 'result' && m.subtype !== 'success') {
      const q = quotaOf(out.join('\n') + ' ' + (m.result || '') + ' ' + (m.errors || []).join(' '))
      if (q) throw new QuotaError(q)
      throw new Error('没想完：' + m.subtype)
    }
  }
  const text = out.join('\n').trim()
  // Claude 订阅额度用完时,SDK 常把「usage limit reached|…」当成一句正常回话回来——短短一句,不是判定
  const q = text.length < 400 ? quotaOf(text) : null
  if (q) throw new QuotaError(q)
  if (!text) throw new Error('空回复')
  return text
}
