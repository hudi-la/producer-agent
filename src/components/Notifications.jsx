import { useEffect, useState } from 'react'

// 顶栏那块通知面板。**一条一条需要你动的事**，机会线和人混在一起。
//
// ══ 条里只有事实，没有建议 ═════════════════════════════════════
//
// 谁、哪天、说了什么、多少天了 —— 这些不花钱就有（信的原文在库里）。
// 想听 Fairwind 怎么回，按 [打开卡片] 进卡里聊，那儿本来就能聊，
// 而且是流式吐字的。
//
// 为什么不在收信时先把建议写好存起来：**那句建议会过期。**
// 你后来又收到一封、或者你在别处已经回了，那句建议还挂在那儿说着三天前的
// 情况——那正是这一刀要治的第一条病换个位置复发。
//
// 设计稿：docs/specs/2026-08-18-notifications-design.md 第三、八、十节

const 名字 = (it) => it.name || (it.subject_kind === 'pursuit' ? '（无对接人）' : '未具名联系人')

function Row({ it, onMark, onOpen }) {
  return (
    <div className={'nrow' + (it.cue?.stopped ? ' stopped' : '')}>
      <div className="nrow-b">
        <div className="nrow-h">
          <b>{名字(it)}</b>
          {it.line_title && <span className="nrow-l"> · {it.line_title}</span>}
        </div>
        <div className="nrow-w">
          {it.cue ? it.cue.why : `判为不用回：${it.verdict?.why || '（没说理由）'}`}
        </div>
      </div>
      <div className="nrow-a">
        {it.cue && (
          <>
            {/* 办完了。上库，跨设备。有些活办完了**不产生任何邮件**——
                当面聊过、打了电话、从别的信箱回的，系统无从得知。 */}
            <button className="nbtn" title="办完了" aria-label="办完了"
                    onClick={() => onMark(it, 'done')}>✓</button>
            {/* 先不看。**不改任何事实**——那封信、那个日期原样都在。
                他再回你一封新的，这条会重新出现（键锚在事实的日期上）。 */}
            <button className="nbtn" title="先不看" aria-label="先不看"
                    onClick={() => onMark(it, 'off')}>✕</button>
          </>
        )}
        <button className="nopen" onClick={() => onOpen(it)}>打开卡片</button>
      </div>
    </div>
  )
}

// 收起来的那两层。**数字永远露在外面**：静默藏起来 = 你以为没有，其实有。
function Fold({ title, note, items, onMark, onOpen }) {
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
          {items.map((it) => <Row key={it.key} it={it} onMark={onMark} onOpen={onOpen} />)}
        </>
      )}
    </section>
  )
}

export default function Notifications({ data, judging, onJudgeMore, onMark, onAllBack, onOpen, onClose }) {
  // Esc 收起来
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { hand = [], old = [], muted = [], stale = [], unjudged = [], source, reason } = data || {}
  const 待判 = stale.length + (stale.length ? 0 : unjudged.length)

  return (
    <div className="npanel" role="dialog" aria-label="该动的">
      <header className="nhead">
        <h2>该动的</h2>
        <button className="nclose" onClick={onClose} aria-label="收起">✕</button>
      </header>

      {/* 空可以，骗人不行 —— 说清是「真没有」还是「没连上」。 */}
      {source === 'empty' && (
        <p className="nnone">
          {reason === 'no-config' ? '没连上数据库（.env.local 里的 VITE_SUPABASE_* 没填）。'
           : '连上了但查询报错。'}
          <b>这不是「你没有要办的事」。</b>
        </p>
      )}

      {judging && (
        <p className="nnone">
          <i className="spin" aria-hidden="true" /> 正在读近期往来重判…
        </p>
      )}

      {/* 还没判完的**必须报出来**。静默截断 = 你以为全判完了，其实没有。
          只数最近有往来的那些 —— 更老的不主动判（问「约定了什么时间点吗」
          必然是 null），它们的由头照样从事实现算得出来。 */}
      {!judging && 待判 > 0 && (
        <p className="nnone">
          还有 {待判} 条最近有往来的没重判，下面这些可能还是旧结论。
          <button className="lnk" onClick={onJudgeMore}>接着判</button>
        </p>
      )}

      <section className="nsect">
        <div className="nsect-h"><h3>手头</h3><span className="ncount">{hand.length} 件</span></div>
        {hand.length ? hand.map((it) => (
          <Row key={it.key} it={it} onMark={onMark} onOpen={onOpen} />
        )) : source !== 'empty' && (
          <p className="nnone">现在没有该动的。这是好事，不是漏了什么。</p>
        )}
      </section>

      <Fold title="老账" items={old} onMark={onMark} onOpen={onOpen}
            note="7 天以前的，加上碰满三次停了的。它们该在，只是不该跟今早那封挤在一起。" />
      <Fold title="被判为不用回的" items={muted} onMark={onMark} onOpen={onOpen}
            note="Fairwind 读过内容，觉得没有等你答的事。判错了就在这儿捞回来。" />

      {/* 永远留一条放回来的路。**只放回 ✕ 的**，真办完的不翻出来。 */}
      <p className="nnone nback">
        按错了？<button className="lnk" onClick={onAllBack}>把「先不看」的都放回来</button>
      </p>
    </div>
  )
}
