import React from 'react'
import { t } from '../i18n/index.js'

// 抽屉头上那颗按钮：这张在不在「展开的卡片」里。
//
// 按下去两种意思，看它现在是哪一面：
//   没展开 —— 「展开」：摆进去，**人留在原地**接着挑（带一个飞过去的动画）
//   已展开 —— 「在展开的卡片区 →」：带你过去看它
// 它不再是「再按一下拿走」。拿走只有一个出口：那排卡片上的 ×。
// 一颗按钮既能放进去又能拿走，看着一样、按下去两个结果，你得先想它现在是哪面。
//
// 它替掉了「整页 →」。原来那颗是「带我去别处」，这颗是「记下：今天要弄它」，
// 人留在原地接着挑下一张——跟「加入购物车」一个道理。所以它得**当场翻面**：
// 按下去这颗变、顶栏数字变、看板上那张卡变，三处一起，你看得见东西去了哪。
// 翻面换色不换位——位置一动你就找不到它了。
// 图标：Lucide 的 layout-grid / check，内联 SVG，不引库。
// onToggle 收到按钮本身（事件目标）：飞入动画要从它的位置起飞。
export default function DeskToggle({ on, onToggle }) {
  return (
    <button
      type="button"
      className={'desktg' + (on ? ' on' : '')}
      aria-pressed={on}
      onClick={(e) => onToggle?.(e.currentTarget)}
      title={on ? t('去「展开的卡片」看它。要拿走，在那排卡片上按 ×。') : t('展开——今天要弄它。你留在这儿接着挑，挑完点顶栏「展开的卡片」过去。')}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
           strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {on
          ? <path d="M20 6 9 17l-5-5" />
          : <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
             <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>}
      </svg>
      {on ? <>{t('在展开的卡片区')} <span aria-hidden="true">→</span></> : t('展开')}
    </button>
  )
}
