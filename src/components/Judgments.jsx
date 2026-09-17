// src/components/Judgments.jsx —— 「我的判据」:开关 + 判据目录在哪 + 「看看会怎么变」。
// 本机模式才有(判据文档住在数据目录里)。骨架在代码里,这儿只管口味那一层。
import { useEffect, useState } from 'react'
import { supa } from '../lib/backends.js'

const fmt = (v) => (v == null || v === '' ? '—' : String(v).replace('T', ' ').slice(0, 16))

export default function Judgments() {
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState(null)
  const load = () => supa.settings.get().then(setS)
  useEffect(() => { load() }, [])
  if (!s) return null
  const flip = async () => { await supa.settings.set({ judgmentsEnabled: !s.judgmentsEnabled }); await load() }
  const preview = async () => {
    setBusy(true); setOut(null)
    const r = await supa.judgments.preview(20)
    setBusy(false); setOut(r)
  }
  return (
    <section className="judgments">
      <div className="kind-h la-h">我的判据<small>Fairwind 每次判断都读这些;骨架在程序里,口味在你这儿</small></div>
      <div className="jd-row">
        <label className="jd-switch">
          <input type="checkbox" checked={s.judgmentsEnabled !== false} onChange={flip} />
          {s.judgmentsEnabled !== false ? '用我的判据' : '用出厂判据(我的先关着)'}
        </label>
        <span className="jd-dir">文件在 <code>{'<数据目录>'}/judgments/</code>,怎么写看里面的 README</span>
        <span className="sp" />
        <button type="button" className="b" disabled={busy} onClick={preview}>{busy ? '在判…' : '看看会怎么变'}</button>
      </div>
      {out && (out.error
        ? <div className="la-note bad">没跑成:{out.error}</div>
        : out.n === 0
          ? <div className="jd-empty">还没有判过的事——收几封信、记几笔之后再来看。</div>
          : (
            <>
              <div className="jd-sum">最近 {out.n} 件,{out.changed} 件结论变了{out.usingJudgments ? '' : '(判据文档现在是空的或关着的)'}</div>
              <table className="jd-table">
                <thead><tr><th>谁 · 什么时候</th><th>原来</th><th>现在</th></tr></thead>
                <tbody>
                  {out.rows.map((r) => (
                    <tr key={r.id} className={r.changed ? 'changed' : ''}>
                      <td><b>{r.subject}</b><br /><small>{r.who} · {fmt(r.when)} · {r.situation}</small></td>
                      <td><Tag t={r.old} /></td>
                      <td>{r.new ? <Tag t={r.new} /> : <small className="bad">{r.note || '没判出来'}</small>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ))}
    </section>
  )
}

function Tag({ t }) {
  if (!t) return <small>—</small>
  return (
    <div className="jd-tag">
      <div>{t.needs_reply === true ? '要回' : t.needs_reply === false ? '不用回' : '—'} · 等 {fmt(t.wait_days)} 天 · 见面 {fmt(t.meet_at)}</div>
      <small>{t.gist || ''}</small>
    </div>
  )
}
