// 够得着吗：以他现在的阶段，这个机会申得上申不上。
//
// 这是找机会这套东西里**唯一一个需要真去做调研**的判断。方向合不合、身份能不能申，
// 读一遍官网就知道；「以我这个阶段够不够得着」得去翻往届名单，拿真人的履历跟他的比。
//
// ══ 为什么单独一步、不跟找机会那轮混 ═══════════════════════════
//
// 找机会那一轮已经要开六七个站。再让它对每个候选去翻往届名单，一次调用会撑爆，
// 而且找到的大多数根本不开放，判了也白判。所以：
//   · 只对**本轮开着的**行判 → 成本跟着「本周真开着的」走，不跟表的大小走
//   · 判完存在行上，**一个机会判一次就够** —— 往届名单不是每周会变的东西
//
// ══ 最要紧的一条：查不到就说查不到 ═══════════════════════════
//
// 编一份往届名单出来，比不判坏得多：他会照着一个假参照去决定投不投。
// 所以 evidence 是必需品，reach='unknown' 是一个正当答案。
//
// 设计稿：docs/specs/2026-09-03-opportunity-pool-design.md 第四节

import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY, systemFor, entriesBlock } from './prompt.js'

export const REACH_MARK = '[[REACH]]'

/** 四档。unknown 不是「差」，是「没查到」——存疑不降级（见 pickable）。 */
export const REACH_LABEL = {
  realistic: '够得着',
  stretch: '有点悬',
  longshot: '多半白投',
  unknown: '往届名单没查到',
}

// 判据。他 2026-09-03 逐条确认过，特别点名了往届名单那一条。
//
// 放在静态块里：一轮要判好几个机会，这段字每次都一样，跟履历一起吃跨调用的缓存。
const RUBRIC = `## 怎么判「够不够得着」

你要回答的**不是**「这个机会好不好」，而是「**以他现在这个阶段，投了有没有戏**」。

### 往上够（多半白投 longshot）的信号
- 提名制、或需要机构推荐 / 共同申请人 / fiscal sponsor / 501(c)(3) 才能申
- 明写 mid-career、established、或要求十年以上专业实践
- 要求已有美术馆级个展、画廊代理、作品被机构收藏
- **往届名单清一色是大馆、双年展、名校 MFA 那一档的履历**
- 金额巨大且面向全球开放（投的人极多）

### 够得着（realistic）的信号
- 明写 emerging / early-career / 欢迎首次申请者 / 不要求学位
- **往届名单里有履历跟他相当的人** ← 这是最硬的一条
- 地域限制正好落在 Los Angeles 或 SF Bay Area（池子小）
- 主题窄且正好是他的：AI、参与式、微缩装置、亚裔身份、技术批评
- 申请材料是他现成的那几样（作品集 / 艺术家陈述 / CV），不要新制作预算、不要机构推荐信
- 免费或低报名费；新办的头几届，竞争还没固化

中间那档是 stretch（有点悬）：够得着的信号和往上够的信号都有，或者材料要求明显超出他手上现成的。

## 铁律

1. **必须真的去查往届名单。** 找 past fellows / recipients / alumni / awardees / 历届获奖者 /
   past residents 这类页面，或者机构的新闻稿。用 WebSearch 和 WebFetch。
2. **evidence 里要指名道姓**：查到了谁、那个人当年是什么履历（哪年、什么学校/机构背景、
   之前在哪儿展过）。至少举两个人。
3. **查不到就答 unknown**，并在 why 里说清你找过哪里、为什么没找到。
   **绝对不许编一份名单出来** —— 编出来的参照比没有参照坏得多，他会照着它决定投不投。
4. 只依据你真读到的页面。推测要说是推测。`

/**
 * 判「够得着」用的 system。
 * [静态块（人格 + 判据 + 他的全部履历）, 分界, 这一个机会的资料]
 * 静态块一轮里判好几个机会都一样，吃跨调用的缓存。
 */
export function reachSystem(profile, entries) {
  return [
    [systemFor(profile), '', RUBRIC, '', ...entriesBlock(entries)].join('\n'),
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    '',
  ]
}

const fact = (k, v) => (v ? `- ${k}：${v}\n` : '')

/** 这一个机会要问的话。 */
export function reachPrompt(o) {
  return `判断这个机会「以他现在的阶段够不够得着」。

## 机会
${fact('名称', o.title)}${fact('机构', o.org)}${fact('类型', o.kind)}${fact('地点', o.location)}${fact('资助', o.funding)}${fact('截止', o.deadline)}${fact('链接', o.url)}${fact('方向为什么合', o.why)}${fact('备注', o.notes)}
## 你要做的
1. 打开官网，看清楚它对申请人的要求（资历、材料、推荐信、是否提名制）。
2. **去找它的往届名单**（past fellows / recipients / alumni / 历届获奖者）。
   找到之后挑两三个人，查一下他们当年是什么履历。
3. 拿那些人跟上面「关于这位艺术家」那一段里的真实履历比。
4. 按判据给出结论。

## 报法
先用两三句中文说你查到了什么。然后**最后一行**单独输出，别的什么都不要加在它后面：
${REACH_MARK} {"reach":"realistic|stretch|longshot|unknown","why":"一句话结论，说清凭什么","evidence":"往届名单里查到了谁、那人当年什么履历（至少两个人）；查不到就写你找过哪里","url":"往届名单那一页的链接，没有就 null"}`
}

/** 解析。解析不出返回 null —— 调用方不许把「没按格式说话」当成一个判断结果。 */
export function parseReach(text) {
  const m = String(text || '').match(/\[\[REACH\]\]\s*(\{[\s\S]*?\})\s*$/)
  if (!m) return null
  let r
  try { r = JSON.parse(m[1]) } catch (_) { return null }
  if (!r || typeof r !== 'object') return null
  const reach = ['realistic', 'stretch', 'longshot', 'unknown'].includes(r.reach) ? r.reach : 'unknown'
  const evidence = String(r.evidence || '').trim() || null
  return {
    // 没凭证的判断不算数：说得再肯定，没查到名单就是没查到。
    // 这一条挡的是「它想显得有用，于是给了个笃定的档位」——那正是最难发现的错。
    reach: evidence ? reach : 'unknown',
    why: String(r.why || '').trim() || null,
    evidence,
    url: typeof r.url === 'string' && /^https?:\/\//.test(r.url) ? r.url : null,
    downgraded: Boolean(evidence) === false && reach !== 'unknown',
  }
}

/** 判过一次就够。往届名单不是每周会变的东西。 */
export const REACH_STALE_DAYS = 300

export function needsReach(o, { now = Date.now() } = {}) {
  if (!o?.reach || !o.reach_at) return true
  const age = (now - new Date(o.reach_at).getTime()) / 86400000
  return age > REACH_STALE_DAYS
}
