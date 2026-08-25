import React, { useEffect, useState } from 'react'
import { saveProfile, useProfile } from '../lib/profile.js'
import { supa } from '../lib/backends.js'
import { EditRow } from './EditRow.jsx'

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
  // 发信身份不许对不上：**用错身份发出去的信连道歉都没处发**——
  // 对方看到一个陌生地址，而你在自己的已发送里找不到它。brain 那头会当场拒发。
  { key: 'email', label: '邮箱', hint: 'Fairwind 用这个账号发信。必须是你授权给 brain 的那个 Gmail，对不上会当场拒发。' },
  { key: 'visa', label: '身份', hint: '例：O-1、绿卡、公民。Fairwind 拿它判断你能不能申。' },
  { key: 'location', label: '常住', list: true, hint: '多个地方用「、」分开。' },
  { key: 'career_stage', label: '阶段', hint: '例：emerging、mid-career。' },
  { key: 'funding_pref', label: '资助偏好', long: true },
  { key: 'exclude_rule', label: '排除规则', long: true, hint: '满足这条的机会不进主名单。写错了你会看不见一整类机会。' },
  { key: 'watch_rule', label: '关注规则', long: true, hint: '够不着但值得盯的，按这条留下来。' },
]

// 那个 Row 搬去了 EditRow.jsx —— 档案页的条目要用同一套手感（见那个文件顶上的说明）。

export default function Identity({ onSaved }) {
  const profile = useProfile()
  const d = profile?.data || {}

  // 存完把最新的读回来——不然改完这一格，别的地方（卡上的「资格搁置」）还是旧的。
  const after = async (fn) => { await fn(); await onSaved?.() }

  return (
    <section className="kind identity">
      <div className="kind-h">关于你</div>
      <div className="idbox">
        <EditRow label="名字" value={profile?.name}
             onSave={(v) => after(() => saveProfile({ name: v }))} />
        <EditRow label="作品站" value={profile?.website}
             onSave={(v) => after(() => saveProfile({ website: v }))} />
        {FIELDS.map((f) => (
          <EditRow key={f.key} label={f.label} value={d[f.key]} hint={f.hint} long={f.long} list={f.list}
               onSave={(v) => after(() => saveProfile({ data: { [f.key]: v } }))} />
        ))}
      </div>
      <div className="idnote">
        改完 Fairwind 下一次开口就用新的——它读的就是这里，没有第二份。
      </div>
      <AccountRow />
    </section>
  )
}

// 账号那一行:登录身份和登出住在「关于你」的最底下——账号的事在账号该住的
// 地方,不占顶栏。没配库(演示模式)时整行不出现。
function AccountRow() {
  const [email, setEmail] = useState(null)
  useEffect(() => {
    if (!supa) return
    supa.auth.getUser().then(({ data }) => setEmail(data?.user?.email ?? null))
  }, [])
  if (!supa || !email) return null
  return (
    <div className="idnote acct">
      登录身份:{email}
      <button type="button" className="acct-out" onClick={() => supa.auth.signOut()}>登出</button>
    </div>
  )
}
