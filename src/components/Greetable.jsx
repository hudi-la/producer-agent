import React, { useEffect, useRef, useState } from 'react'
import {
  fetchGreetable, searchArchive, archiveTally, overrideVerdict, adopt, markGreeted, mailState,
} from '../lib/mail.js'

// 等你点头 + 判掉的档案柜。
//
// 这一页换掉了「还不认识的地址」那个待办清单。区别不在样子，在性质：
//
//   原来：一个你得清空的列表。它是 0 条，因为从来没有信进来过。
//   现在：它替你判完，只把**业务相关的真人和机构信箱**端上来；判掉的
//         那两百多个退到后台，变成一个**你不需要清空、但搜得到**的档案柜。
//
// 判据你想不出来是正常的——「跟我的业务有关的真人」本来就不是机械规则，
// 是判断。所以该它判。但**判掉的一个都不删**：AI 静默判掉一个真人，
// 跟丢了没有区别，所以永远留一条翻案的路。

const md = (s) => (s ? (([, m, d]) => `${Number(m)}/${Number(d)}`)(String(s).split('-')) : '—')
const NAMES = { person: '人', shared_box: '机构信箱', bulk: '群发', machine: '机器', unsure: '认不出' }

/** 一条待点头的。人和机构信箱长得一样，只是认下去之后走两条不同的路。 */
function Row({ r, checked, onCheck, onAdopt, onReject, busy }) {
  const org = r.verdict === 'shared_box'
  return (
    <div className={`gr ${busy ? 'gr-busy' : ''}`}>
      {onCheck && (
        <input type="checkbox" className="gr-x" checked={checked}
               onChange={(e) => onCheck(r.email, e.target.checked)} disabled={busy} />
      )}
      <div className="gr-body">
        <div className="gr-top">
          <b>{r.name || r.org || r.email}</b>
          <span className={`gr-kind ${org ? 'is-org' : ''}`}>{org ? '机构信箱' : '人'}</span>
          {r.decided_by === 'you' && <span className="gr-kind is-you">你定的</span>}
        </div>
        <div className="gr-mail">{r.email}</div>
        {r.why && <p className="gr-why">{r.why}</p>}
        <div className="gr-meta">
          你发去 {r.n_out} · 他发来 {r.n_in} · {md(r.first_at)} → {md(r.last_at)}
        </div>
        {r.subjects?.length > 0 && (
          <div className="gr-subj">{r.subjects.filter(Boolean).slice(0, 2).map((s) => `「${s}」`).join('　')}</div>
        )}
      </div>
      <div className="gr-act">
        <button className="lnk" disabled={busy} onClick={() => onAdopt(r)}>
          {busy ? '认领中…' : org ? '登记' : '加进通讯录'}
        </button>
        <button className="lnk gr-no" disabled={busy} onClick={() => onReject(r)}>不要</button>
      </div>
    </div>
  )
}

