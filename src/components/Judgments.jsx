// src/components/Judgments.jsx —— 「我的判据」:开关 + 判据目录在哪 + 「看看会怎么变」。
// 本机模式才有(判据文档住在数据目录里)。骨架在代码里,这儿只管口味那一层。
import { useEffect, useState } from 'react'
import { t } from '../i18n/index.js'
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
      <div className="kind-h la-h">{t('我的判据')}<small>{t('Fairwind 每次判断都读这些;骨架在程序里,口味在你这儿')}</small></div>
      <div className="jd-row">
        <label className="jd-switch">
          <input type="checkbox" checked={s.judgmentsEnabled !== false} onChange={flip} />
          {s.judgmentsEnabled !== false ? t('用我的判据') : t('用出厂判据(我的先关着)')}
        </label>
        <span className="jd-dir">{t('文件在 ')}<code>{'<data dir>'}/judgments/</code>{t(',怎么写看里面的 README')}</span>
        <span className="sp" />
        <button type="button" className="b" disabled={busy} onClick={preview}>{busy ? t('在判…') : t('看看会怎么变')}</button>
      </div>
      {out && (out.error
        ? <div className="la-note bad">{t('没跑成:')}{out.error}</div>
        : out.n === 0
          ? <div className="jd-empty">{t('还没有判过的事——收几封信、记几笔之后再来看。')}</div>
          : (
            <>
              <div className="jd-sum">{t('最近 {n} 件,{c} 件结论变了', { n: out.n, c: out.changed })}{out.usingJudgments ? '' : t('(判据文档现在是空的或关着的)')}</div>
              <table className="jd-table">
                <thead><tr><th>{t('谁 · 什么时候')}</th><th>{t('原来')}</th><th>{t('现在')}</th></tr></thead>
                <tbody>
                  {out.rows.map((r) => (
                    <tr key={r.id} className={r.changed ? 'changed' : ''}>
                      <td><b>{r.subject}</b><br /><small>{r.who} · {fmt(r.when)} · {r.situation}</small></td>
                      <td><Tag t={r.old} /></td>
                      <td>{r.new ? <Tag t={r.new} /> : <small className="bad">{r.note || t('没判出来')}</small>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ))}
    </section>
  )
}

function Tag({ t: tag }) {
  if (!tag) return <small>—</small>
  return (
    <div className="jd-tag">
      <div>{tag.needs_reply === true ? t('要回') : tag.needs_reply === false ? t('不用回') : '—'}{t(' · 等 {d} 天 · 见面 {m}', { d: fmt(tag.wait_days), m: fmt(tag.meet_at) })}</div>
      <small>{tag.gist || ''}</small>
    </div>
  )
}
