import { useEffect, useState } from 'react'
import { stateLine, whyLine } from '../lib/stateText.js'
import { key as qKey } from '../lib/queue.js'
import Veil from './Veil.jsx'

// 顶栏那块通知面板。装的是**所有该动和在等的事** —— 机会线的和人的都在这儿。
//
// 线和人原来是分家的（人的在人际管理页），2026-08-21 合并了：
// 当初分家是为了挡状态机还没做好时那一片假的「还需要回复」，噪音清掉之后
// 分家只剩副作用——最近的一场见面因为对方没挂在任何线上而不在这一栏里。
// 理由写在 lib/notifications.js 的 splitStates 上面。
//
// 两个区，同一份 v_pa_state 的两个切片，不是两个列表：
//
//   该动的（3）      ← 到点了的（zone='due'）
//   等待  （12）  ▸  ← 没到点的，折叠，数字一直露在外面
//
// ══ 条里只有事实和判断的理由，没有建议 ═════════════════════════
//
// 判「要回」的凭什么，就写在那一行上（reply_why —— 这次重做点名要补的
// 欠账）。想听 Fairwind 怎么回，按 [打开卡片]，草稿到点已经在卡里了。
//
// 设计稿：docs/specs/2026-08-19-what-this-line-is-waiting-on-design.md 第七节

function StateRow({ it, picking, checked, onPick, onHandled, onReschedule, onOpen }) {
  // 批量操作开着的时候，这一行就是一个勾选目标 —— 跟看板上那张卡一模一样：
  // 整行可点、行内那几个动作收起来。**勾的是同一个 id**，所以你在这儿勾一条、
  // 在看板上勾一张，进的是同一摞（「已选 N 张」那个数会一起涨）。
  //
  // 这块面板本来就是看板的另一个取景框：看板按阶段摆，它按「到点没到点」摆。
  // 同一批卡，换个筛法勾 —— 这正是批量操作最想要的那件事。
  //
  // **人也能勾**（2026-08-21 接上）。勾的是 key 而不是裸 id：一摞里现在
  // 既有线又有人，到了群发那步要靠它分清这句话该发给谁（线走 pursuit_id、
  // 人走 contact_id，brain 两种都收）。队列本来就是按两种东西混着过设计的。
  const 能勾 = picking
  const toggle = () => onPick([qKey(it.subject_kind, it.subject_id)], !checked)
  return (
    <div className={'nrow' + (能勾 ? ' pickable' : '') + (能勾 && checked ? ' on' : '')}
         role={能勾 ? 'checkbox' : undefined}
         aria-checked={能勾 ? checked : undefined}
         tabIndex={能勾 ? 0 : undefined}
         onClick={能勾 ? toggle : undefined}
         onKeyDown={能勾 ? ((e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle() } }) : undefined}>
      {能勾 && <span className="pc-check" aria-hidden="true" />}
      <div className="nrow-b">
        {/* 名字本身就是入口 —— 跟右边那颗「打开卡片」同一个去处，
            只是目标大、顺手。 */}
        <div className="nrow-h">
          {/* 人名过展示模式；机会线的标题不用——演示的正是这些机会（见 Veil.jsx） */}
          {(() => {
            const 名 = it.subject_kind === 'pursuit'
              ? (it.name || '（没名字）')
              : <Veil>{it.name || '（没名字）'}</Veil>
            return 能勾
              ? <span className="nname as-text">{名}</span>
              : <button className="nname" onClick={() => onOpen(it)}>{名}</button>
          })()}
        </div>
        <div className="nrow-w">{stateLine(it)}</div>
        {whyLine(it) && <div className="nrow-y">{whyLine(it)}</div>}
      </div>
      {/* 勾选的时候整组动作收起来：这一行现在是个勾选框，
          里头再摆三颗各干各的按钮，你按哪一下都得先想一想。
          现在线和人都能勾，两者一致。 */}
      {!能勾 && (
      <div className="nrow-a">
        {it.zone === 'due' && (
          /* 表单交了、微信里说了、当面聊了 —— 系统看不见邮箱外的事。
             这一下是**记一笔**（进时间线，留痕迹），不是把提醒抹掉。 */
          <button className="nbtn" title="已处理 —— 记一笔，留痕迹" aria-label="已处理"
                  onClick={() => onHandled(it)}>✓</button>
        )}
        {/* 改期：默认等待天数对这个 case 不合适时（「说好周四再催」），
            直接把到点日改掉 —— 原来这个结论只能活在对话里，没处落。
            原生 date input 披着链接的皮：点开就是日历。 */}
        {it.state === 'WAITING_REPLY' && it.anchor_id && (
          <label className="nresched" title="改到点日">
            改期
            <input type="date" value=""
                   onChange={(e) => e.target.value && onReschedule(it, e.target.value)} />
          </label>
        )}
        <button className="nopen" onClick={() => onOpen(it)}>打开卡片</button>
      </div>
      )}
    </div>
  )
}

