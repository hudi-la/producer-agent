import React from 'react'

// 抽屉头上那颗开关：这张在不在桌上。
//
// 它替掉了「整页 →」。原来那颗是「带我去别处」，这颗是「记下：今天要弄它」，
// 人留在原地接着挑下一张——跟「加入购物车」一个道理。所以它得**当场翻面**：
// 按下去这颗变、顶栏数字变、看板上那张卡变，三处一起，你看得见东西去了哪。
// 翻面换色不换位——位置一动你就找不到它了。
// 图标：Lucide 的 layout-grid / check，内联 SVG，不引库。
export default function DeskToggle({ on, onToggle }) {
  return (
    <button
      type="button"
      className={'desktg' + (on ? ' on' : '')}
      aria-pressed={on}
      onClick={onToggle}
      title={on ? '在工作区里了。再按一下拿回来。' : '放到工作区——今天要弄它。你留在这儿接着挑。'}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
           strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {on
          ? <path d="M20 6 9 17l-5-5" />
          : <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
             <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>}
      </svg>
      {on ? '在工作区' : '放到工作区'}
    </button>
  )
}
