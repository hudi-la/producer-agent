import { messageLetters } from '../lib/messageLetters.js'
import ErrorNotice from './ErrorNotice.jsx'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMessages, rewindChat, fetchPursuitDetail } from '../lib/chat.js'
import { useChat } from '../lib/useChat.js'
import { dropFrom } from '../lib/rewind.js'
import { md } from '../lib/when.js'
import { arrivalMail } from '../lib/letter.js'
import MailNotice from './MailNotice.jsx'
import ArrivalLine from './ArrivalLine.jsx'
import { kindOf, judgedText } from '../lib/messageKinds.js'
import SayBubble from './Resay.jsx'
import Veil from './Veil.jsx'

import {
  fetchDeliverables, fetchAttachments, setFinal,
  uploadAttachment, deleteAttachment,
} from '../lib/deliverables.js'
import Dossier from './Dossier.jsx'
import ArtifactEditor from './ArtifactEditor.jsx'
import ArtifactCard from './ArtifactCard.jsx'
// 它写完一封信，对话里那条就渲染成一张信卡——点一下落进右栏产出。
import LetterCard from './LetterCard.jsx'
// 它填的是一张申请表——同一个路子，收进产出之后一格一格改。
import FormCard from './FormCard.jsx'
import StateMoveCard from './StateMoveCard.jsx'
import MemoCard from './MemoCard.jsx'
import { heldLabel, useProfile } from '../lib/profile.js'
import { onPulse } from '../lib/pulse.js'
import DeskToggle from './DeskToggle.jsx'
import { useModules } from '../lib/ModulesContext.jsx'
import { useGrow } from '../lib/useGrow.js'
// 搬去 components/Md.jsx 了 —— 名片那边也要用同一份，抄两遍迟早会分叉
// （已经分叉过一次：名片上的粗体渲成了四个星号）。
import Md from './Md.jsx'
import { t } from '../i18n/index.js'

const STAGE_LABELS = {
  pending: t('新机会'), matching: t('匹配项目'), writing: t('一起写'), sent: t('发出&提交'),
  replying: t('进一步'), won: t('谈成'), paused: t('暂停处理'), watch: t('持续关注'),
}
const STAGE_ORDER = ['pending', 'matching', 'writing', 'sent', 'replying', 'won', 'paused', 'watch']

const srcLabel = (s) => (s === 'manual' ? t('你丢的') : 'scout')
const PAYOFF = { paid: t('给钱'), access: t('给圈子'), both: t('钱 + 圈子') }

function Facts({ p }) {
  const profile = useProfile()
  const stars = p.match_stars ? '★'.repeat(p.match_stars) : null
  return (
    <div className="pfacts">
      {p.kind && <span className="pf"><i>{t('类型')}</i>{p.kind}</span>}
      {p.opens_at && <span className="pf"><i>{t('开放')}</i>{p.opens_at}</span>}
      {p.deadline && <span className="pf warn"><i>{t('截止')}</i>{p.deadline}</span>}
      {p.org && <span className="pf"><i>{t('机构')}</i>{p.org}</span>}
      {p.location && <span className="pf"><i>{t('地点')}</i>{p.location}</span>}
      {p.funding && <span className="pf"><i>{t('资助')}</i>{p.funding}</span>}
      {/* 从卡面撤下来的——它是决定要不要推的依据，该在这儿而不是天天占卡上一行 */}
      {p.payoff && <span className="pf"><i>{t('回报')}</i>{PAYOFF[p.payoff] || p.payoff}</span>}
      {stars && <span className="pf"><i>{t('匹配')}</i>{stars}</span>}
      <span className="pf"><i>{t('来源')}</i>{srcLabel(p.source)}</span>
      <span className="pf"><i>{t('主打作品')}</i>{p.work_title || t('待定')}</span>
      {p.url && <a className="pf pf-a" href={p.url} target="_blank" rel="noreferrer"><i>{t('链接')}</i>{t('官方页面 ↗')}</a>}
      {!p.eligible && <span className="pf held">{heldLabel(profile)}</span>}
    </div>
  )
}

