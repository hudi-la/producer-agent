import { reportError } from '../lib/reportError.js'
import React, { useEffect, useState } from 'react'
import { replyRecipients, setRecipients } from '../lib/letters.js'
import Veil from './Veil.jsx'

// 这封信到底发给谁 —— 一份摆全了的名单，你自己勾。
//
// ══ 为什么必须有这个东西 ══════════════════════════════════════
// 2026-08-18 第一次真用直发就撞墙了：Huntington 那封该回给**两个人**，
// 而界面上只有模型挑出来的一个地址、抄送一个字都没有。于是那封信没法
// 按下去——「我不确定是几个人」。**看不全 = 不敢发**，功能等于没做。
//
// ══ 名单从账本算，不问模型 ════════════════════════════════════
// 原信的 from / to / cc 都在 mail_headers 里躺着（0070）。这跟 0060
// 「找信是机械活，一次模型都不该花」是同一条，而且更硬：找信找漏了还能
// 再找一次，**收件人猜错了是撤不回来的**。
//
// ══ 默认只勾发件人 ════════════════════════════════════════════
// 其余的（原信另外的收件人、抄送）**列出来但不勾**。多发给一个人比少发给
// 一个人难收场，所以默认取安全那边；但一个都不许藏起来——藏起来就又回到
// 「不确定是几个人」那个状态了。
const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x))

export default function Recipients({ d, onChanged, onErr }) {
  const [book, setBook] = useState(null)     // 账本算出来的名单
  const [busy, setBusy] = useState(false)
  const replyTo = d.meta?.reply_to || null

  // 存着的那份（老产出里是单个字符串，两种都认）
  const savedTo = (Array.isArray(d.meta?.to) ? d.meta.to : d.meta?.to ? [d.meta.to] : [])
  const savedCc = Array.isArray(d.meta?.cc) ? d.meta.cc : []

  useEffect(() => {
    let dead = false
    if (!replyTo) { setBook(null); return }
    replyRecipients(replyTo)
      .then((r) => { if (!dead) setBook(r) })
      // 没有额外收件人与读取失败分开：失败时提示，避免误以为名单完整。
      .catch((e) => { if (!dead) { setBook(null); reportError(e, t('读取收件人失败')) } })
    return () => { dead = true }
  }, [replyTo])

  async function toggle(addr, inCc) {
    setBusy(true)
    try {
      const on = inCc ? savedCc.includes(addr) : savedTo.includes(addr)
      const nextTo = inCc ? savedTo : on ? savedTo.filter((x) => x !== addr) : [...savedTo, addr]
      const nextCc = inCc ? (on ? savedCc.filter((x) => x !== addr) : [...savedCc, addr]) : savedCc
      await setRecipients(d.id, nextTo, nextCc)
      await onChanged?.()
    } catch (e) { onErr?.(e.message) } finally { setBusy(false) }
  }

  // 账本里还有、但还没勾上的人。这几行是这个组件存在的全部理由。
  const others = (book?.others || []).filter((a) => !savedTo.includes(a) && !savedCc.includes(a))
  const ccLeft = (book?.cc || []).filter((a) => !savedTo.includes(a) && !savedCc.includes(a))

  return (
    <div className="rcp">
      <div className="rcp-h">发给</div>
      <ul className="rcp-list">
        {savedTo.map((a) => (
          <li key={a}>
            <label>
              <input type="checkbox" checked readOnly={savedTo.length === 1}
                disabled={busy || savedTo.length === 1}
                onChange={() => toggle(a, false)} />
              <span><Veil>{a}</Veil></span>
            </label>
            {savedTo.length === 1 && <span className="rcp-m">主要收件人</span>}
          </li>
        ))}
        {savedCc.map((a) => (
          <li key={a}>
            <label>
              <input type="checkbox" checked disabled={busy} onChange={() => toggle(a, true)} />
              <span><Veil>{a}</Veil></span>
            </label>
            <span className="rcp-m">抄送</span>
          </li>
        ))}
      </ul>

      {(others.length > 0 || ccLeft.length > 0) && (
        <>
          {/* 这句话是给你看的凭据：名单是从原信信头里读出来的，不是谁猜的 */}
          <div className="rcp-h2">原信上还有这些人 —— 要一起回就勾上</div>
          <ul className="rcp-list">
            {others.map((a) => (
              <li key={a}>
                <label>
                  <input type="checkbox" checked={false} disabled={busy}
                    onChange={() => toggle(a, false)} />
                  <span><Veil>{a}</Veil></span>
                </label>
                <span className="rcp-m">原信收件人</span>
              </li>
            ))}
            {ccLeft.map((a) => (
              <li key={a}>
                <label>
                  <input type="checkbox" checked={false} disabled={busy}
                    onChange={() => toggle(a, true)} />
                  <span><Veil>{a}</Veil></span>
                </label>
                <span className="rcp-m">原信抄送</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* 查不到要说出来。默默显示成「只有一个收件人」的话，你会以为
          原信上确实只有一个人——那正是这次要治的病。 */}
      {replyTo && book && !book.found && (
        <div className="rcp-warn">
          账本里找不到你回的那封信（{book.why || '可能还没同步到'}），
          所以摆不出原信上还有谁。要回给别人的话，去 Gmail 那边确认一下。
        </div>
      )}
      {!replyTo && (
        <div className="rcp-m">这是新起的一封，不是回信 —— 没有原信名单可对。</div>
      )}
    </div>
  )
}
