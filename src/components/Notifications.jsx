import { useEffect, useState } from 'react'
import { stateLine, whyLine } from '../lib/stateText.js'

// 顶栏那块通知面板。装的是**机会线的事**（人的事在人际管理页的
// 「该动的」——分家的规矩见 lib/notifications.js 的 goesTo）。
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

function StateRow({ it, onHandled, onOpen }) {
  return (
    <div className="nrow">
      <div className="nrow-b">
        <div className="nrow-h"><b>{it.name || '（没名字）'}</b></div>
        <div className="nrow-w">{stateLine(it)}</div>
        {whyLine(it) && <div className="nrow-y">{whyLine(it)}</div>}
      </div>
      <div className="nrow-a">
        {it.zone === 'due' && (
          /* 表单交了、微信里说了、当面聊了 —— 系统看不见邮箱外的事。
             这一下是**记一笔**（进时间线，留痕迹），不是把提醒抹掉。 */
          <button className="nbtn" title="已处理 —— 记一笔，留痕迹" aria-label="已处理"
                  onClick={() => onHandled(it)}>✓</button>
        )}
        <button className="nopen" onClick={() => onOpen(it)}>打开卡片</button>
      </div>
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

function MutedRow({ it, onUnmute, onOpen }) {
  return (
    <div className="nrow">
      <div className="nrow-b">
        <div className="nrow-h">
          <b>{it.name || '未具名联系人'}</b>
          {it.line_title && <span className="nrow-l"> · {it.line_title}</span>}
        </div>
        <div className="nrow-w">判为不用回：{it.verdict?.why || '（没说理由）'}</div>
      </div>
      <div className="nrow-a">
        {it.backable ? (
          <button className="nopen" onClick={() => onUnmute(it)}
                  title="判错了 —— 放回该动的那一列">放回</button>
        ) : (
          <button className="nopen" onClick={() => onOpen(it)}>打开卡片</button>
        )}
      </div>
    </div>
  )
}

export default function Notifications({ data, judging, onJudgeMore, onHandled, onUnmute, onAllBack, onOpen, onGoPeople, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { bell = { due: [], waiting: [] }, people = { due: [], waiting: [] },
          muted = [], unclaimed = 0, stale = [], unjudged = [], source, reason } = data || {}
  const 待判 = stale.length + (stale.length ? 0 : unjudged.length)
  const peopleN = people.due.length + people.waiting.length

  return (
    <div className="npanel" role="dialog" aria-label="该动的">
      <header className="nhead">
        <h2>该动的</h2>
        {bell.due.length > 0 && <span className="ncount">{bell.due.length} 件</span>}
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
        <p className="nnone"><i className="spin" aria-hidden="true" /> 正在读近期往来重判…</p>
      )}
      {!judging && 待判 > 0 && (
        <p className="nnone">
          还有 {待判} 条最近有往来的在排队重判（每 5 分钟自动判一批）。
          <button className="lnk" onClick={onJudgeMore}>现在就判</button>
        </p>
      )}

      {/* 该动的：到点了的，紧的在上 */}
      <section className="nsect">
        {bell.due.length ? bell.due.map((it) => (
          <StateRow key={it.key} it={it} onHandled={onHandled} onOpen={onOpen} />
        )) : source !== 'empty' && (
          <p className="nnone">现在没有到点的。这是好事，不是漏了什么。</p>
        )}
      </section>

      {/* 等待：没到点的，折叠着，数字露在外面 */}
      <Fold title="等待" items={bell.waiting}
            note="还没到点的。到了那天自动挪到上面 —— 中间对方回了，它自己就没了。"
            render={(it) => <StateRow key={it.key} it={it} onHandled={onHandled} onOpen={onOpen} />} />

      <Fold title="被判为不用回的" items={muted}
            note="Fairwind 读过内容，觉得没有等你答的事。判错了按「放回」；没有「放回」的那几条是你早回过了，放回去也算不出由头。"
            render={(it) => <MutedRow key={it.key} it={it} onUnmute={onUnmute} onOpen={onOpen} />} />

      {/* 人的事不在这儿 —— 但不许是隐形的 */}
      {(peopleN > 0 || unclaimed > 0) && (
        <p className="nnone">
          {peopleN > 0 && <>人的事有 {peopleN} 条，在<button className="lnk" onClick={onGoPeople}>人际管理页</button>。</>}
          {unclaimed > 0 && <>还有 {unclaimed} 个地址的往来没归到任何线，也在那儿处理。</>}
        </p>
      )}

      {/* 永远留一条放回来的路。**只放回 ✕ 的**，真办完的不翻出来。 */}
      <p className="nnone nback">
        按错了？<button className="lnk" onClick={onAllBack}>把「先不看」的都放回来</button>
      </p>
    </div>
  )
}
