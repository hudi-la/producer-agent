// 一封信里，哪一段是**这次说的话**。
//
// 邮件正文的后半截通常是整封旧信：Gmail 用 `> ` 引用、Outlook 用一条下划线
// 加 `From:/Sent:/To:/Subject:` 的信头块。框里只该露这次说的那几句，
// 剩下的留给「展开原文」。
//
// ══ 两个真踩过的坑 ═══════════════════════════════════════════
//
// 一、**JS 的 `.` 不匹配换行。** 原来写的是 `\nOn .{0,100}wrote:`，
//     可 Gmail 折行之后长这样：
//         On Tue, Aug 18, 2026 at 2:39 PM Biayna Bogosian
//         <Biayna.Bogosian@asu.edu>
//         wrote:
//     `.` 跨不过去，整块引用原样留在框里。要用 [\s\S]。
//
// 二、**只认 Gmail 不认 Outlook。** Outlook 回信是：
//         ________________________________
//         From: Di Hu <hudi.creates@gmail.com>
//         Sent: Tuesday, 18 August 2026 14:31:34
//     一条 `> ` 都没有。
//
// 宁可少砍也不多砍：砍错了你会以为对方没说那句话，而原文就在「展开」后面
// ——少砍最多是框里长一点。

/** 引用块从哪儿开始。找不到返回 -1。 */
function 引用从哪开始(t) {
  const 标记 = [
    /\n>/,                                  // Gmail / 大多数客户端
    /\nOn [\s\S]{0,120}?wrote:/,            // On … wrote:（可能折了行）
    /\n_{5,}/,                              // Outlook 那条下划线
    /\nFrom: .{0,120}\nSent: /,             // Outlook 的信头块
    /\n-{2,} ?\n/,                          // 签名分隔线
    /\nGet Outlook for /,                   // Outlook 手机版尾巴
  ]
  let at = -1
  for (const re of 标记) {
    const m = t.match(re)
    if (m && (at === -1 || m.index < at)) at = m.index
  }
  return at
}

/**
 * 这次说的那几句。砍掉引用块和常见的签名尾巴。
 * 砍完是空的（整封都是引用）就退回原文——**空框比长框坏得多**。
 */
export function saidThisTime(text) {
  const t = String(text || '').replace(/\r/g, '')
  const at = 引用从哪开始(t)
  const head = (at === -1 ? t : t.slice(0, at)).trim()
  return head || t.trim()
}

/** 框里露多少字。再长就该点「展开原文」了。 */
export const GIST_CAP = 240
