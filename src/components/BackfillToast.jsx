// src/components/BackfillToast.jsx —— 第一次连上 Gmail 时,右下角那个「正在整理你的信箱」的小窗。
//
// 样子照 Google Drive 上传文件时右下角那个:一个小动画说「还在弄」,一句话说做到哪了。
// 第一次要把近三年的信过一遍、认出哪些是在跟你谈事的人——要十几分钟,还花模型 token。
// 不说一声,用户看到的是「连上了,可什么都没有」——跟坏了长得一样。
//
// 2026-10-07 他改的口径:只说「已经筛了 N 封信,找到 M 个真人联系人」。
// 别分「搬信 / 认人」两步——那会让人觉得我们把他的信搬来搬去。
// 中途模型额度用完:说清楚,能读出几点重置就说几点;到点脑子自己接着(mail/loop.js 的 st.blocked),不用人管。
// 数据来自脑子的 /health(mail.backfill / judging / found / blocked),页面本来就在问;做完显示一会儿自己收起。
import { useState } from 'react'
import { t } from '../i18n/index.js'

const n = (x) => Number(x || 0).toLocaleString()
// 做完了**不自己消失**(2026-10-08 他说:消失了就不知道成没成功)。按了确认才收,记在这个浏览器里,刷新也不再弹
const SEEN = 'fw.mailDoneSeen'
const seenDone = (k) => { try { return localStorage.getItem(SEEN) === k } catch { return false } }
const markDone = (k) => { try { localStorage.setItem(SEEN, k) } catch {} }

const Ico = ({ children, size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)

function resetLine(b) {
  if (b.kind === 'auth') return t('模型连接失效，邮件筛选已暂停。请到设置重新连接模型。已完成的进度保留，连接恢复后会自动继续。')
  if (b.kind === 'modelerror') return t('模型暂时未能完成筛选。已完成的进度保留，稍后会自动重试；持续失败请检查模型设置。')
  if (b.kind === 'nomodel') return t('信已经在筛了。认出哪些是真人联系人要用模型——你还没接。去「设置」接上，接上后自动接着。')
  if (b.topUp) return t('模型余额用完了。去「设置」换一把 key 或充值，之后会自动接着。')
  const at = b.resetAt ? new Date(b.resetAt) : null
  const when = at ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : (b.resetText || '')
  const sameDay = at && at.toDateString() === new Date().toDateString()
  if (!when) return t('模型额度用完了，等它重置后会自动接着。')
  return (b.guessed ? t('模型额度用完了，大约 {w} 再试，到时自动接着。', { w: when }) : t('模型额度用完了，{d}{w} 重置，到时自动接着。', { w: when, d: sameDay ? '' : t('明天 ') }))
}

export default function BackfillToast({ mail, waiting = 0, onGoPeople, onGoSettings }) {
  const [closed, setClosed] = useState(null)   // 进行中按 × 关掉时的那个状态签名;状态变了再出来
  const b = mail?.backfill, j = mail?.judging, block = mail?.blocked

  const bActive = b && b.phase !== 'done'
  const jActive = j && !j.done
  const doneKey = j?.done ? 'j:' + j.at : b?.phase === 'done' && !j ? 'b:' + b.at : null
  const showDone = !bActive && !jActive && !block && doneKey && !seenDone(doneKey)
  if (!bActive && !jActive && !block && !showDone) return null
  const sig = [b?.phase, j?.done, block?.kind, block?.resetAt, block?.topUp].join('|')
  if (closed === sig) return null
  const confirm = (go) => { markDone(doneKey); setClosed(sig); if (go) onGoPeople?.() }

  const allDone = !bActive && !jActive && !block
  // 筛了几封:搬的时候按搬到哪,搬完按总数
  const screened = b ? (b.phase === 'fetching' ? b.done : b.phase === 'done' ? b.total : b.phase === 'listing' ? 0 : 0) : null
  const found = mail?.found ?? waiting
  const boxes = mail?.foundBoxes || 0
  // 一条进度:前一半是过信,后一半是认人(用户不用知道是两步,只看见在往前走)
  const pb = b?.phase === 'fetching' && b.total ? b.done / b.total : b?.phase === 'done' || !b ? 1 : 0
  const pj = j?.total ? (j.total - (j.left || 0)) / j.total : j?.done ? 1 : 0
  const pct = Math.round((pb * 0.5 + pj * 0.5) * 100)

  const line = allDone
    ? (found + boxes === 0 ? t('信收完了，这次没找到新的联系人。')
      : screened ? t('筛了 {s} 封信，找到 {m} 个真人联系人、{b} 个机构信箱。', { s: n(screened), m: n(found), b: n(boxes) })
      : t('信收完了，找到 {m} 个真人联系人、{b} 个机构信箱。', { m: n(found), b: n(boxes) }))
    : screened
      ? (j ? t('已经筛了 {s} 封信，找到 {m} 个真人联系人', { s: n(screened), m: n(found) }) : t('已经筛了 {s} 封信', { s: n(screened) }))
      : j ? t('还有 {n} 个地址等着认出是谁', { n: n(j.left) })   // 脑子重启过、筛信那一步的数没留下:说认人这边
      : t('正在打开你的信箱…')

  return (
    <div className="bf-toast" role="status" aria-live="polite">
      <div className="bf-h">
        {allDone ? <span className="bf-ico ok"><Ico size={12}><path d="M20 6 9 17l-5-5" /></Ico></span>
          : block ? <span className="bf-ico wait"><Ico size={12}><path d="M10 4H6v16h4zM18 4h-4v16h4z" /></Ico></span>
          : <span className="spin" />}
        <b>{block?.kind === 'nomodel' ? t('先停一下：还没接模型') : block?.kind === 'auth' ? t('筛选暂停：模型连接失效') : block?.kind === 'modelerror' ? t('筛选暂停：模型出错') : block ? t('先停一下：模型额度用完了') : allDone ? t('收完信了') : t('还在整理你的信箱…')}</b>
        <button className="bf-x" onClick={() => (allDone ? confirm(false) : setClosed(sig))} aria-label={t('关掉')}><Ico><path d="M18 6 6 18M6 6l12 12" /></Ico></button>
      </div>
      {!allDone && <div className="bf-bar"><i style={{ width: `${Math.max(3, pct)}%` }} /></div>}
      <p>{line}</p>
      {block && <p className="bf-alert">{resetLine(block)}</p>}
      {(['nomodel', 'auth', 'modelerror'].includes(block?.kind) || block?.topUp) && <button className="bf-go" onClick={() => onGoSettings?.()}>{t('去设置 →')}</button>}
      {allDone && (found + boxes > 0
        ? <><p className="bf-sub">{t('去人际管理里一个一个看，要的就加进通讯录。')}</p>
            <button className="bf-ok" onClick={() => confirm(true)}>{t('确认，去看看')}</button></>
        : <button className="bf-ok" onClick={() => confirm(false)}>{t('好')}</button>)}
      {!allDone && !block && <small>{t('只有第一次连上 Gmail 才要这么久。关掉页面也会接着做。')}</small>}
    </div>
  )
}
