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

function Row({ it, onMark, onUnmute, onOpen }) {
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
        {it.cue ? (
          <>
            {/* 办完了。上库，跨设备。有些活办完了**不产生任何邮件**——
                当面聊过、打了电话、从别的信箱回的，系统无从得知。 */}
            <button className="nbtn" title="办完了" aria-label="办完了"
                    onClick={() => onMark(it, 'done')}>✓</button>
            {/* 先不看。**不改任何事实**——那封信、那个日期原样都在。
                他再回你一封新的，这条会重新出现（键锚在事实的日期上）。 */}
            <button className="nbtn" title="先不看" aria-label="先不看"
                    onClick={() => onMark(it, 'off')}>✕</button>
            <button className="nopen" onClick={() => onOpen(it)}>打开卡片</button>
          </>
        ) : it.backable ? (
          /* 判为不用回的那一层，你在这儿只会做一件事：**判错了，捞回来。**
             原来这儿摆的是「打开卡片」——那是给该动的那一列用的动作
             （去把事办了）。这一层的事早就不用办了，你打开它是想说
             「不对，这封得回」，那就该有一个直接说这句话的按钮。 */
          <button className="nopen" onClick={() => onUnmute(it)}
                  title="判错了 —— 放回该动的那一列">放回</button>
        ) : (
          /* 这一条放回去也不会出现在上面那一列（信你早回过了，球在对方）。
             那就不摆「放回」——按一下东西就没了的按钮，比没有这个按钮糟得多。
             留「打开卡片」：你还是进得去，只是这儿没有那个假动作。 */
          <button className="nopen" onClick={() => onOpen(it)}>打开卡片</button>
        )}
      </div>
    </div>
  )
}

// 收起来的那两层。**数字永远露在外面**：静默藏起来 = 你以为没有，其实有。
function Fold({ title, note, items, onMark, onUnmute, onOpen }) {
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
          {items.map((it) => (
            <Row key={it.key} it={it} onMark={onMark} onUnmute={onUnmute} onOpen={onOpen} />
          ))}
        </>
      )}
    </section>
  )
}

export default function Notifications({ data, judging, onJudgeMore, onMark, onUnmute, onAllBack, onOpen, onClose }) {
  // Esc 收起来
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { todo = [], muted = [], stale = [], unjudged = [], source, reason } = data || {}
  const 待判 = stale.length + (stale.length ? 0 : unjudged.length)

  return (
    <div className="npanel" role="dialog" aria-label="该动的">
      <header className="nhead">
        {/* 数摆在标题旁边。原来它在「手头」那一段的段头上，段头撤了数不能跟着撤——
            一个数不出总量的列表，你永远不知道往下还有多少。 */}
        <h2>该动的</h2>
        {todo.length > 0 && <span className="ncount">{todo.length} 件</span>}
        <span className="sp" />
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
      {/* 常态下这一行不出现 —— 收信循环每轮已经把该判的判掉了。
          它只在积压还没化开的时候露面（比如刚迁移完），并且报出还剩多少：
          **静默截断 = 你以为全判完了，其实没有**。 */}
      {!judging && 待判 > 0 && (
        <p className="nnone">
          还有 {待判} 条最近有往来的在排队重判（每 5 分钟自动判一批）。
          <button className="lnk" onClick={onJudgeMore}>现在就判</button>
        </p>
      )}

      {/* 一条列表，新的在上面。
          原来这儿分「手头」和「老账」两段（7 天为界）。撤了：那道线看着像
          两类事，其实只是新旧——同一件「还没回人家」，第 6 天摆在你面前，
          第 8 天折进一个要点一下才展开的抽屉里。日期就写在每条由头上，
          新旧自己看得出来，不需要一道横杠替你分类。
          🔔 上那个角标照旧只数 7 天内的（layer().hand）—— 列表里该躺着的，
          不等于该天天顶着红点冲你喊。 */}
      <section className="nsect">
        {todo.length ? todo.map((it) => (
          <Row key={it.key} it={it} onMark={onMark} onOpen={onOpen} />
        )) : source !== 'empty' && (
          <p className="nnone">现在没有该动的。这是好事，不是漏了什么。</p>
        )}
      </section>

      <Fold title="被判为不用回的" items={muted} onMark={onMark} onUnmute={onUnmute} onOpen={onOpen}
            note="Fairwind 读过内容，觉得没有等你答的事。判错了按「放回」，它就回到上面那一列里；没有「放回」的那几条是你早回过了，放回去也算不出由头。" />

      {/* 永远留一条放回来的路。**只放回 ✕ 的**，真办完的不翻出来。 */}
      <p className="nnone nback">
        按错了？<button className="lnk" onClick={onAllBack}>把「先不看」的都放回来</button>
      </p>
    </div>
  )
}
