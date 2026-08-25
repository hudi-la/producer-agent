// scout:替这个艺术家扫机会源,产出候选卡。**纯函数**——不碰库不碰网,
// 跟 prompt.js 同一个理由:拼出来的对不对,得按得住测。
//
// 单人版的 scout 是 demo/scout-prompt.md:画像写死、SQL 写死、项目 ID 写死,
// 由 Hu Di 个人的定时任务执行。这里是它的多租户重生(推导见
// docs/specs/2026-08-25-architecture-from-requirements.md):
//   骨架(这个文件):扫描流程、合法性检查、去重、上限、[[CARDS]] 输出协议
//   血肉(参数进来):这个学员的画像、方向、作品、信息源、已有的卡
//
// 模型**不写 SQL**:它输出 [[CARDS]] 一行 JSON,落库走 pa_scout_cards
// (invoker + RLS,卡只会落进这个学员自己的看板)。

// 产品默认的聚合源。学员在造卡任务的 config.sources 里换成自己的。
export const DEFAULT_SOURCES = [
  'https://creative-capital.org/artist-resources/artist-opportunities/',
  'https://www.thisiscolossal.com/category/opportunities/',
  'https://www.transartists.org/en/transartists-calls',
  'https://artinfoland.com/opportunities',
]

// 小 system:跟 Fairwind 人格无关,扫源不需要知道协作弧怎么走。
export const SCOUT_SYSTEM = `你在替一位艺术家扫机会源(驻地、grant、开放征集、群展)。

规矩:
- 只依据你真的打开看到的内容;打不开的源跳过,别编。
- 判断匹配要严:宁缺毋滥。
- 最后一行按要求输出那个标记块,别的什么都不要加。`

const line = (k, v) => {
  if (v == null) return null
  const s = Array.isArray(v) ? v.filter(Boolean).join(' / ') : String(v).trim()
  return s ? `- ${k}:${s}` : null
}

/**
 * 拼 scout 的 user prompt。全部血肉从参数来;这里一个具体人名都不许出现。
 * @param {object} x
 *   profile        v_pa_profile 那行(name/website/data)
 *   concerns       母题数组(v_pa_meta)
 *   worksDigest    作品一句话清单(标题+媒介,不带长文)
 *   sources        信息源 URL 数组;空用 DEFAULT_SOURCES
 *   existingTitles 已有卡的标题(去重用)
 *   cap            这一轮最多产几张
 */
export function buildScoutPrompt({ profile, concerns, worksDigest, sources, existingTitles, cap = 5 }) {
  const d = profile?.data || {}
  const 画像 = [
    line('名字', profile?.name),
    line('作品站', profile?.website),
    line('身份/签证', d.visa),
    line('常住', d.location),
    line('阶段', d.career_stage),
    line('资助偏好', d.funding_pref),
    line('排除规则(满足即 eligible=false 或直接丢弃)', d.exclude_rule),
    line('关注规则(满足的哪怕没开放也留下,notes 注明 🟡 关注)', d.watch_rule),
    line('母题', concerns),
    line('作品', worksDigest),
  ].filter(Boolean).join('\n')

  const 源 = (sources?.length ? sources : DEFAULT_SOURCES).map((s) => `- ${s}`).join('\n')
  const 已有 = existingTitles?.length ? existingTitles.map((t) => `- ${t}`).join('\n') : '(还没有)'

  return `扫一轮机会源,替 ta 找值得入库的机会。

== ta 的画像(筛选标准就是这个,没写的别替 ta 假设)==
${画像 || '(档案还没填——只收「明确对所有人开放、无资格限制」的机会,notes 注明「档案未填,粗筛」)'}

== 信息源(逐个真的打开看;打不开就跳过)==
${源}
可以补一两次 WebSearch,关键词按 ta 的方向拟。

== 已有的卡(这些名称跳过,别重复)==
${已有}

== 每个候选要过的三道 ==
1. 按画像判匹配度:★★★ 给 3,★★ 给 2;够不上的丢弃。
2. 合法性:明显 vanity(高报名费 + 含糊奖项)、领奖要先交钱、没有独立官网的,跳过。
3. 资格:撞上排除规则的,eligible 给 false(仍然入库,进资格搁置);其余 true。

这一轮**最多 ${cap} 张,宁缺毋滥**。

写一段简短的中文汇报(看了哪些源、收了几张、为什么),然后**最后一行**单独输出,别的什么都不要加:
[[CARDS]] {"cards":[{"title":"名称","kind":"驻地|grant|奖|群展|开放征集","org":"机构","location":"地点","funding":"资助内容","deadline":"截止原文","url":"链接","match_stars":3,"why":"中文一句话理由","notes":"可空;🟡 关注在此注明","eligible":true}]}
一张都没有就输出 [[CARDS]] {"cards":[]}`
}

/** 从模型回复里抠出卡。认最后一个 [[CARDS]] 标记;坏的给空数组,绝不炸。 */
export function parseCards(text) {
  const m = String(text || '').match(/\[\[CARDS\]\]\s*(\{[\s\S]*?\})\s*$/)
  if (!m) return []
  try {
    const cards = JSON.parse(m[1])?.cards
    if (!Array.isArray(cards)) return []
    return cards.filter((c) => c && typeof c.title === 'string' && c.title.trim())
  } catch (_) { return [] }
}
