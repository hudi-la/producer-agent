import React, { useEffect, useState } from 'react'
import { t } from '../i18n/index.js'
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
  // veil = 展示模式下盖小花的私人字段。规则类（资助偏好/排除/关注）不盖：
  // 它们讲的是机会怎么筛，正是演示要给人看的；名字/邮箱/身份/常住是你这个人。
  { key: 'email', label: t('邮箱'), veil: true, hint: t('Fairwind 用这个账号发信。必须是你授权给 brain 的那个 Gmail，对不上会当场拒发。') },
  { key: 'visa', label: t('身份'), veil: true, hint: t('例：O-1、绿卡、公民。Fairwind 拿它判断你能不能申。') },
  { key: 'location', label: t('常住'), list: true, veil: true, hint: t('多个地方用「、」分开。') },
  { key: 'career_stage', label: t('阶段'), hint: t('例：emerging、mid-career。') },
  { key: 'funding_pref', label: t('资助偏好'), long: true },
  { key: 'exclude_rule', label: t('排除规则'), long: true, hint: t('满足这条的机会不进主名单。写错了你会看不见一整类机会。') },
  { key: 'watch_rule', label: t('关注规则'), long: true, hint: t('够不着但值得盯的，按这条留下来。') },
]

// 那个 Row 搬去了 EditRow.jsx —— 档案页的条目要用同一套手感（见那个文件顶上的说明）。

export default function Identity({ onSaved }) {
  const profile = useProfile()
  const d = profile?.data || {}

  // 存完把最新的读回来——不然改完这一格，别的地方（卡上的「资格搁置」）还是旧的。
  const after = async (fn) => { await fn(); await onSaved?.() }

  return (
    <section className="kind identity">
      <div className="kind-h">{t('关于你')}</div>
      <div className="idbox">
        <EditRow label={t('名字')} value={profile?.name} veil
             onSave={(v) => after(() => saveProfile({ name: v }))} />
        <EditRow label={t('作品站')} value={profile?.website}
             onSave={(v) => after(() => saveProfile({ website: v }))} />
        {FIELDS.map((f) => (
          <EditRow key={f.key} label={f.label} value={d[f.key]} hint={f.hint} long={f.long} list={f.list} veil={f.veil}
               onSave={(v) => after(() => saveProfile({ data: { [f.key]: v } }))} />
        ))}
      </div>
      <div className="idnote">
        {t('改完 Fairwind 下一次开口就用新的——它读的就是这里，没有第二份。')}
      </div>
      <AccountRow />
    </section>
  )
}

// 账号那一行:登录身份和登出住在「关于你」的最底下。没配库(演示模式)时整行不出现。
// 本机模式没有登录这回事;邮箱、key、模型档位、备份目录都在「设置」(SettingsPage)。
// 线上版(托管)不画:右上角那颗账号菜单(AccountMenu.jsx)就是你是谁 + 退出,这儿再放一行是重复(2026-10-03)。
// 他自己的个人云端版(没有 VITE_HOSTED)右上角是展示模式,登出还得住这儿。
const HOSTED = (import.meta.env || {}).VITE_HOSTED === '1'
function AccountRow() {
  const [email, setEmail] = useState(null)
  useEffect(() => {
    if (HOSTED || !supa || supa.mode === 'local') return
    supa.auth.getUser().then(({ data }) => setEmail(data?.user?.email ?? null))
  }, [])
  if (HOSTED || supa?.mode === 'local') return null   // 本机:账号的事都在「设置」;托管:右上角账号菜单
  if (!supa || !email) return null
  return (
    <div className="idnote acct">
      {t('登录身份:')}{email}
      <button type="button" className="acct-out" onClick={() => supa.auth.signOut()}>{t('登出')}</button>
    </div>
  )
}
