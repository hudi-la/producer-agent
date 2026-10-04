import ErrorNotice from './ErrorNotice.jsx'
import React, { useEffect, useRef, useState } from 'react'
import { t } from '../i18n/index.js'
import { useVeiled } from '../lib/veil.js'
import { useGrow } from '../lib/useGrow.js'
import { Flower } from './Veil.jsx'

// 页面上「能改的字」——两种长相，一套规矩。
//
//   EditRow    左边字段名、右边值的那种行（关于你、条目的小字段）
//   InlineText 就地那种：正文本身就是编辑面（条目的标题和描述）
//
// 规矩是：**双击进编辑，点「确定」才存。**
//
// 上一版是单击进编辑、失焦就存。两个毛病，都是真挨着的：
//   · 失焦 = 落库。点一下别处、切个标签页、误触，都算你存了一次。
//     「排除规则」那种字段误存了，你会永远看不到一整类机会，而且没有任何提示。
//   · 编辑面跟正文不在一处，看的是上面那行、改的是下面另一块，得对着两处。
//
// 所以现在：改之前要双击（误触碰不到），改之后要确认（存是你说了算），
// 而且改的就是你正看着的那几个字。

/** 编辑一格的状态机。两种长相共用——分两份写的话，它们的取消/报错行为会各自漂移。 */
function useDraft(value, onSave, toText, fromText) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(() => toText(value))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  // 别处改了（另一个标签页、或刚存完重新读），没在编辑就跟着更新
  useEffect(() => { if (!editing) setText(toText(value)) }, [value, editing])

  const start = () => { setErr(null); setText(toText(value)); setEditing(true) }
  const cancel = () => { setText(toText(value)); setErr(null); setEditing(false) }

  const commit = async () => {
    const next = fromText(text)
    if (toText(next) === toText(value)) { setEditing(false); return }   // 没改动就当没发生
    setSaving(true); setErr(null)
    try {
      await onSave(next)
      setEditing(false)
    } catch (e) {
      // 存不上就留在编辑态：你打的字还在，错话就摆在下面，可以改了再存一次。
      // 退回原值的话，你刚写的东西就没了。
      setErr(e.message)
    }
    setSaving(false)
  }

  return { editing, text, setText, start, cancel, commit, saving, err }
}

/** 编辑态下面那排：确定 / 取消 / 存…… / 没存上。 */
function Actions({ d }) {
  return (
    <div className="ed-act">
      <button className="ed-ok" onMouseDown={(e) => e.preventDefault()} onClick={d.commit} disabled={d.saving}>
        {d.saving ? t('存……') : t('确定')}
      </button>
      <button className="ed-no" onMouseDown={(e) => e.preventDefault()} onClick={d.cancel} disabled={d.saving}>
        {t('取消')}
      </button>
      {d.err && <ErrorNotice error={d.err} />}
    </div>
  )
}

/** Enter / Esc。多行的用 ⌘/Ctrl+Enter 确定，光按 Enter 是换行。 */
function keyHandler(d, long) {
  return (e) => {
    if (e.key === 'Escape') { e.preventDefault(); d.cancel() }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      if (!long) { e.preventDefault(); d.commit() }
      else if (e.metaKey || e.ctrlKey) { e.preventDefault(); d.commit() }
    }
  }
}

const asText = (v, list) => (v == null ? '' : list && Array.isArray(v) ? v.join('、') : String(v))
const asValue = (s, list) =>
  list ? s.split(/[、,，]/).map((x) => x.trim()).filter(Boolean) : s.trim()

/**
 * 带字段名的一行。
 * ro   = 只读：值照常显示，但双击不进编辑（连不上库、或这条没有 id 时用）。
 * veil = 私人字段：展示模式开着时值换成小花，双击也不进编辑——
 *        编辑框里装的是真值，进去了等于当场露出来。
 */
export function EditRow({ label, value, hint, long, list, ro, veil, onSave }) {
  const d = useDraft(value, onSave, (v) => asText(v, list), (s) => asValue(s, list))
  const empty = !asText(value, list)
  const veiled = useVeiled()          // hook 不能放在 && 后面：条件调用会乱掉 hook 顺序
  const 盖着 = veil && veiled
  const ta = useRef(null)
  useGrow(ta, d.text, d.editing)

  if (盖着) {
    return (
      <div className="idrow">
        <div className="idk">{label}</div>
        <div className="idv">
          <div className="idval ro"><span className="veil" title={t('展示模式盖住了')}><Flower /></span></div>
          {hint && <div className="idhint">{hint}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="idrow">
      <div className="idk">{label}</div>
      <div className="idv">
        {d.editing ? (
          <>
            {long
              ? <textarea ref={ta} className="idin" value={d.text} rows={4} autoFocus
                          onChange={(e) => d.setText(e.target.value)} onKeyDown={keyHandler(d, true)} />
              : <input className="idin" value={d.text} autoFocus
                       onChange={(e) => d.setText(e.target.value)} onKeyDown={keyHandler(d, false)} />}
            <Actions d={d} />
          </>
        ) : (
          <div className={'idval' + (empty ? ' empty' : '') + (ro ? ' ro' : '')}
               onDoubleClick={ro ? undefined : d.start}
               title={ro ? undefined : t('双击改')}>
            {empty ? (ro ? '—' : t('双击填一下')) : asText(value, list)}
          </div>
        )}
        {hint && <div className="idhint">{hint}</div>}
      </div>
    </div>
  )
}

/**
 * 就地编辑：显示的那几个字本身就是编辑面，双击它变输入框。
 * 用在条目的标题和描述上——你看的和你改的是同一处。
 *
 * cls 是显示态用的类名（w-t / w-d），编辑态换成对应的输入框样式，
 * 好让字号行高不跳——跳一下的话，双击的瞬间整行会抖。
 */
export function InlineText({ value, cls, long, ro, placeholder, onSave }) {
  const d = useDraft(value, onSave, (v) => asText(v), (s) => asValue(s))
  const box = useRef(null)
  const ta = useRef(null)
  // 双击进编辑那一刻就量：一段 Research Statement 不该塞在五行里滚着看
  useGrow(ta, d.text, d.editing)
  const empty = !asText(value)

  // 编辑态里的点击不许冒泡到外面——外面那层点一下是展开/收起，
  // 不拦的话你点输入框就把整条折起来了。
  const stop = (e) => e.stopPropagation()

  if (d.editing) {
    return (
      <div className="inl-edit" ref={box} onClick={stop} onDoubleClick={stop}>
        {long
          ? <textarea ref={ta} className={'inl-in ' + cls} value={d.text} rows={3} autoFocus
                      onChange={(e) => d.setText(e.target.value)} onKeyDown={keyHandler(d, true)} />
          : <input className={'inl-in ' + cls} value={d.text} autoFocus
                   onChange={(e) => d.setText(e.target.value)} onKeyDown={keyHandler(d, false)} />}
        <Actions d={d} />
      </div>
    )
  }

  if (empty && (ro || !placeholder)) return null   // 空的又不能改，就别占一行

  return (
    <div
      className={cls + (empty ? ' inl-empty' : '') + (ro ? '' : ' inl-can')}
      onClick={ro ? undefined : stop}
      onDoubleClick={ro ? undefined : (e) => { stop(e); d.start() }}
      title={ro ? undefined : t('双击改')}
    >
      {empty ? placeholder : asText(value)}
    </div>
  )
}

export default EditRow
