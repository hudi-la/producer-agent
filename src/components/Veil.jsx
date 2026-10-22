import React from 'react'
import { useVeiled } from '../lib/veil.js'
import { t } from '../i18n/index.js'

// 盖在私人信息上的那朵小花。
//
// 用法：<Veil>{c.name}</Veil> —— 展示模式关着就原样渲染，开着就整个换成花。
// 是**换掉**不是糊掉：模糊或打码的话，字还在 DOM 里，
// 客户里懂行的按一下 F12 就全看见了。花底下什么都没有。
//
// 哪些包、哪些不包（跟 lib/veil.js 顶上那段同一份判断）：
//   包：联系人名字、邮箱、机构（联系人挂在哪儿是他社交网络的一部分）、你的档案
//   不包：机会线的标题和主办方（Eyebeam、Ars……）——演示的正是这些机会怎么被推进
//   不包：自由文本（信的正文、往来摘要）——这一版明说不盖，见 lib/veil.js

/** Lucide 的 flower。跟全 app 图标同一套画法：24 视口 / currentColor / 1.75 圆头。 */
export function Flower({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5" />
      <path d="M12 7.5V9" /><path d="M7.5 12H9" /><path d="M16.5 12H15" /><path d="M12 16.5V15" />
      <path d="m8 8 1.88 1.88" /><path d="M14.12 9.88 16 8" />
      <path d="m8 16 1.88-1.88" /><path d="M14.12 14.12 16 16" />
    </svg>
  )
}

export default function Veil({ children }) {
  const veiled = useVeiled()
  if (!veiled) return children ?? null
  return <span className="veil" title={t('展示模式盖住了')}><Flower /></span>
}
