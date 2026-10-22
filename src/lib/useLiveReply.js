import { useCallback, useRef, useState } from 'react'
import { liveInit, liveStep, stripTag } from './liveText.js'
import { t } from '../i18n/index.js'

/**
 * 报工具动作那行小字。
 *
 * 为什么要有：它联网查资料那一轮**一个字都不产**，光有 delta 的话，
 * 最长的那段等待跟改之前一模一样——三个死点，看不出它在干嘛还是死了。
 *
 * 名字不认得就不说话，好过瞎报一个。
 */
// 存成函数：t() 要在用到时才调（模块加载时语言还没定）
const TOOL_SAY = {
  mcp__mailbox__read_mail: () => t('在查找邮箱里的邮件…'),
  WebSearch: () => t('在网上找资料…'),
  WebFetch: () => t('在读一个网页…'),
  mcp__pursuit_files__open_file: () => t('在翻这条线上的文件…'),
  mcp__studio_works__open_work_image: () => t('在看那件作品的图…'),
}
const toolSay = (name) =>
  TOOL_SAY[name]?.() || (name?.startsWith('mcp__gmail') ? t('在翻信箱…') : null)

/**
 * 接住「边想边出的字」。机会线和名片两处共用。
 *
 * **每个 token 不能 setState。** 一次回复几百个 token，就是几百次重渲染，
 * 再加上每次都要滚到底，页面会抖成一团。攒在 ref 里，一帧刷一次。
 *
 * **该给人看的只有回答，不含工作稿。** 它查资料之前会先说一句
 * "I'll start by loading the web tools."，那是说给自己听的；照单全收的话
 * 一轮查十几次就闪十几行英文。哪些该画由 liveText.js 那个纯状态机说了算
 * （判据跟落库那头的 foldReply 是同一条：动工具之前说的都是工作稿）。
 *
 * 用法：把 onEvent 交给 sendMessageStream / sayToContactStream，
 * 渲染时看 live 有没有字（有就渲染成气泡，没有就三个点 + act）。
 * 一轮结束记得 reset()。
 */
export function useLiveReply() {
  const [live, setLive] = useState('')
  const [act, setAct] = useState(null)
  const st = useRef(liveInit())
  const raf = useRef(0)

  const flush = useCallback(() => {
    raf.current = 0
    // 末尾那行机器读的记号（[[LETTER]] / [[FACTS]]）不给人看。落库那头
    // 也会摘掉，但屏幕比落库早几十秒——不在这儿挡，你会眼睁睁看着
    // 「[[LETTER]] {"to":…」一个字一个字长出来，然后忽然消失。
    const shown = stripTag(st.current.text)
    setLive(shown)
    // 真出字了，工具那行才让位。不能在收到 delta 的那一刻就让——
    // 那些字可能还按在手里没上屏，让早了屏幕上会空一块，看着像卡住了。
    // 看的是**挡完之后**的字：只流出来一个记号不算出字，那行小字得留着。
    if (shown) setAct(null)
  }, [])

  const onEvent = useCallback((e) => {
    if (e.t === 'delta' || e.t === 'tool') {
      st.current = liveStep(st.current, e, Date.now())
      if (!raf.current) raf.current = requestAnimationFrame(flush)
    }
    if (e.t === 'tool') {
      const say = toolSay(e.name)
      if (say) setAct(t(say))
    } else if (e.t === 'thinking') {
      // 它在想。思考不产可见的字，可能一想就是十几秒——不说一声的话，
      // 这段等待跟「卡死了」长得一模一样。
      setAct((cur) => cur || t('在想…'))
    }
  }, [flush])

  const reset = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = 0
    st.current = liveInit()
    setLive('')
    setAct(null)
  }, [])

  return { live, act, onEvent, reset }
}
