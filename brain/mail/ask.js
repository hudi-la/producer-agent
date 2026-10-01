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
import { builtinTools } from '../engine/tools.js'
import { foldReply } from '../reply.js'
import { modelFor, CHEAP } from '../models.js'

let _profile
/** 画像。判「跟这摊事有关吗」得先知道这摊事是什么。 */
export async function profile() {
  if (_profile !== undefined) return _profile
  const { data } = await db().from('v_pa_profile').select('*').limit(1)
  _profile = data?.[0] || null
  return _profile
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
  const p = await profile()
  if (engineOf() === 'chatgpt-subscription') {
    const { blocks } = await runCodex({ ...providerConfig(CHEAP), prompt, system: systemFor(p), tools: builtinTools(tools), maxTurns })
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
      ...(model ? { model } : {}),
    },
  })) {
    if (m.type === 'assistant') {
      for (const b of m.message.content) if (b.type === 'text') out.push(b.text)
    }
    if (m.type === 'result' && m.subtype !== 'success') {
      throw new Error('没想完：' + m.subtype)
    }
  }
  const text = out.join('\n').trim()
  if (!text) throw new Error('空回复')
  return text
}