// 截止并进卡头，跟球权站一起：一个是这条线唯一的死线，一个是它唯一的开关。
// 原来截止在左边的事实堆里、球权在卡头，两个要害分在两处；而且球权还出现过两次
// （左栏那份是只读副本），人会以为是两件事。
function Deadline({ p }) {
  const raw = p.deadline_at || p.deadline
  if (!raw) return null
  // 按日历天算，不按 24 小时算。截止在明天，就该说「剩 1 天」——
  // 用毫秒差去 ceil 的话现在是下午就会说成 2 天，多给你一天不存在的余地。
  let left = null
  if (p.deadline_at) {
    const d = new Date(p.deadline_at + 'T00:00:00')
    if (!Number.isNaN(+d)) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      left = Math.round((d - today) / 86400000)
    }
  }
  const urgent = left != null && left <= 14
  return (
    <span className={'dl' + (urgent ? ' urgent' : '')}>
      <i>{t('截止')}</i><b>{raw}</b>
      {left != null && <em>{left < 0 ? t('已过') : left === 0 ? t('今天') : t('剩 {n} 天', { n: left })}</em>}
    </span>
  )
}

/**
 * 一封信在对话流里的样子：谁、哪天、头一段，可以就地展开原文。
 *
 * ══ 为什么信要跟对话长得不一样 ═══════════════════════════════
 *
 * 信本来就在对话流里（按时间穿插），但它渲染成一个普通气泡，跟 Fairwind
 * 说的话、你说的话混在一起。你翻这条线的时候，看不出哪一句是**真发生过的
 * 往来**、哪一句是你俩在商量。
 *
 * 而信往往很长（Gmail 把整封旧信引在下面），铺开会把商量的部分挤没。
 * 所以：**收起来只露头一段，要看原文点一下**。
 *
 * ══ 头一段不叫模型摘 ═════════════════════════════════════════
 *
 * 按信数花钱违反「量锁在对象数上」那条规矩；更要紧的是模型摘的那句
 * **会跟原文分叉**，而原文就在一个「展开」的距离。截原文头一段，
 * 最坏是截得不好看，永远不会是假的。
 *
 * ══ 不新造一条「告知」消息 ═══════════════════════════════════
 *
 * 0030 当年设计的是「收信顺手落一条 Fairwind 的告知」。第一版真那么干了，
 * 造了 805 行 —— 结果每封信在对话里出现两次：信一次、告知一次，
 * 展开原文再一次。**信本来就在流里**，要的只是让它长得不一样。撤了。
 *
 * 设计稿：docs/specs/2026-08-19-a-letter-announces-itself.md
 */

