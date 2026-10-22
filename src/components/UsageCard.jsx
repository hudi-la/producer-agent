import { useEffect, useState } from 'react'
import { getLang } from '../i18n/index.js'
import { brainApi } from '../lib/backends.js'
import ErrorNotice from './ErrorNotice.jsx'
import './UsageCard.css'

export default function UsageCard() {
  const en = getLang() === 'en'
  const say = (zh, english) => en ? english : zh
  const [days, setDays] = useState(30)
  const [revision, refresh] = useState(0)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(true)
  useEffect(() => {
    let live = true
    setBusy(true); setError(null); setData(null)
    brainApi.settings.usage(days).then(r => {
      if (r?.error) throw r.error
      if (!r?.daily) throw new Error('Usage counters unavailable')
      if (live) setData(r)
    }).catch(e => { if (live) setError(e) }).finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [days, revision])
  const total = { calls: 0, failed: 0, measured: 0, input: 0, output: 0, cached: 0 }
  const models = new Map()
  const daily = (data?.daily || []).map(day => {
    let tokens = 0
    for (const row of day.rows) {
      for (const key of Object.keys(total)) total[key] += row[key] || 0
      const key = JSON.stringify([row.provider, row.model])
      const model = models.get(key) || { ...row, calls: 0, input: 0, output: 0 }
      model.calls += row.calls; model.input += row.input; model.output += row.output
      models.set(key, model); tokens += row.input + row.output
    }
    return { date: day.date, tokens }
  })
  const max = Math.max(1, ...daily.map(d => d.tokens))
  const fmt = n => n.toLocaleString(en ? 'en-US' : 'zh-CN')
  return <section className="set-card usage-card" aria-busy={busy}>
    <header className="set-card-h"><div><h2>{say('用量监控', 'Usage')}</h2><p>{say('本账号在 Fairwind 内的模型用量', 'Model usage by this account in Fairwind')}</p></div>
      <button className="b" type="button" disabled={busy} onClick={() => refresh(n => n + 1)}>{say('刷新', 'Refresh')}</button></header>
    <div className="usage-period" role="group" aria-label={say('统计周期', 'Period')}>{[7, 30, 90].map(n => <button className="b" type="button" key={n} aria-pressed={days === n} onClick={() => setDays(n)}>{say(`近 ${n} 天`, `Last ${n} days`)}</button>)}</div>
    <ErrorNotice error={error} onRetry={() => refresh(n => n + 1)} />
    {busy && <p role="status">{say('正在读取用量…', 'Loading usage…')}</p>}
    {data && <>
      <dl className="usage-stats">{[[say('模型调用', 'Model calls'), total.calls], [say('输入 token', 'Input tokens'), total.input], [say('输出 token', 'Output tokens'), total.output], [say('缓存读取 token', 'Cached input tokens'), total.cached]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{fmt(value)}</dd></div>)}</dl>
      {total.calls === 0 ? <p>{say('这段时间还没有记录到模型调用。', 'No model calls recorded in this period.')}</p> : <>
        <p className="set-hint">{say(`失败 ${fmt(total.failed)} 次；${fmt(total.measured)} 次有返回用量。缓存读取已包含在输入中。`, `${fmt(total.failed)} failed; ${fmt(total.measured)} returned usage. Cached input is included in input tokens.`)}</p>
        <div className="usage-chart" role="img" aria-label={say('每日输入与输出 token 总量，UTC', 'Daily input and output tokens, UTC')}>{daily.map(d => <div key={d.date} title={`${d.date}: ${fmt(d.tokens)} tokens`}><span style={{ height: `${d.tokens / max * 100}%` }} /></div>)}</div>
        <div className="usage-range"><span>{daily[0]?.date}</span><span>UTC</span><span>{daily.at(-1)?.date}</span></div>
        <div className="usage-table"><table><thead><tr><th>{say('模型 / 来源', 'Model / provider')}</th><th>{say('调用', 'Calls')}</th><th>{say('输入', 'Input')}</th><th>{say('输出', 'Output')}</th></tr></thead><tbody>{[...models].map(([key, r]) => <tr key={key}><td>{r.model}<small>{r.provider}</small></td><td>{fmt(r.calls)}</td><td>{fmt(r.input)}</td><td>{fmt(r.output)}</td></tr>)}</tbody></table></div>
        <details><summary>{say('每日明细', 'Daily details')}</summary><div className="usage-table"><table><tbody>{daily.map(d => <tr key={d.date}><th>{d.date}</th><td>{fmt(d.tokens)} tokens</td></tr>)}</tbody></table></div></details>
      </>}
      <p className="set-hint">{say('从启用后开始累计，按 UTC 日期统计，保留最近一年。不包含其他应用的用量。失败调用可能没有完整 token 数据；订阅剩余额度和实际账单请以模型供应商为准。', 'Recorded from activation, grouped by UTC date and retained for one year. Other apps are excluded. Failed calls may lack token data. Check your provider for subscription limits and actual billing.')}</p>
    </>}
  </section>
}
