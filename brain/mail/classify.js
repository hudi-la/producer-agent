// 三层漏斗：把几百上千个地址判成「这是谁、跟这摊事有没有关」。
//
// 判断的单位是**地址**，不是邮件。地址比邮件少一到两个数量级，而且判一次
// 永远算数——pa_claim_email 已经是这个语义：认领一个地址，它名下所有历史
// 往来当场归位。
//
//   第一层  信头就能判掉（List-Unsubscribe / no-reply@ / Precedence）
//   第二层  你一封都没回过的群发源
//           ↑ 这两层是纯 SQL，零成本，在 pa_mail_rule_pass 里
//   第三层  剩下的残渣才交给模型
//
// 第三层最不能漏：里面主要是「他写给你、你没回」的那些——冷邮件、策展人
// 来信、机构邀约。**漏掉的都是曾经找过你而你错过的人。**

import { rulePass, candidates, putVerdict } from './store.js'
import { ask } from './ask.js'

const BATCH = 50

const card = (c) => [
  `- ${c.email}`,
  c.name ? `  署名：${c.name}` : '',
  `  往来：他发来 ${c.in} 封 / 你发去 ${c.out} 封｜${c.first} → ${c.last}${c.bulk ? `｜其中 ${c.bulk} 封带群发信头` : ''}`,
  (c.subjects || []).length ? `  最近主题：${c.subjects.filter(Boolean).slice(0, 5).map((s) => `「${s}」`).join('　')}` : '',
].filter(Boolean).join('\n')

function prompt(batch) {
  return `下面每一条是一个邮件地址，连同它跟这位艺术家的往来概况。
逐个判断，然后一次性输出。

${batch.map(card).join('\n\n')}

每个地址判两件事：

**一、这是什么**
· person      —— 一个具体的人
· shared_box  —— 机构/团队的共享信箱（residency@ / info@ / workshops@ /
                 某个组织的公用 gmail，署名常是一组人或机构本身）。
                 **它不是人**，硬当成人的话往来会归错到某个倒霉蛋头上。
                 但它**照样可能非常重要**——一个机构的公用信箱跟你有
                 几十封实打实的往来是常事。别因为它不是人就判成不相关。
· bulk        —— 群发源：通讯、推送、营销
· machine     —— 系统自动发的：验证码、账单、平台通知、送达失败
· unsure      —— 看不出来

**二、跟这摊事有关吗**（business: true / false）
person 和 shared_box 都要判这一条。
驻地、grant、奖项、群展、开放征集、机构合作、策展人、学校教学、艺术家同行 → true
账单、订阅、购物、旅行、招聘、跟艺术事业无关的私人琐事 → false

三条硬规矩：
1. **你发过信给他的（上面「你发去」不是 0），几乎一定是真关系。** 判成
   bulk/machine 之前先想清楚——那是最不该判错的一批。
2. **认不出就 unsure，别编。** 编一个看起来合理的名字比说不知道更坏。
3. why 写给人看的一句中文：他是谁、你们之间发生过什么。别复述我给你的数字。

**最后一行**单独输出，别的什么都不要加：
[[VERDICTS]] {"verdicts":[{"email":"…","verdict":"person|shared_box|bulk|machine|unsure","business":true,"why":"…","name":"…或 null","org":"…或 null","role":"…或 null"}]}

上面 ${batch.length} 个地址，每个都要有一条，一个都不能少。`
}

// shared_box 是独立的一档，**不能折进 machine**。
//
// 第一批真跑就撞上了：罗兹抽象艺术节的主办方信箱，跟他 80 封往来、
// 给他出过 O-1 支持信——被折成 machine、强制 business=false，静默丢掉。
// 共享信箱不是人（硬当成人的话往来会归错到某个倒霉蛋头上，那是 0033
// 犯过的错），但它跟业务的相关性一点不比人低，该走「登记成机构信箱」。
const VERDICTS = new Set(['person', 'shared_box', 'bulk', 'machine', 'unsure'])
function normalize(v) {
  const raw = String(v?.verdict || '').trim()
  const verdict = VERDICTS.has(raw) ? raw : 'unsure'
  const isSomebody = verdict === 'person' || verdict === 'shared_box'
  return {
    email: String(v?.email || '').trim().toLowerCase(),
    verdict,
    // 群发和机器一律不算业务相关；人和共享信箱由它判。
    business: isSomebody ? Boolean(v?.business) : false,
    why: v?.why || null,
    name: v?.name || null, org: v?.org || null, role: v?.role || null,
    decided_by: 'fairwind',
  }
}

function parse(text, batch) {
  const m = text.match(/\[\[VERDICTS\]\]\s*(\{[\s\S]*\})\s*$/)
  if (!m) return null
  let list
  try { list = JSON.parse(m[1]).verdicts } catch (_) { return null }
  if (!Array.isArray(list)) return null

  const want = new Set(batch.map((c) => c.email))
  const got = new Map()
  for (const v of list) {
    const n = normalize(v)
    if (want.has(n.email)) got.set(n.email, n)
  }
  // 它漏掉的那几个不当没发生过——补成 unsure，下次还能再判。
  for (const e of want) {
    if (!got.has(e)) got.set(e, { email: e, verdict: 'unsure', business: false,
      why: '这一轮它没给出判断', decided_by: 'fairwind' })
  }
  return [...got.values()]
}

export async function classify({ rounds = Infinity, log = console.log } = {}) {
  log('第一、二层（纯 SQL）…')
  const rule = await rulePass()
  log(`  机器地址 ${rule.machine} 个｜群发源 ${rule.bulk} 个｜剩给第三层 ${rule.left} 个`)

  const tally = { person: 0, bulk: 0, machine: 0, unsure: 0, business: 0 }
  let round = 0
  let calls = 0

  while (round < rounds) {
    const batch = await candidates(BATCH)
    if (!batch.length) break
    round++

    log(`第三层 第 ${round} 批：${batch.length} 个地址，问一次…`)
    let text
    try {
      text = await ask(prompt(batch))
      calls++
    } catch (err) {
      log(`  ✗ 这批没问成（${err.message}），停在这儿——已判的都在库里，再跑一次接着来`)
      break
    }

    const verdicts = parse(text, batch)
    if (!verdicts) {
      log('  ✗ 回话格式不对，这批不写库。停。')
      break
    }

    for (const v of verdicts) {
      await putVerdict(v)
      tally[v.verdict] = (tally[v.verdict] || 0) + 1
      if (v.business) tally.business++
    }
    log(`  真人 ${verdicts.filter((v) => v.verdict === 'person').length}` +
        `｜业务相关 ${verdicts.filter((v) => v.business).length}` +
        `｜群发 ${verdicts.filter((v) => v.verdict === 'bulk').length}` +
        `｜机器/共享箱 ${verdicts.filter((v) => v.verdict === 'machine').length}` +
        `｜认不出 ${verdicts.filter((v) => v.verdict === 'unsure').length}`)
  }

  return { rule, rounds: round, calls, ...tally }
}
