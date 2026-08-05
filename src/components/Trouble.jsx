import React from 'react'
import { FELL_BACK } from '../lib/backends.js'

// 出事了才说话。
//
// 原来顶栏挂着一个「已连 Supabase」的常亮徽章——正常状态天天亮着，
// 出事状态（灰色的「种子数据」）反而更不起眼。你每天看它一百次都是「一切正常」，
// 等真出事那天多半会直接看漏。
//
// 所以反过来：正常时这里什么都不渲染，出事时才出现，而且要说清是哪儿出的事。
//
// 两档严重程度，别混为一谈：
//   danger —— 你看到的数据是假的。基于它做的任何判断都不作数。
//   warn   —— 数据是真的，但渡不干活了。

const DANGER = {
  [FELL_BACK.NO_CONFIG]: {
    title: '没连数据库 —— 现在看到的全是示例假数据',
    fix: '检查 .env.local 里的 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY',
  },
  [FELL_BACK.QUERY_FAILED]: {
    title: '数据库连不上 —— 现在看到的全是示例假数据',
    fix: null,   // 用库返回的原话，比我编的准
  },
  [FELL_BACK.EMPTY]: {
    title: '数据库是空的 —— 现在显示的是示例假数据',
    fix: '库连上了但一行都没有。跑过 supabase/seed 里的种子了吗？',
  },
}

export default function Trouble({ fellBack, detail, brainDown }) {
  const bad = fellBack ? DANGER[fellBack] : null
  if (!bad && !brainDown) return null      // 一切正常 → 闭嘴

  return (
    <div className="trouble">
      {bad && (
        <div className="tr-row danger">
          <span className="tr-dot" aria-hidden="true" />
          <span className="tr-txt">
            <b>{bad.title}</b>
            {(detail || bad.fix) && <span className="tr-fix">{detail || bad.fix}</span>}
          </span>
        </div>
      )}
      {brainDown && (
        <div className="tr-row warn">
          <span className="tr-dot" aria-hidden="true" />
          <span className="tr-txt">
            <b>渡的脑子没开</b>
            <span className="tr-fix">
              待批准的卡不会被自动读透，也没法和渡对话。数据是真的，只是它不干活。
              另开一个终端跑 <code>npm run brain</code>
            </span>
          </span>
        </div>
      )}
    </div>
  )
}
