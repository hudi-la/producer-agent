// 重判一个对象：读它近期的往来，看现在到底该怎么样。
//
// ══ 为什么要有这个东西 ═════════════════════════════════════════
//
// 因为在这之前，**没有任何时刻会发生重判**。写 next_touch_at 的
// handleRefresh 是死代码（refreshPursuit 只 import 没调用，全局同步走
// /mail/sync 纯收信），所以库里那几个日期是历史遗留，不是活的。
//
// 于是通知栏拿着一个陈旧的结论在说话：Sarah 早就回过「plan on 2027」，
// 它还在报 7/30 的老账；Stanford 已经移到「发出&提交」，它还在喊截止。
//
// ══ 产出什么 ═══════════════════════════════════════════════════
//
// 一、**下一个时间点** —— 这段交流有没有约定什么时候再碰？
//     真例：Sarah 说 "I think we should plan on 2027"
//     → touch = 2027-01-05，why = '她说 "plan on 2027"'
//
// 二、**最后那封来信要不要回**（跟 triage 同一件事，这儿顺手一起答，
//     省一次调用）
//
// **日期和出处必须同时给，缺一个就都作废。** 这是「你定的日子到了（8/17）」
// 那句谎话的直接对策：日期能单独存在，才会有人替它编一个理由。
// parseRejudge 里堵一道，pa_set_next_touch 里再堵一道。
//
// 设计稿：docs/specs/2026-08-19-rejudge-design.md

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * 从回复里摘出那一批重判。**解析不出来一律空数组**——
 * 空数组的下场是「这批没判成，水位不推进，下次再判」。
 */
export function parseRejudge(text) {
  const m = String(text || '').match(/\[\[REJUDGE\]\]\s*(\[[\s\S]*\])\s*$/)
  if (!m) return []
  let rows
  try { rows = JSON.parse(m[1]) } catch (_) { return [] }
  if (!Array.isArray(rows)) return []
  return rows
    .filter((r) => r && typeof r.id === 'string')
    .map((r) => {
      const at = typeof r.touch === 'string' && ISO_DAY.test(r.touch) ? r.touch : null
      const why = typeof r.why === 'string' && r.why.trim() ? r.why.trim() : null
      // **缺一个就两个都作废。** 有日期没出处 → 到点了没人知道该干什么；
      // 有出处没日期 → 那句话永远不会响。
      const 成对 = at && why
      return {
        id: r.id,
        touch: 成对 ? at : null,
        why: 成对 ? why : null,
        // 没说就当要回 —— 漏一封真信比多吵一条坏得多
        needs_reply: typeof r.needs_reply === 'boolean' ? r.needs_reply : true,
        reply_why: typeof r.reply_why === 'string' && r.reply_why.trim()
          ? r.reply_why.trim() : '（没说理由）',
      }
    })
}

const CUT = 700
const 一封 = (m) =>
  `    ${m.at} ${m.dir === 'in' ? `${m.who} →你` : '你→'} ${String(m.text || '').slice(0, CUT)}`

const 一条 = (s) => `--- id: ${s.id}
【是什么】${s.what}${s.who ? `（对接 ${s.who}）` : ''}
【现在在哪一栏】${s.stage || '未知'}
【卡上现有的该碰日】${s.touch || '无'}${s.touch_why ? `　出处：${s.touch_why}` : ''}
【卡上现有的待办】${s.action || '无'}
【近期往来】
${(s.mails || []).map(一封).join('\n') || '    （没有往来）'}`

/**
 * 一次判一批。量按**对象数**走（几十个），不按信数（几千封）。
 */
export function rejudgePrompt(subjects) {
  return `下面是 ${subjects.length} 条线 / 个人的近况。每一条只答两个问题。

问题一：**这段交流里，有没有约定下一个该碰的时间点？**
有就给 YYYY-MM-DD，并把**依据的原话**抄下来当出处。

**模糊的锚点也要落成一个具体日子。** 这是最要紧的一条：
  · "plan on 2027"        → 2027-01-05（新年头一周）
  · "circle back next semester" → 那个学期开学那一周
  · "月底再联系"           → 那个月最后一周的周一
  · "秋天聊"               → 9 月第一周
对方给了时间锚点，就是**真的邀请你到那时候再来一次**。落不成一个日子，
它就会飘掉——这个项目里 LACHSA 和 Ruth Asawa SOTA 两条线都是这么没的：
都给了锚点，都因为没人记得再碰而不了了之。

出处照抄她的原话就行，不用你解释为什么挑这一天。

**日期和出处必须同时给。** 真的说不出依据（对方压根没提时间）就两个都填 null
——编一个理由比不写更坏，因为到那天你会以为那是真有出处的。
卡上原来那个该碰日已经过去、而这段交流没有约定新的，也填 null（等于作废它）。

**「现在在哪一栏」也是判断的一部分**：已经在「发出&提交」或更后面的，
说明这件事你做完了，多半不需要再定一个催的日子。

问题二：**最后那封对方来的信，需要你回吗？**
需要回 = 里面有等你答的事。不需要回 = 客套收尾、单纯确认、通知类的告知。
你已经回过了，也算不需要回。**拿不准就算需要回。**

${subjects.map(一条).join('\n\n')}

**最后一行**单独输出，别的什么都不要加：
[[REJUDGE]] [{"id":"<上面那个 id>","touch":"YYYY-MM-DD"|null,"why":"依据的原话，20 字内"|null,"needs_reply":true|false,"reply_why":"一句话"}]`
}