function Message({ m, msgs, editing, canEdit, onStartEdit, onCancelEdit, onResay, owner, onAdopted, items, editorOpen }) {
  // 备注不是谁在说话。role='note' 是这条线上的一笔记录（线下发生的事、一个决定），
  // 原来它也走「其余一律显示 Fairwind」那条路，于是你自己记的事看起来像 Fairwind 说的。
  // 真信单独一种长相，跟商量分开。见 Letter 上面那段。
  // 「信到了」告知：信本身已经作为一张信卡在对话里了，就不再画影子；找不到那封信才画一条细线。
  if (m.kind === 'arrival') {
    const mail = arrivalMail(m, msgs)
    if (!mail.meta?.notification_excerpt && msgs.some((x) => x.id === mail.id && x.kind === 'email')) return null
    return <ArrivalLine m={mail} />
  }
  if (m.kind === 'email') {
    return <MailNotice m={m} />
  }
  if (m.role === 'note') {
    return (
      <div id={'msg-' + m.id} className={'notecard' + (kindOf(m) === 'decision_fw' ? ' judged' : '')}>
        <span className="ntag">{kindOf(m) === 'decision_fw' ? t('Fairwind 的判断') : m.kind === 'decision' ? t('决定') : m.kind === 'memo' ? t('记忆') : m.kind === 'meet' ? t('见面') : t('备注')}</span>
        <div className="md"><Md>{kindOf(m) === 'decision_fw' ? judgedText(m, (w) => t('凭什么：{why}', { why: w })) : m.content}</Md></div>
      </div>
    )
  }
  if (m.kind === 'brief') {
    return (
      <div className="msg-row">
        <div className="briefcard">
          <div className="byline"><span className="pdot" aria-hidden="true" /><span className="pname">Fairwind <span>· {t('讲懂这个机会')}</span></span></div>
          <div className="md"><Md>{m.content}</Md></div>
        </div>
      </div>
    )
  }
  if (m.kind === 'draft') {
    return (
      <div className="msg-row">
        <div className="draftcard">
          <div className="draft-top"><span className="pname">{t('草稿')}</span><span className="lang">EN</span></div>
          <div className="draft-body md"><Md>{m.content}</Md></div>
        </div>
      </div>
    )
  }
  // 谁在说话，得说准。
  //
  // 原来只分两类：artist 显示「你」，**其余一律显示 Fairwind**。于是库里 10 封
  // role='org' 的机构来信在界面上全挂着 Fairwind 的名字——Kirk 说的、Sarah 说的、
  // CultureHub 的正式邀请，看起来都像是 Fairwind 说的。这是在骗人。
  const mine = m.role === 'artist'
  const external = m.role === 'org'
  const who = mine ? t('你') : external ? (m.meta?.from_name || t('对方')) : 'Fairwind'
  // 群发的那句要标明是群发的。不标的话，半年后你翻回这条线看见自己说
  // 「帮我起一封信问问日程」，会以为当时专门为这家想过——其实那是一句群发。
  const bc = m.meta?.broadcast
  return (
    <div id={'msg-' + m.id} className={'msg' + (mine ? ' you' : external ? ' org' : ' producer')}>
      <span className="who">{external ? <Veil>{who}</Veil> : who}{m.kind === 'email' && <span className="viamail"> · {t('邮件')}</span>}
        {bc && <span className="viamail">{t(' · 同时发给了 {n} 条线', { n: bc.count })}</span>}
      </span>
      {/* 你自己说的那句能改了重说；别人的（它的回复、机构来信）不能——
          改别人说过的话是伪造记录，不是「重说」。 */}
      {mine ? (
        <SayBubble
          m={m} msgs={msgs} editing={editing} disabled={!canEdit}
          onStart={onStartEdit} onCancel={onCancelEdit} onResay={onResay}
        />
      ) : (
        <div className="bubble md"><Md>{messageLetters(m).clean}</Md></div>
      )}
      {/* 它写的是一封信 —— 紧跟在气泡后面摆一张卡，点一下就落进右栏产出。
          在这之前这封信只能靠你选中、复制、切去 Gmail 粘贴。 */}
      {messageLetters(m).letters.map(({ letter, index }) => (
        <LetterCard
          key={index} letter={letter} artifactIndex={index}
          owner={owner} onAdopted={onAdopted} messageId={m.id} items={items} editorOpen={editorOpen}
        />
      ))}
      {/* 它填的是一张申请表 —— 一格一个字数上限，那些上限就是这张卡的意义。
          复制走的话上限会丢，你到提交前一刻才发现某格超了。 */}
      {m.meta?.form && (
        <FormCard form={m.meta.form} owner={owner} onAdopted={onAdopted} messageId={m.id} items={items} editorOpen={editorOpen} />
      )}
      {/* 它在聊天里改了提醒（0123）—— 出现的时候已经改完了，卡上只有【撤回】。
          只画落上了的（applied）：没落上的，日志里有原因，界面不画一张骗人的卡。 */}
      {(m.meta?.state_move?.applied || m.meta?.state_move?.proposed) && (
        <StateMoveCard msgId={m.id} move={m.meta.state_move} owner={owner} onUndone={onAdopted} />
      )}
      {m.meta?.memo?.applied && (
        <MemoCard msgId={m.id} memo={m.meta.memo} />
      )}
    </div>
  )
}

// 整页里，邮件在左栏卷宗，中栏只留这一条锚点。
// 它必须留——时间线上「这天来了一封信」是叙事的一部分，抽掉了对话就断了。
function MailAnchor({ m, onJump }) {
  const d = m.created_at ? new Date(m.created_at) : null
  const when = d && !Number.isNaN(+d) ? `${d.getMonth() + 1}/${d.getDate()}` : ''
  const mine = m.role === 'artist'
  return (
    <div id={'msg-' + m.id} className="mailanchor">
      <b>{when}</b> {mine ? t('你发了一封') : <><Veil>{m.meta?.from_name || t('对方')}</Veil>{t('来信')}</>}
      <button className="lnk" onClick={() => onJump?.(m.id)}>{t('看左栏 ↖')}</button>
    </div>
  )
}

