import { useCallback, useRef, useState } from 'react'
import { sendMessageStream, stopThinking } from './chat.js'
import { useLiveReply } from './useLiveReply.js'
import { dropFrom } from './rewind.js'
import { t } from '../i18n/index.js'

/**
 * 「说一句、边想边出字、说错了重说、想太久就停」——这一整套。
 *
 * 本来它只长在 PursuitFocus 里。档案里那张书桌要同一套行为，我一开始照抄了
 * 一份，于是同一件事有两份实现：一份修好了另一份没有，而不一致的地方
 * 谁也发现不了（两处都能正常发一句话，差别只在出错那几条路上）。
 *
 * 机会线与书桌复用此 hook；联系人页面目前仍有独立编排。参数：
 *   owner       {kind,id} 或机会线的 id 字符串。发给谁，chat.js 的 ownerBody 认
 *   reload()    重读整条往来。失败兜底要用它判「我的话到底存没存上」
 *   rewind(id)  撤这条和它之后的（库那头）
 *   聊天始终请求聊天服务。健康检查不能改变用户操作，也不能将聊天写成笔记。
 *
 * 返回的 msgs 由调用方自己渲染 —— 机会线要画信卡、笔卡、邮件锚点，
 * 书桌一个都不画。那部分差别太大，不该塞进同一个组件里。
 */
export function useChat({ owner, reload, rewind }) {
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [editId, setEditId] = useState(null)
  const { live, act, onEvent: onLive, reset: resetLive } = useLiveReply()
  const runIdRef = useRef(null)

  // said 是「重说」交过来的那句改完的话。不传就是输入框里那句。
  // 两条路必须共用这一个函数：乐观插入、换掉临时条、失败时话还不还给你——
  // 那三件事分两份写，迟早有一边漏掉，而漏掉的那边会静悄悄吞掉你打的字。
  const send = useCallback(async (said) => {
    const txt = (said ?? text).trim()
    if (!txt || busy) return

    if (said == null) setText('')
    setErr(null)
    setBusy(true)
    // run_id 在这儿生成，跟着请求一起发过去——不能等回来再拿：
    // 想完了才返回，那时候早没得停了。
    const runId = crypto.randomUUID()
    runIdRef.current = runId
    const knownIds = new Set(msgs.map(m => m.id))
    const tmp = { id: 'tmp-' + Date.now(), role: 'artist', kind: 'message', content: txt }
    setMsgs((m) => [...m, tmp])
    let landedMine = null
    let aborted = false
    try {
      const r = await sendMessageStream(owner, txt, undefined, runId, (e) => {
        // 你那条一落库就回来了：拿真的换掉临时那条（临时的没有 id、没有时间）。
        if (e.t === 'mine') {
          landedMine = e.row
          setMsgs((m) => m.map((x) => (x.id === tmp.id ? e.row : x)))
        } else {
          onLive(e)
        }
      })
      aborted = r.aborted
      const you = r.mine || landedMine
      setMsgs((m) => [
        ...m.filter((x) => x.id !== tmp.id && x.id !== you?.id),
        ...(you ? [you] : []),
        ...(r.reply ? [r.reply] : []),
      ])
      return { ...r, you }
    } catch (e) {
      // 脑子是先存你的话、再去想的，所以失败有两种：
      //   连不上 → 一个字都没存 → 把内容还回输入框，别让你白打
      //   存了但想崩了 → 话已经在库里 → 不能还，还了你再发一次就重了
      let rows = null
      try { rows = await reload() } catch { /* Keep the original failure and the user's input. */ }
      const landed = landedMine || rows?.some((m) => !knownIds.has(m.id) && m.role === 'artist' && m.content === txt)
      if (rows) setMsgs(rows)
      else setMsgs((m) => m.filter((x) => x.id !== tmp.id))
      if (!landed) {
        setText((cur) => cur || txt)   // 期间你要是又打了别的，就别覆盖
        setErr(e.message + t('（你的话还在框里，没丢）'))
      } else {
        setErr(e.message + t('（你的话存下了，Fairwind 没想完 —— 再说一次让它重想）'))
      }
    } finally {
      setBusy(false)
      resetLive()
      runIdRef.current = null
      void aborted
    }
  }, [text, msgs, busy, owner, reload, onLive, resetLive])

  /**
   * 重说：撤掉这句和它之后的对话，然后把改完的这句照常发出去。
   *
   * 顺序不能反。先撤再发的话，Fairwind 拿到的是干净的往来；先发再撤，
   * 它已经带着那句错话想过一轮了——而那正是你按这个按钮要躲开的事。
   *
   * 撤失败就停在编辑态：话还在框里，错话摆在下面，你可以再按一次。
   */
  const resay = useCallback(async (id, said) => {
    const txt = said.trim()
    if (!txt || busy) return
    setErr(null)
    try {
      await rewind(id)
    } catch (e) {
      setErr(t('没撤成：') + e.message + t('（你改的字还在，可以再按一次重说）'))
      return
    }
    setEditId(null)
    setMsgs((cur) => dropFrom(cur, id))
    await send(txt)
  }, [busy, rewind, send])

  // 终止：掐掉正在跑的那一次，不写回复。你说的那句留着——它是你说的话，不是它想的。
  //
  // 拿不到 run_id 也照样把界面解开：可能是脑子重启过、或者这条「在想」是上次
  // 开着页面时留下的。那种情况下本来也没东西在跑，卡着输入框没有意义。
  const stop = useCallback(async () => {
    const rid = runIdRef.current
    setBusy(false)
    // 打到一半的那段也一起收掉：它不会落库，留在屏幕上等于给你看一份不存在的回复。
    resetLive()
    runIdRef.current = null
    if (rid) { const result = await stopThinking(rid); if (!result?.ok) setErr(t('停止请求未确认，请检查对话结果；后台任务可能仍在执行。')) }
    return rid
  }, [resetLive])

  return {
    msgs, setMsgs, text, setText, busy, err, setErr,
    editId, setEditId, live, act, send, resay, stop, runIdRef,
  }
}