// 收起来的区。**数字永远露在外面**：静默藏起来 = 你以为没有，其实有。
function Fold({ title, note, items, render }) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  return (
    <section className="nsect">
      <button className="nfold" onClick={() => setOpen((x) => !x)}>
        {open ? '▾' : '▸'} {title}（{items.length}）
      </button>
      {open && (
        <>
          {note && <p className="nnone">{note}</p>}
          {items.map(render)}
        </>
      )}
    </section>
  )
}

// 「被判为不用回的」那层于 2026-08-20 从面板退役（他拍的）：
// 它让人「总觉得要对一下，很疲惫」，而且「这封要不要回」是个问错粒度的
// 问题 —— 线在等什么（状态机）才是对的粒度。判决数据都在 letter_verdicts。
// 错判的发现走「挂到看板上」：没有气泡的活跃卡 = 该起疑的安静线。

function MailAge({ mail }) {
  if (!mail?.at) return null
  const min = Math.round((Date.now() - new Date(mail.at)) / 60000)
  const ago = min < 1 ? '刚刚' : min < 60 ? `${min} 分钟前` : `${Math.round(min / 60)} 小时前`
  return (
    <p className="nnone nfresh">
      账面截至{ago}收信。<b>你刚发的信要等下一轮</b>（≤5 分钟）才会把
      对应的条目消掉 —— 那不是没记上，是还没收到。
    </p>
  )
}

export default function Notifications({ data, mail, judging, onJudgeMore, onHandled, onReschedule, onOpen, onGoPeople, onAudit, auditOn, onClose,
                                       picking = false, picked, onPick }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { due = [], waiting = [],
          unclaimed = 0, stale = [], unjudged = [], source, reason } = data || {}
  const 待判 = stale.length + (stale.length ? 0 : unjudged.length)

  return (
    <div className="npanel" role="dialog" aria-label="消息">
      <header className="nhead">
        {/* 「消息」不叫「该动的」：这块板子装的不全是催你动的东西——
            等待那一层是「在等别人」。
            「今天：」那一段才是该动的，标题不该替其中一个区说话。 */}
        <h2>消息</h2>
        {due.length > 0 && <span className="ncount">{due.length} 件</span>}
        <span className="sp" />
        {/* 挂到看板上：每张卡头顶吊一个状态气泡；发出&提交/进一步/谈成里
            **没有气泡的卡**就是该起疑的 —— 一条线安静了，是真没事还是判漏了，
            看板上一眼能扫出来。这是「判为不用回」那层退役后错判的发现口。 */}
        <button className="lnk" onClick={onAudit}>{auditOn ? '收起看板气泡' : '打开看板气泡'}</button>
        <button className="nclose" onClick={onClose} aria-label="收起">✕</button>
      </header>

      <MailAge mail={mail} />

      {/* 空可以，骗人不行 —— 说清是「真没有」还是「没连上」。 */}
      {source === 'empty' && (
        <p className="nnone">
          {reason === 'no-config' ? '没连上数据库（.env.local 里的 VITE_SUPABASE_* 没填）。'
           : '连上了但查询报错。'}
          <b>这不是「你没有要办的事」。</b>
        </p>
      )}

      {judging && (
        <p className="nnone"><i className="spin" aria-hidden="true" /> 正在读近期往来重判…</p>
      )}
      {!judging && 待判 > 0 && (
        <p className="nnone">
          还有 {待判} 条最近有往来的在排队重判（每 5 分钟自动判一批）。
          <button className="lnk" onClick={onJudgeMore}>现在就判</button>
        </p>
      )}

      {/* 该动的：到点了的，紧的在上。
          标题改叫「消息」之后，这一段得自己有个名字——不然它跟下面「等待」
          那一折看着是同一堆东西，而这两堆的分别正是这块板子的全部意思。 */}
      <section className="nsect">
        <div className="nsect-h"><h3>今天：</h3></div>
        {due.length ? due.map((it) => (
          <StateRow key={it.key} it={it} picking={picking} checked={picked?.has(qKey(it.subject_kind, it.subject_id))} onPick={onPick}
                    onHandled={onHandled} onReschedule={onReschedule} onOpen={onOpen} />
        )) : source !== 'empty' && (
          <p className="nnone">现在没有到点的。看看新机会吧。</p>
        )}
      </section>

      {/* 等待：没到点的，折叠着，数字露在外面 */}
      <Fold title="等待" items={waiting}
            note="还没到点的。到了那天自动挪到上面 —— 中间对方回了，它自己就没了。"
            render={(it) => (
              <StateRow key={it.key} it={it} picking={picking} checked={picked?.has(qKey(it.subject_kind, it.subject_id))} onPick={onPick}
                        onHandled={onHandled} onReschedule={onReschedule} onOpen={onOpen} />
            )} />

      {/* 没归到任何线的往来 —— 不逐条列，但不许是隐形的 */}
      {unclaimed > 0 && (
        <p className="nnone">
          还有 {unclaimed} 个地址的往来没归到任何线，在
          <button className="lnk" onClick={onGoPeople}>人际管理页</button>处理。
        </p>
      )}

    </div>
  )
}