// 已经被搬进右栏产出的那版草稿，这儿只留一条线索。
// 不是删——原文一个字没动，还在库里，也还在右栏那份产出的正文里。
// 只是同一段话在一屏上出现两次，人会以为是两份东西。
function PromotedAnchor({ m, title }) {
  const d = m.created_at ? new Date(m.created_at) : null
  const when = d && !Number.isNaN(+d) ? `${d.getMonth() + 1}/${d.getDate()}` : ''
  return (
    <div id={'msg-' + m.id} className="mailanchor">
      <b>{when}</b> {t('Fairwind 起了一版 → 成了右栏的《{title}》', { title })}
    </div>
  )
}

function emptyText(stage) {
  // 新机会的卡本该在后台就读透了。还空着 = 脑子没开，或刚进来还没轮到。
  if (stage === 'pending') return t('Fairwind 还没读这条——稍等一会儿就有了。')
  if (stage === 'matching') return t('你批准了——接下来我们一起挑用哪件作品，再往下写。')
  return t('这条机会线还没有往来。我这就开始。')
}

// 两种装法，同一套内容：
//   drawer —— 从右边划出来盖在看板上，看板还在旁边，可以一张接一张点过去
//   page   —— 整页。只在工作区里出现：桌上那格（?p=<id> 不带 d=1 落地的
//              就是它），留给你要长时间写东西的时候
// 现在两者装的东西一样，只差宽度。等作品链、文档、邮件单独成栏做出来，
// 整页才会长出抽屉装不下的部分。
export default function PursuitFocus({
  onOpenPerson,
  pursuit: p, messages, variant = 'page', onBack, onMove,
  // 抽屉头上那颗开关：这张在不在桌上（见 DeskToggle）。
  onDesk = false, onToggleDesk,
  // 健康检查只影响连接提示，不能改变发送意图。
  brainUp = true,
}) {
  const inDrawer = variant === 'drawer'
  const mods = useModules()   // 「展开的卡片」区跟邮件一起开,那颗开关也跟着
  // 说话那一整套（发、边想边出字、重说、终止）在 useChat 里，跟档案里那张
  // 书桌共用同一份 —— 照抄两份的话，出错那几条路迟早只修好一边。
  // 这一页多出来的东西（笔卡、信卡、邮件锚点、stalled、stoppedId）留在这儿。
  const chat = useChat({
    owner: p.id,
    reload: () => fetchMessages(p.id),
    rewind: rewindChat,

  })
  const { msgs, setMsgs, text, setText, err, setErr, editId, setEditId, live, act, runIdRef } = chat
  const thinking = chat.busy
  // （正在就地改的那一句也在 chat 里。库里还什么都没动——见 Resay.jsx 顶上那段。）
  const [stage, setStageLocal] = useState(p.stage)
  // 球权本地先动，写库由 App 负责回滚。装的是「球在谁那边」这个答案本身，
  // 不是「你有没有手动改过」——后者不是你要看的东西。

  // 匹配理由和关系记忆。看板不再搬这两段长文（0115：72 张卡每次都搬，
  // 占看板下载量一半，而卡片一个字都不显示），改成打开哪一张才拉哪一张。
  // 拉到之前、以及拉不到时，退回 p 上那份 —— 没连库时它来自种子数据。
  const [detail, setDetail] = useState(null)
  useEffect(() => {
    let alive = true
    setDetail(null)
    fetchPursuitDetail(p.id).then((d) => { if (alive && d) setDetail(d) })
    return () => { alive = false }
  }, [p.id])
  const why = detail?.why ?? p.why
  const notes = detail?.notes ?? p.notes

  // 这儿原来还有「现在该干什么」和「Fairwind 提的、你还没认的那句」。
  // 两样都删了：写 next_action 的那个消化环节早就不在了，留着就是一行
  // 永远不会更新的字。要不要重做那套是另一场讨论。
  // 见 docs/specs/2026-08-12-four-signals-design.md

  const endRef = useRef(null)
  const scrollRef = useRef(null)    // 对话那一栏本体，用来判断你是不是贴着底在看
  // 你是不是贴着底。贴着才跟着新内容往下走；你往上翻去看旧的，就别再拽你。
  //
  // 原来是无条件跟：它一边出字，页面一边往下拽，你想回头看上一段根本按不住。
  // 出字那一轮一秒好几帧，等于每秒被拽好几次。
  const stick = useRef(true)
  const taRef = useRef(null)        // 输入框本体，用来按内容撑高
  // 三栏只给整页。抽屉窄，塞不下卷宗和产出，保持单栏不动。
  const threeCol = !inDrawer
  const [deliv, setDeliv] = useState([])
  const [artifactId, setArtifactId] = useState(null)
  const [attachment, setAttachment] = useState(null)
  useEffect(() => { setArtifactId(null); setAttachment(null) }, [p.id])
  const selectedArtifact = deliv.find(d => d.id === artifactId)
  const [atts, setAtts] = useState([])

  // 「在想」不能靠猜。
  //
  // 原来的判断是「最后一条是你发的 = 它欠你一条回复」，于是只要有一次没想完
  // （脑子崩了 / 超时 / 你关了页面），那条线就永远显示三个点——而且输入框跟着
  // 永久禁用，你连再说一遍都做不到，整条线就此锁死。三个点是猜的，不是真有东西在跑。
  //
  // 现在：只有「刚发出去、还在合理等待窗口内」才算在想。超过这个窗口就承认
  // 它没回，把输入框还给你。另外限定 kind='message'——你发给机构的真实邮件
  // （role='artist', kind='email'）不是在跟 Fairwind 说话，不该触发「在想」。
  // 你按过终止的那条：别再等它的回复了，回复不会来了。
  // 不写这个的话，终止完输入框还得按上面那个 3 分钟窗口干等——你正是急着改字才按的停。
  const [stoppedId, setStoppedId] = useState(null)
  const STALE_MS = 3 * 60 * 1000   // 联网研究最久见过 30–60 秒，3 分钟还没回就是死了
  const lastMsg = msgs.length ? msgs[msgs.length - 1] : null
  const awaiting = !!lastMsg && lastMsg.role === 'artist' && (lastMsg.kind || 'message') === 'message'
    && lastMsg.id !== stoppedId
  const waitedMs = awaiting && lastMsg.created_at
    ? Date.now() - new Date(lastMsg.created_at).getTime()
    : 0   // 乐观插入的临时消息还没有 created_at，当作刚发出
  const busy = thinking || (awaiting && waitedMs < STALE_MS)
  const stalled = awaiting && !thinking && waitedMs >= STALE_MS

  // 换一条线：先用手上的，再从库里拉最新（别的地方写进来的卡也能看见）。
  // 「讲懂」不在这儿触发了——脑子在后台把新机会的卡先读好，你点开时它已经在库里。
  useEffect(() => {
    let alive = true
    setMsgs(messages || [])
    setStageLocal(p.stage)
    setErr(null)
    setEditId(null)   // 换了条线，上一条上改到一半的那句跟着收掉
    fetchMessages(p.id).then((rows) => {
      if (alive && rows) setMsgs(rows)
    })
    return () => { alive = false }
  }, [p.id])

  // 你滚一下我就记一下：离底还有多远。120px 是「基本贴着」的宽容度——
  // 要求分毫不差贴底的话，一点惯性余量就会被判成「你在往上看」。
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }, [])

  // 换一条线：重新贴底（新开一张卡当然从最新那条看起）。
  useEffect(() => { stick.current = true }, [p.id])

  useEffect(() => {
    if (stick.current) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [msgs.length, thinking])

  // 出字期间单独跟一下底。不能用 smooth——一秒好几帧的平滑滚动会打架，
  // 页面抖得没法读。这里要的是「一直贴着底」，不是动画。
  //
  // 而**你往上翻走了就一下都不跟**。它出字那一轮一秒好几帧，无条件跟的话
  // 等于每秒把你拽回底部好几次，你想回头看上一段根本按不住。
  useEffect(() => {
    if (live && stick.current) endRef.current?.scrollIntoView({ block: 'end' })
  }, [live])

  // 输入框按内容长高（往上长）。跟名片那边同一份 —— 见 lib/useGrow.js。
  useGrow(taRef, text)

  // 产出和附件。只有整页要，抽屉不拉——省一次往返。
  async function reloadDeliv() {
    const [d, a] = await Promise.all([fetchDeliverables(p.id), fetchAttachments(p.id)])
    if (d) setDeliv(d)
    if (a) setAtts(a)
  }
  useEffect(() => {
    // 这儿原来还有一句 setSyncNote(null)。收信搬去 mail/loop.js 之后
    // syncing/doSync/syncNote 三样都撤了，**唯独这句漏删**——于是详情页
    // 一打开就 ReferenceError 崩掉，整页白。删掉。
    setDeliv([]); setAtts([])
    reloadDeliv()
    // 原来这儿每 5 秒硬拉一遍（产出带全文 + 附件），一小时一千四百多趟，
    // 绝大多数趟什么都没变。现在只认 deliv 那一列：产出/附件真变了才拉。
    return onPulse('deliv', reloadDeliv)
  }, [p.id, threeCol])

  // 取消定稿：左栏那份退回右栏接着改。改的还是同一份，不生第二个版本。
  async function unfinal(id) {
    try { await setFinal(id, false); await reloadDeliv() } catch (e) { setErr(e.message) }
  }

  // ── 卡上的文件 ────────────────────────────────────────────────
  // 传完立刻重拉一次，不做乐观更新：这儿的「成功」是两步（字节 + 登记），
  // 乐观更新就得自己编一行假的，编出来的那行跟库里对不上就是在骗自己。
  async function addFile(file) {
    await uploadAttachment(p.id, file)
    await reloadDeliv()
  }

  // 附件复用文档抽屉；保持已挂载的编辑器，关闭预览后恢复未保存内容。
  function openFile(a) {
    setAttachment(a)
  }

  async function dropFile(a) {
    try { await deleteAttachment(a.id); await reloadDeliv() } catch (e) { setErr(e.message) }
  }

  // 两个方向的跳：产出/卷宗 → 中栏那一句；中栏的锚点 → 左栏那封信
  function flashTo(domId) {
    const el = document.getElementById(domId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('flash')
    setTimeout(() => el.classList.remove('flash'), 1600)
  }
  const jumpTo = (msgId) => flashTo('msg-' + msgId)
  const jumpMail = (msgId) => flashTo('dmail-' + msgId)

  // 实时兜底：开着这条线时跟着脉搏拉库。 Fairwind 在后台想完的回复会自动出现——
  // 你不必守着这个页面。离开再回来也一样，因为回复本就落在库里，不在你的屏幕上。
  //
  // 原来是每 3 秒硬拉一遍——这条线的**全部往来连邮件原文**，一小时一千二百趟，
  // 一天几个 GB，是这次流量打爆的最大头。整包的形状没改（原文照样在），
  // 改的是趟数：thread 那一列动了，才来真拉这一趟。
  useEffect(() => onPulse('thread', async () => {
    const rows = await fetchMessages(p.id)
    if (!rows) return
    setMsgs((cur) => {
      const tmp = cur.filter((m) =>
        typeof m.id === 'string' && m.id.startsWith('tmp') &&
        !rows.some((r) => r.role === m.role && r.content === m.content))
      const next = [...rows, ...tmp]
      if (next.length === cur.length && next[next.length - 1]?.id === cur[cur.length - 1]?.id) return cur
      return next
    })
  }), [p.id])

  // 说一句。真正的那一套在 useChat 里；这儿只加这一页专有的两件事：
  //   · 你自己开口 = 你要看它回什么，所以不管刚才翻到哪儿，这一下重新贴底
  //   · 终止了要把「这条就停在这儿」记下来，好让 stalled 那句话不冤枉它
  async function send(said) {
    stick.current = true
    const r = await chat.send(said)
    if (r?.aborted && r.you) setStoppedId(r.you.id)
    return r
  }

  const resay = chat.resay

  async function stop() {
    if (lastMsg) setStoppedId(lastMsg.id)
    await chat.stop()
  }

  // 哪些消息已经被搬进右栏当产出了（deliverables.source_msg 指着它）
  const promotedFrom = new Map(
    deliv.filter((d) => d.source_msg).map((d) => [d.source_msg, d.title])
  )

  // 中栏那一整块：往来时间线 + 输入框。三栏和抽屉装的是同一份内容，
  // 只是三栏把它塞进中间那格，抽屉直接铺满。
  const body = (
    <>
      <div className="focus-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="focus-inner">
          <div className="fh">
            {/* 整页时事实搬去了左栏卷宗，这儿不再重复一遍；抽屉没有卷宗，照旧显示 */}
            {!threeCol && <Facts p={p} />}
            {!threeCol && <details><summary>{t('附件')} · {atts.length}</summary>
              {atts.map(a => <button className="b" key={a.id} onClick={() => openFile(a)}>{a.filename}</button>)}
            </details>}
            {/* 「下一步」那一套（做完了 / 作废了 / 已碰过）都撤了：
                写它的消化环节早就没了，留着就是三行永远不会更新的字。
                库里字段没删——以后要不要重做那套是另一场讨论。 */}
            {/* why / notes 库里存的就是 markdown（带加粗、按行分段），
                原来直接当纯文本塞进 <p>，所以星号露在外面、几行被压成一坨。 */}
            {why && <div className="pf-why md"><Md>{why}</Md></div>}
            {notes && <div className="pf-notes md"><Md>{notes}</Md></div>}
          </div>

          {deliv.filter(d => !d.meta?.artifact_message_id && d.status === 'draft').map(d =>
            <ArtifactCard key={d.id} existing={d} editorOpen={!!selectedArtifact || !!attachment} owner={{ pursuitId: p.id }}
              onAdopted={async id => { await reloadDeliv(); if (id) setArtifactId(id) }} />)}
          {msgs.length === 0 && !busy ? (
            <div className="empty-thread">{emptyText(p.stage)}</div>
          ) : (
            <div className="thread">
              {/* 整页里邮件不进这条流——它在左栏卷宗。这儿只留一条极轻的锚点，
                  点它跳到左边那封。信一封不少，只是待在它该待的地方。 */}
              {msgs.map((m, i) => {
                if (threeCol && m.kind === 'email') {
                  return <MailAnchor m={m} key={m.id || i} onJump={jumpMail} />
                }
                const promoted = threeCol && promotedFrom.get(m.id)
                if (promoted) return <PromotedAnchor m={m} title={promoted} key={m.id || i} />
                return (
                  <Message
                    m={m} msgs={msgs} key={m.id || i}
                    owner={{ pursuitId: p.id }}
                    items={deliv} editorOpen={!!selectedArtifact || !!attachment} onAdopted={async (id) => { await reloadDeliv(); if (id) setArtifactId(id) }}
                    editing={editId === m.id}
                    /* 在想的时候不给改：那会撤掉一条它还在写的回复 */
                    canEdit={!busy}
                    onStartEdit={setEditId}
                    onCancelEdit={() => setEditId(null)}
                    onResay={resay}
                  />
                )
              })}
              {/* 没在想、又确实欠着一条回复——说实话，别拿三个点糊弄过去 */}
              {stalled && (
                <div className="stalled">
                  {t('Fairwind 没回这条（多半是当时脑子没开，或者那次想崩了）。')}
                  <b>{t('再说一次就行')}</b>{t('——它带着这条线的全部往来，你不用重讲。')}
                </div>
              )}
              {/* 已经在出字了就直接渲染成气泡，一行一行看着它想；还没出字
                  （多半在查资料）才是三个点，旁边说清楚它在动什么。
                  这段字还没落库，最后会被库里那条正式的换掉。 */}
              {busy && (
                <div className="msg producer">
                  <span className="who">Fairwind</span>
                  {live ? (
                    <div className="bubble md streaming"><Md>{live}</Md></div>
                  ) : (
                    <div className="bubble thinking"><i /><i /><i /></div>
                  )}
                  {act && !live && <span className="thinking-act">{act}</span>}
                </div>
              )}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {err && <ErrorNotice error={err} context={t('Fairwind 对话')} />}
      {/* 一个框两种落法（0125）：脑子醒着 = 聊天，Fairwind 顺便判该记成什么；
          脑子没开 = 直接记成一笔。「记一笔」按钮退场了。 */}
      <div className="composer-dock">
      <div className="composer">
        {/* textarea 而不是 input：一行装不下就自己长高（上限在 CSS 的 max-height，
            到顶了才开始滚）。Enter 发送，Shift+Enter 换行。
            isComposing 那句不能删——中文输入法选词时也会敲 Enter，
            不挡的话你选个词就把半句话发出去了。 */}
        <textarea
          aria-label={t("聊天消息")}
          ref={taRef}
          className="ph"
          rows={1}
          value={text}
          disabled={busy}
          placeholder={busy ? t('Fairwind 在想……（想完会自动出现，你不用守着）')
            : !brainUp ? t('连接暂时不可用，可以重试发送；失败会保留你的话')
            : t('一起想点什么…… Fairwind 带着这条线的全部往来，你不用重讲')}
          onChange={(e) => { setText(e.target.value); if (err) setErr(null) }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            send()
          }}
        />
        {busy ? (
          <button className="send stop" aria-label={t('终止')} title={t('终止——停掉 Fairwind 这次的回复')} onClick={stop}>
            <svg width="15" height="15" viewBox="0 0 16 16"><rect x="4.5" y="4.5" width="7" height="7" rx="1.4" fill="#fff" /></svg>
          </button>
        ) : (
          // 必须包一层箭头函数：onClick={send} 会把鼠标事件当第一个参数塞进去，
          // 而 send 的第一个参数现在是「重说」交过来的那句话。
          <button className="send" aria-label={t('发送')} onClick={() => send()} disabled={!text.trim()}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M8 3 4.5 6.5M8 3l3.5 3.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
      </div>
      </div>
    </>
  )

  return (
    <div className={'focus ' + variant}>
      {/* 标题在顶条里，跟着一起钉住——你往下读对话时，「这是哪条线」不该滚走。
          整页一行放得下就一行，放不下截断；抽屉窄，最多两行。 */}
      <div className="focus-top">

        {/* 「有新信」那条横幅删了。新消息只有一种说法：小红点 + 那封信
            自己躺在对话流里。专门再报一遍，报的还是「这条线最后一封」而不是
            「新」——三周前那封会天天挂在头上说自己新。 */}

        {/* 「现在该干什么」那一块删了。系统不再替你判这事该不该动——
            你觉得该动，点亮上面那个「待处理」标签。 */}

        <div className="ft-head">
          {inDrawer ? (
            <button className="back" onClick={onBack} aria-label={t('收起')} title={t('收起')}><span aria-hidden="true">✕</span><span className="t"> {t('收起')}</span></button>
          ) : (
            <button className="back" onClick={onBack}><span aria-hidden="true">←</span> {t('看板')}</button>
          )}
          <h1 className="ft-title" title={p.title}>{p.title}</h1>
          {/* 「整页 →」退役了。整页只在工作区里有，去工作区的路是这颗开关 + 顶栏那个字。 */}
          {inDrawer && mods.mail && <DeskToggle on={onDesk} onToggle={onToggleDesk} />}
        </div>
        <div className="ft-ctl">
        <Deadline p={p} />
        <label className="stg-lbl">{t('阶段')}
          <select
            className="stg-sel"
            value={stage}
            onChange={(e) => { setStageLocal(e.target.value); onMove?.(p.id, e.target.value) }}
          >
            {STAGE_ORDER.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
        </label>
        </div>
      </div>

      {threeCol ? (
        <div className={"focus-cols" + (selectedArtifact || attachment ? "" : " without-editor")}>
          <aside className="fc-l">
            <Dossier
              p={p}
              msgs={msgs}
              files={deliv.filter((d) => d.status === 'final')}
              attachments={atts}
              onUnfinal={unfinal}
              onJump={jumpTo}
              onUpload={addFile}
              onOpenFile={openFile}
              onDeleteFile={dropFile}
              onOpenPerson={onOpenPerson}
            />
          </aside>
          <div className="fc-m">{body}</div>
          {selectedArtifact && <ArtifactEditor key={selectedArtifact.id} d={selectedArtifact} hidden={!!attachment}
            onChanged={reloadDeliv} onClose={() => setArtifactId(null)} />}
          {attachment && <ArtifactEditor key={attachment.id} attachment={attachment} onClose={() => setAttachment(null)} />}

        </div>
      ) : <>{body}{selectedArtifact && <ArtifactEditor key={selectedArtifact.id} d={selectedArtifact} hidden={!!attachment}
        onChanged={reloadDeliv} onClose={() => setArtifactId(null)} />}
          {attachment && <ArtifactEditor key={attachment.id} attachment={attachment} onClose={() => setAttachment(null)} />}</>}
    </div>
  )
}
