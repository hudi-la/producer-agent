import React, { useEffect, useState } from 'react'
import { saveProfile, useProfile } from '../lib/profile.js'

// 「关于你」——档案页最上面那一块。
//
// 这些字段本来就在库里（producer.profile），但界面上看不见、改不了，只能开 SQL；
// 而 Fairwind 的 prompt 里还抄着一份写死的（"美国 O-1，常住 LA / 湾区"）。两份会飘。
//
// 现在只有库里那一份，而且你能在这儿改。O-1 变绿卡那天你自己点一下就行。
//
// 为什么这些字段值得单独摆出来：它们是 Fairwind **筛掉一个机会**的依据。
// 排除规则写错了，你会永远看不到某一类机会——而且不会有任何提示。

// key 是 profile.data 里的键；list 表示存的是数组，界面上用「、」分隔。
const FIELDS = [
  { key: 'email', label: '邮箱', hint: 'Fairwind 往这个账号的草稿箱里放信。填错了草稿会建到别处去。' },
  { key: 'visa', label: '身份', hint: '例：O-1、绿卡、公民。Fairwind 拿它判断你能不能申。' },
  { key: 'location', label: '常住', list: true, hint: '多个地方用「、」分开。' },
  { key: 'career_stage', label: '阶段', hint: '例：emerging、mid-career。' },
  { key: 'funding_pref', label: '资助偏好', long: true },
  { key: 'exclude_rule', label: '排除规则', long: true, hint: '满足这条的机会不进主名单。写错了你会看不见一整类机会。' },
  { key: 'watch_rule', label: '关注规则', long: true, hint: '够不着但值得盯的，按这条留下来。' },
]

const toText = (v, list) => (v == null ? '' : list && Array.isArray(v) ? v.join('、') : String(v))
const fromText = (s, list) =>
  list ? s.split(/[、,，]/).map((x) => x.trim()).filter(Boolean) : s.trim()

/** 一行。点一下改，失焦存，Esc 放弃——跟卡上「记一笔」同一套手感。 */
function Row({ label, value, hint, long, list, onSave }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(() => toText(value, list))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  // 别处改了（另一个标签页、或刚存完重新读），没在编辑就跟着更新
  useEffect(() => { if (!editing) setText(toText(value, list)) }, [value, list, editing])

  const commit = async () => {
    setEditing(false)
    const next = fromText(text, list)
    if (toText(next, list) === toText(value, list)) return
    setSaving(true); setErr(null)
    try { await onSave(next) } catch (e) { setErr(e.message); setText(toText(value, list)) }
    setSaving(false)
  }

  const onKey = (e) => {
    if (e.key === 'Escape') { setText(toText(value, list)); setEditing(false) }
    if (e.key === 'Enter' && !long && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.blur() }
  }

  const empty = !toText(value, list)

  return (
    <div className="idrow">
      <div className="idk">{label}</div>
      <div className="idv">
        {editing ? (
          long ? (
            <textarea className="idin" value={text} rows={3} autoFocus
              onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKey} />
          ) : (
            <input className="idin" value={text} autoFocus
              onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKey} />
          )
        ) : (
          <button className={'idval' + (empty ? ' empty' : '')} onClick={() => setEditing(true)}>
            {empty ? '＋ 填一下' : toText(value, list)}
          </button>
        )}
        {hint && <div className="idhint">{hint}</div>}
        {saving && <div className="idhint">存……</div>}
        {err && <div className="idhint bad">没存上：{err}</div>}
      </div>
    </div>
  )
}

export default function Identity({ onSaved }) {
  const profile = useProfile()
  const d = profile?.data || {}

  // 存完把最新的读回来——不然改完这一格，别的地方（卡上的「资格搁置」）还是旧的。
  const after = async (fn) => { await fn(); await onSaved?.() }

  return (
    <section className="kind identity">
      <div className="kind-h">关于你</div>
      <div className="idbox">
        <Row label="名字" value={profile?.name}
             onSave={(v) => after(() => saveProfile({ name: v }))} />
        <Row label="作品站" value={profile?.website}
             onSave={(v) => after(() => saveProfile({ website: v }))} />
        {FIELDS.map((f) => (
          <Row key={f.key} label={f.label} value={d[f.key]} hint={f.hint} long={f.long} list={f.list}
               onSave={(v) => after(() => saveProfile({ data: { [f.key]: v } }))} />
        ))}
      </div>
      <div className="idnote">
        改完 Fairwind 下一次开口就用新的——它读的就是这里，没有第二份。
      </div>
    </section>
  )
}
