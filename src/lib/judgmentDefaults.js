// src/lib/judgmentDefaults.js —— 「我的判据」每一格的默认写法(2026-10-08)。
//
// 他问:「还没写的就是用默认的,默认的都是什么?能不能直接写在上面?」
// 默认的规矩其实写在脑子的 brain/judge.js(TRANSITIONS 每一格的提问)里,用户看不见。
// 这里把它们翻成人话,点开没写过的那一格,输入框里就是这几句——想改哪句改哪句。
// 一字不改就保存 = 还是用默认(存空),系统默认以后更新了也跟着走。
// 改了 judge.js 的惯例(天数、拿不准偏哪边),这里要跟着改。
import { getLang } from '../i18n/index.js'

const ZH = {
  '全部.md': `· 拿不准要不要回的，算要回。
· 对方说了「某天再联系」「月底给你日期」，就等到那一天再提醒我。
· 模糊的时间（"秋天聊""明年再说"）也落成一个具体日子，不让它飘掉。
· 约了具体见面时间的，见面优先：当天早上提醒，见完问一句怎么样。`,
  '对方来信.md': `· 客套收尾、单纯确认、通知类的告知，不用回；我已经回过的也不用回。
· 拿不准算要回。
· 信里约了见面或通话的时间，就记成见面。
· 对方说某天再联系我，就等到那天。`,
  '我发出的信.md': `· 投递、申请、提案：等 14 天左右，没回音再提醒我问一声。
· 约时间、要材料、问一句：等 5 天左右。
· 对方说了哪天答复，就等到那天。
· 纯告知、致谢收尾，不用等。
· 我发了跟进，等待从跟进那天重新算。`,
  '手记.md': `· 记的是见了面、通了话：记下跟谁、聊了什么。
· 记的是交了表单、投了提案：开始等结果；笔里写了兜底日期就等到那天，没写按惯例（投递 14 天左右）。
· 「说好周四再催」「再等两周」：改提醒的日子。
· 「电话里说定了」「已处理」：之前等的那件事算解决了。`,
  '见面之后.md': `· 见成了、见完了：这件事收尾，记一句聊了什么。
· 没见成、改约了：记新的时间。
· 取消了、不了了之：这件事收尾。`,
}

const EN = {
  '全部.md': `· If unsure whether something needs a reply, assume it does.
· If they say "I'll get back to you on X" or "dates by end of month", wait until then before reminding me.
· Turn vague timing ("let's talk in the fall", "next year") into a specific date so it doesn't drift.
· If a specific meeting time is set, the meeting comes first: remind me that morning, and ask how it went afterwards.`,
  '对方来信.md': `· Polite sign-offs, simple confirmations and announcements don't need a reply; neither does anything I've already answered.
· If unsure, it needs a reply.
· If the email sets a meeting or call time, record it as a meeting.
· If they say they'll get back to me on a certain day, wait until that day.`,
  '我发出的信.md': `· Submissions, applications, proposals: wait about 14 days, then remind me to follow up.
· Scheduling, asking for materials, a quick question: wait about 5 days.
· If they named a day they'd answer by, wait until then.
· Pure updates or thank-you notes: nothing to wait for.
· When I send a follow-up, the wait restarts from that day.`,
  '手记.md': `· A note about a meeting or call: record who it was with and what we talked about.
· A note about submitting a form or proposal: start waiting for the result; use the fallback date if I wrote one, otherwise the usual (about 14 days for submissions).
· "Agreed to follow up Thursday", "wait two more weeks": change the reminder date.
· "Settled on the phone", "handled": what we were waiting on is resolved.`,
  '见面之后.md': `· It happened / it's done: close it out and note what we talked about.
· It didn't happen and was rescheduled: record the new time.
· Cancelled or fizzled out: close it out.`,
}

export const defaultJudgment = (file) => ((getLang() === 'en' ? EN : ZH)[file] || '')
/** 跟默认一模一样(只差空白)= 没改过 */
export const isDefaultJudgment = (file, text) => String(text || '').replace(/\s+/g, '') === defaultJudgment(file).replace(/\s+/g, '')