export default function Greetable({ onChanged }) {
  const [rows, setRows] = useState(null)
  const [state, setState] = useState(null)
  const [pick, setPick] = useState(() => new Set())
  // 正在认的那些 email。**必须是一组，不能是单个值。**
  //
  // 原来这儿是 setBusy(email)：你点第二个人，第一个人的「认领中…」就没了，
  // 看起来像被打断了——可后台那一趟还在飞，信照样在搬。界面说的和实际
  // 发生的对不上，这比慢更糟。
  const [busy, setBusy] = useState(() => new Set())
  const [run, setRun] = useState(null)            // 批量：{i, n}
  const [err, setErr] = useState(null)
  const [done, setDone] = useState([])            // 认完的报告，攒着不互相顶掉
  const seeded = useRef(false)                    // 首次那批默认全勾，只做一次

  const mark = (email, on) => setBusy((s) => {
    const n = new Set(s)
    on ? n.add(email) : n.delete(email)
    return n
  })
  const say = (line) => setDone((d) => [line, ...d].slice(0, 4))

  // 档案柜
  const [q, setQ] = useState('')
  const [arch, setArch] = useState(null)
  const [tally, setTally] = useState(null)
  const [open, setOpen] = useState(false)

  async function reload() {
    try {
      const [g, s, t] = await Promise.all([fetchGreetable(), mailState(), archiveTally()])
      setRows(g); setState(s?.[0] || null); setTally(t)
      // 首次那一批默认全勾：一百多个一个个点是另一种苦差事。
      // 只在第一次载入时做——不然你按了「全不选」，随便认成一个触发 reload，
      // 又会被全勾回来。
      if (!seeded.current && g && g.length > 20) { seeded.current = true; setPick(new Set(g.map((r) => r.email))) }
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { reload() }, [])

  useEffect(() => {
    if (!open) return
    let alive = true
    const t = setTimeout(async () => {
      try { const a = await searchArchive(q); if (alive) setArch(a) } catch (e) { setErr(e.message) }
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [q, open])

  // 认一个。**可以同时认好几个**——各飞各的，互不打断，界面按 email 各记各的。
  async function one(r) {
    mark(r.email, true); setErr(null)
    try {
      const out = await adopt(r)
      say(`${r.name || r.org || r.email}：搬进来 ${out.promoted} 封`)
      await reload(); onChanged?.()
    } catch (e) {
      setErr(e.needsAuth ? `${e.message}——${e.fix || '重新授权一次'}` : e.message)
    } finally { mark(r.email, false) }
  }

  async function reject(r) {
    mark(r.email, true)
    try {
      // 不删，改判。decided_by='you' 之后自动判定再也动不了它。
      await overrideVerdict({ ...r, business: false, why: r.why ? `${r.why}（你说不要）` : '你说不要' })
      await reload()
    } catch (e) { setErr(e.message) } finally { mark(r.email, false) }
  }

  // 批量：串行一个个来。一条挂了不停，接着跑下一条——跟「更新最新信息」
  // 一个节奏。全停下来的话，前面认成的那些你也看不见。
  async function many() {
    const list = (rows || []).filter((r) => pick.has(r.email))
    if (!list.length) return
    setErr(null)
    let ok = 0, bad = 0, mails = 0
    for (let i = 0; i < list.length; i++) {
      setRun({ i: i + 1, n: list.length })
      try { const out = await adopt(list[i]); ok++; mails += out.promoted || 0 } catch (_) { bad++ }
    }
    setRun(null); setPick(new Set())
    say(`认了 ${ok} 个，搬进来 ${mails} 封${bad ? `；${bad} 个没成，还在上面等着` : ''}`)
    await reload(); onChanged?.()
  }

  if (rows === null) return null
  const batch = rows.length > 20
  const backfilled = state?.backfilled_at

  return (
    <>
      <section className="psect">
        <div className="psect-h">
          <h2>等你点头</h2>
          <span className="pcount">{rows.length} 个</span>
        </div>

        {!backfilled ? (
          <p className="pnone">
            信箱还没回填过。在 brain 目录下跑一次 <code>npm run mail:sync</code>，
            它会把信头全抓进来，再跑 <code>npm run mail:classify</code> 判一遍。
          </p>
        ) : rows.length === 0 ? (
          <p className="pnone">
            没有等你点头的了。信箱里 {state?.headers ?? 0} 封信头都判过了——
            剩下的在下面那个档案柜里，你不用清它。
          </p>
        ) : (
          <>
            <p className="pnone" style={{ paddingTop: 0 }}>
              它把 {state?.headers ?? 0} 封信里的地址判了一遍，这些是<b>跟你这摊事有关的真人和机构信箱</b>。
              <b>认下之后，那个地址名下所有历史往来当场归位</b>——不是从今天开始记。
            </p>

            {batch && (
              <div className="gr-bar">
                <span>{pick.size} / {rows.length} 勾着</span>
                <button className="lnk" onClick={() => setPick(new Set(rows.map((r) => r.email)))}>全选</button>
                <button className="lnk" onClick={() => setPick(new Set())}>全不选</button>
                <button className="wbtn" disabled={!pick.size || Boolean(run)} onClick={many}>
                  {run ? `认领中 ${run.i}/${run.n}` : `认下勾着的 ${pick.size} 个`}
                </button>
                <span className="gr-hint">一个个来，每个要去 Gmail 拉正文写摘要，慢一点</span>
              </div>
            )}

            {rows.map((r) => (
              <Row key={r.email} r={r}
                   checked={pick.has(r.email)}
                   onCheck={batch ? (e, on) => setPick((s) => {
                     const n = new Set(s); on ? n.add(e) : n.delete(e); return n
                   }) : null}
                   onAdopt={one} onReject={reject}
                   busy={busy.has(r.email) || Boolean(run)} />
            ))}
          </>
        )}

        {busy.size > 0 && !run && (
          <p className="gr-ok">{busy.size} 个正在认领——各跑各的，互不打断，点别的不会打断它们。</p>
        )}
        {done.map((d, i) => <p className="gr-ok" key={i}>{d}</p>)}
        {err && <p className="gr-err">{err}</p>}
      </section>

      {/* 档案柜：判掉的一个都不删。你不需要清空它——它在这儿是为了万一冤枉了谁。 */}
      {tally?.total > 0 && (
        <section className="psect">
          <div className="psect-h">
            <h2>它判掉的</h2>
            <span className="pcount">{tally.bulk + tally.machine} 个</span>
          </div>
          {!open ? (
            <p className="pnone">
              {tally.bulk} 个群发源、{tally.machine} 个机器地址
              {tally.unsure ? `、${tally.unsure} 个认不出的` : ''}，
              它们不会来打扰你。<b>但一个都没删。</b>
              <button className="lnk" style={{ marginLeft: 8 }} onClick={() => setOpen(true)}>
                搜一下，看看有没有冤枉的
              </button>
            </p>
          ) : (
            <>
              <div className="pfind" style={{ marginBottom: 12 }}>
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                       placeholder="搜地址、名字、机构，或者它给的理由" />
                <button className="lnk" onClick={() => { setOpen(false); setQ('') }}>收起</button>
              </div>
              {(arch || []).map((a) => (
                <div className="gr gr-arch" key={a.email}>
                  <div className="gr-body">
                    <div className="gr-top">
                      <b>{a.name || a.org || a.email}</b>
                      <span className="gr-kind">{NAMES[a.verdict] || a.verdict}</span>
                      {a.decided_by === 'you' && <span className="gr-kind is-you">你定的</span>}
                    </div>
                    <div className="gr-mail">{a.email}</div>
                    {a.why && <p className="gr-why">{a.why}</p>}
                    <div className="gr-meta">
                      共 {a.n} 封（你发去 {a.n_out}）· {md(a.first_at)} → {md(a.last_at)}
                    </div>
                  </div>
                  <div className="gr-act">
                    <button className="lnk" onClick={async () => {
                      try {
                        await overrideVerdict({
                          email: a.email, verdict: 'person', business: true,
                          name: a.name, org: a.org,
                          why: a.why ? `${a.why}（你说这是真人）` : '你说这是真人',
                        })
                        await reload(); setArch(await searchArchive(q))
                      } catch (e) { setErr(e.message) }
                    }}>冤枉了，是真人</button>
                  </div>
                </div>
              ))}
              {arch && arch.length === 0 && <p className="pnone">没搜到。</p>}
            </>
          )}
        </section>
      )}
    </>
  )
}
