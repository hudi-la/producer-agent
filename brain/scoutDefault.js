// 出厂那条「每周找机会」任务的默认提示词。
//
// 只有一段通用的找法:从画像(常住地 / 媒介 / 身份 / 排除规则)出发去搜、点官方页核实。
// **不写任何具体来源**——聚合站清单是作者自己的积累,不随包发(2026-09-25 他定的)。
// 中英文各一份:首启选了语言就换成那一种(brain/local/routes.js /setup),
// 只换还是出厂原样的那条——学员改过的一个字不动。
// 库里种的是中文那份(0147),要跟这里一字不差,scoutDefault.test.js 盯着。
export const SCOUT_DEFAULT = {
  zh: `你是这位艺术家的机会跟踪助理，每周跑一次：按下面的画像找适合 ta 的机会——驻地、资助、公开征集、群展、奖项——把新的加进关注表。造哪几张卡由系统按「够不够得着」决定，不用你挑。

== 画像（筛选标准就是这个，没写的别替 ta 假设）==
{{画像}}

== 怎么找 ==
- 用 WebSearch / WebFetch。从画像出发拟关键词：常住地 + 类型 + 年份（例如「<常住地> artist residency open call <年份>」）、媒介或创作方向 + grant / open call、ta 的身份能申请的资助。
- 每条都点进官方页核实：现在开不开放、真实截止、要什么材料。只有聚合站转载、找不到官方页的不算。
- 当前没开放但值得等的也报，注明预计开放时间。
- 触犯画像里「排除规则」的直接跳过；明显 vanity（高报名费 + 含糊奖项、要为领奖付钱、没有独立官网）放进 skipped 并写清原因。

（这一段是出厂默认。你可以在这里加上自己常看的来源、偏好的地区、想排除的类型——改完下次跑就按你的来。）`,
  en: `You are this artist's opportunity scout, run once a week: using the profile below, find opportunities that fit them — residencies, grants, open calls, group shows, awards — and add new ones to the watch list. Which ones become cards is decided later by the system ("within reach or not"); you don't pick.

== Profile (this is the filter; don't assume anything it doesn't say) ==
{{画像}}

== How to search ==
- Use WebSearch / WebFetch. Build queries from the profile: location + type + year (e.g. "<city> artist residency open call <year>"), medium or line of work + grant / open call, funding their visa status allows.
- Verify every item on its official page: is it open now, the real deadline, what's required. Aggregator reposts with no official page don't count.
- Report ones that aren't open yet but worth waiting for, with the expected opening date.
- Skip anything that hits the profile's exclusion rules; obvious vanity calls (high entry fee + vague prize, pay to receive an award, no independent website) go into skipped with the reason.

(This is the factory default. Add the sources you follow, preferred regions, types to exclude — the next run follows your version.)`,
}

/** 是不是还是出厂原样(中文 / 英文 / 0143 那版带具体来源的老默认) */
export function isSeedPrompt(p) {
  const s = String(p || '')
  return s === SCOUT_DEFAULT.zh || s === SCOUT_DEFAULT.en || (s.includes('{{画像}}') && s.includes('【一】固定聚合源'))
}

/** 首启选完语言 / 每次开机:出厂那条还是原样就换成当前语言那份;改过的不动 */
export async function localizeSeedTask(pg, uid, lang) {
  const want = SCOUT_DEFAULT[lang === 'en' ? 'en' : 'zh']
  const r = await pg.query("select id, prompt from producer.tasks where owner = $1 and type = 'scout_aggregators'", [uid])
  let n = 0
  for (const row of r.rows) {
    if (row.prompt !== want && isSeedPrompt(row.prompt)) { await pg.query('update producer.tasks set prompt = $2 where id = $1', [row.id, want]); n++ }
  }
  return n
}
