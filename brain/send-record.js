// 一封信发出去之后，账怎么记。
//
// 单独拆出来只有一个理由：server.js 顶层就 server.listen()，`import` 一下服务
// 就起来了，于是「顺序对不对」这件事一行测试都写不了。prompt.js 当初也是
// 为这个搬出去的。
//
// ══ 顺序不是风格问题 ══════════════════════════════════════════
// **先记账，后删产出。**
//
// 反过来的话，中间任何一步失败都会两头空：信已经发出去了、产出没了、往来里
// 也没有。那时候这封信在这个系统里等于**从来不存在**——而它已经躺在别人的
// 收件箱里了。这是这套东西能犯的最严重的错。
//
// 所以下面每一步失败都直接抛，后面的一步都不走。抛出去之后产出原样留着，
// 你至少还看得见那份稿子，知道刚才发的是什么。
//
// ══ 去重不用另写 ══════════════════════════════════════════════
// pa_add_mail 拿 gmail_message_id 做唯一约束。下次全局同步从「已发送」里
// 再收到这封时会 on conflict do nothing 撞掉，不会在往来里出现两条。

/**
 * 往来里那行摘要绝不能是空的。
 *
 * 模型给了就用它的（它刚写完这封信，最清楚在说什么，事后再花一次模型去
 * 总结自己写的东西是白花）；没给就退回正文首段——这是 pa_add_mail 一贯的
 * 兜底方式。两个都没有才用那句最没信息量的，但至少不是一行空白：
 * 空白在界面上跟「这条信没有内容」长得一模一样。
 */
const oneLine = (summary, body) => {
  const s = String(summary || '').trim()
  if (s) return s
  const first = String(body || '').split(/\n\s*\n/)[0].trim()
  return first || '（发了一封信）'
}

const call = async (db, fn, args, what) => {
  const { error } = await db.rpc(fn, args)
  if (error) throw new Error(`${what}：${error.message}`)
}

export async function recordSent(db, {
  ownerKind, ownerId, deliverableId, sent, to, cc, from, subject, summary, body, accountId,
  replyTo = null, refs = null, sentAt = null,
}) {
  const when = sentAt || new Date().toISOString()
  const toList = Array.isArray(to) ? to : to ? [to] : []
  const ccList = Array.isArray(cc) ? cc : cc ? [cc] : []
  if (!toList.length) throw new Error('记账时没有收件人——这封信记进去也认不出是给谁的')

  // 「对面是谁」只能有一个（pa_add_mail 靠它把这封信归到某个人名下，见 0038）。
  // 一封回给三个人的信，主要那个就是 To 里第一个——那是你回信的对象，
  // 其余是捎带上的。挑错了的后果是这封信挂到旁人名下，所以宁可写死这条规矩，
  // 也不让它去猜「谁更重要」。
  const counterpart = toList[0]

  // ① 往来里那一条。人的归属由 pa_add_mail 按地址自己算（0038），
  //    机会线要显式给 pursuit_id。
  await call(db, 'pa_add_mail', {
    p_gmail_message_id: sent.id,
    p_counterpart: counterpart,
    p_role: 'artist',
    p_content: oneLine(summary, body),
    p_body_raw: body,
    ...(ownerKind === 'pursuit' ? { p_pursuit_id: ownerId } : {}),
    p_meta: { subject, to: toList, ...(ccList.length ? { cc: ccList } : {}), sent_from: 'fairwind' },
  }, '记账没成')

  // ② 信头。**不能等下次同步再补**——0055 靠 message_id / in_reply_to / refs
  //    认亲，这中间对方要是回得快，那封回信就找不到自己的线。
  await call(db, 'pa_mail_headers_upsert', {
    p_rows: [{
      gmail_message_id: sent.id,
      account_id: accountId,
      gmail_thread_id: sent.threadId,
      from_email: from,
      to_emails: toList,
      cc_emails: ccList,
      subject,
      sent_at: when,
      counterpart_email: counterpart,
      direction: 'out',
      message_id: sent.messageId,
      in_reply_to: replyTo,
      refs: refs || [],
    }],
  }, '记信头没成')

  // ③ 认领这串往来：下次同步跟着它走。
  //    Gmail 没回 threadId 就跳过——认领一个空串比不认领更坏。
  if (sent.threadId) {
    await call(db,
      ownerKind === 'contact' ? 'pa_claim_contact_thread' : 'pa_link_thread',
      ownerKind === 'contact'
        ? { p_contact_id: ownerId, p_thread_id: sent.threadId }
        : { p_pursuit_id: ownerId, p_thread_id: sent.threadId, p_added_by: 'fairwind' },
      '认领往来没成')
  }

  // ④ 到这一步账才算记全了，产出可以消失。
  //    产出 =「还没交出去的东西」；交出去了就不属于这儿，它成了左栏往来里
  //    一条真信。这样产出栏永远只剩「欠着的」，一眼就知道还欠什么。
  await call(db, 'pa_delete_deliverable', { p_id: deliverableId }, '删草稿没成')
}
