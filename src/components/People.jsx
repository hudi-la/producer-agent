import React from 'react'

// 「人际管理」——还没建，这页先占着位置。
//
// 刻意写清楚它将来是什么、以及为什么它不是「按人看机会线」：
// 这里管的是**没有 proposal 压力**的关系。朋友、同行、认识很久的人。
// 不为了申请什么，就是隔一阵子说句话、讲讲好玩的事。
//
// 所以它和项目争取是两种东西，不是同一批数据的两个视角：
//   · 单位是人，不是机会线
//   · 推着走的是「多久没联系了」，不是阶段和截止
//   · 每个人的渠道不一样——这个在微信、那个在 WhatsApp、还有的只有邮箱
//
// 这也是为什么现在这页是空的：这些人从来没进过系统，不是系统里没有他们。

export default function People() {
  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <h1>人际管理</h1>
          <p className="note">还没做。这里将来管的是<b>没有 proposal 压力</b>的关系——朋友、同行、认识很久的人。不为了申请什么，就是隔一阵子说句话。</p>
        </header>

        <div className="soon">
          <div className="soon-h">将来大概是这样</div>
          <ul className="soon-list">
            <li><b>一个人一张卡</b> —— 不挂在任何机会线上。没有项目的人也能存在。</li>
            <li><b>记住用什么找他</b> —— 微信 / WhatsApp / 邮箱 / 电话，每个人不一样，卡上写清楚。</li>
            <li><b>「该联系了」</b> —— 唯一的引擎。隔多久碰一次由你定，到点了提醒你。</li>
            <li><b>上次聊到哪</b> —— 他关心什么、答应过什么、上回说了什么好玩的。</li>
          </ul>
          <p className="soon-note">
            库里现在有 4 个联系人，但他们全都挂在机会线上（是外联对象，不是这个意思的"朋友"）。
            真正要放进来的那些人还散在各个聊天软件里——所以这页空着是对的，不是漏了什么。
          </p>
        </div>
      </div>
    </div>
  )
}
