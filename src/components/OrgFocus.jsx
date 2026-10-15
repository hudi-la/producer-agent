import { md, day } from '../lib/when.js'
import React, { useEffect, useState, useCallback } from 'react'
import { supa } from '../lib/backends.js'
import Veil from './Veil.jsx'
import DeskToggle from './DeskToggle.jsx'
import { useVeiled } from '../lib/veil.js'
import { t } from '../i18n/index.js'

// 机构卡。
//
// 它跟名片是两种东西，别把它做成「一个大号的人」：
//   · 机构没有「上次碰」的关系语义 —— 你不维护跟一个信箱的感情
//   · 它答的是人卡答不了的一件事：**这里有谁，谁已经走了**
//
// CultureHub 这条会告诉你「Mattie（现在）· Stacy（到 2026-07-02 为止）」——
// 这正是 Stacy 那四封旧信为什么归她的原因，摆在机构上一眼看明白。
//
// 三栏骨架跟名片一样，但中栏不给 Fairwind 讲话（你不跟一个机构商量事，
// 你跟里面的人商量），改成往来本身。


// variant / onDesk / onToggleDesk 跟名片同一套：drawer 是通讯录旁边划出来的抽屉，
// 头上一颗「放到工作区」；page 是桌上那格。
export default function OrgFocus({ org, onBack, onOpenPerson, onOpenPursuit, variant = 'page', onDesk = false, onToggleDesk }) {
  const [msgs, setMsgs] = useState(null)

  const load = useCallback(async () => {
    const boxes = (org.mailboxes || []).map((b) => b.email.toLowerCase())
    if (!supa || !boxes.length) return setMsgs([])
    const { data } = await supa
      .from('v_pa_pursuit_messages').select('*')
      .in('counterpart_email', boxes).order('created_at')
    setMsgs(data || [])
  }, [org])
  useEffect(() => { load() }, [load])

  const now  = (org.people || []).filter((p) => !p.until)
  const past = (org.people || []).filter((p) => p.until)
  // 展示模式下 title 属性也不许挂机构名——悬停一下就露了。
  const veiled = useVeiled()

  return (
    <div className={'focus ' + variant}>
      <div className="focus-top">
        <div className="ft-head">
          {variant === 'drawer' ? (
            <button className="back" onClick={onBack} aria-label={t('收起')} title={t('收起')}><span aria-hidden="true">✕</span><span className="t"> {t('收起')}</span></button>
          ) : (
            <button className="back" onClick={onBack}><span aria-hidden="true">←</span><span className="t"> {t('通讯录')}</span></button>
          )}
          <h1 className="ft-title" title={veiled ? undefined : org.org}><Veil>{org.org}</Veil></h1>
          <span className="pchip org">{t('机构')}</span>
          {variant === 'drawer' && <DeskToggle on={onDesk} onToggle={onToggleDesk} />}
        </div>
      </div>

      <div className="focus-cols">
        <aside className="fc-l">
          <div className="pf-cell">
            <div className="pf-k">{t('共享信箱')}</div>
            {org.mailboxes?.length ? org.mailboxes.map((b, i) => (
              <div key={i} className="pf-v pf-hist">
                <span className="pf-mail"><Veil>{b.email}</Veil></span>
                {b.label && <span className="pf-now-tag">{b.label}</span>}
                {/* 「它不是一个人」这件事必须写在脸上，否则下一个人又会
                    把它当成某个联系人，然后往来又归错。 */}
                {b.notes && <div className="pf-note">{b.notes}</div>}
              </div>
            )) : (
              <div className="pf-empty">{t('还没记它的共享信箱。你跟这里的往来都走个人邮箱。')}</div>
            )}
          </div>

          <div className="pf-cell">
            <div className="pf-k">{t('这里有谁')}</div>
            {now.length ? now.map((p) => (
              <button key={p.contact_id} className="pf-v pf-hist pf-link"
                      onClick={() => onOpenPerson?.(p.contact_id)}>
                <Veil>{p.name}</Veil>{p.role ? <span className="pf-note"> · {p.role}</span> : null}
              </button>
            )) : <div className="pf-empty">{t('库里还没有这里的人')}</div>}
          </div>

          {/* 走了的人不删。旧关系解释旧往来 —— Stacy 那四封信为什么是她的，
              答案就在这一行。 */}
          {past.length > 0 && (
            <div className="pf-cell">
              <div className="pf-k">{t('以前在这儿')}</div>
              {past.map((p) => (
                <button key={p.contact_id} className="pf-v pf-hist past pf-link"
                        onClick={() => onOpenPerson?.(p.contact_id)}>
                  <Veil>{p.name}</Veil>{p.role ? <span className="pf-note"> · {p.role}</span> : null}
                  <span className="pf-past-tag">{t('到 {date} 为止', { date: p.until })}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="fc-m">
          {org.pursuits?.length > 0 && (
            <div className="pf-lines">
              <span className="pf-k">{t('这个机构的机会线')}</span>
              {org.pursuits.map((p) => (
                <button key={p.id} className="lnk" onClick={() => onOpenPursuit?.(p.id)}>{p.title}</button>
              ))}
            </div>
          )}

          <div className="pf-sect-h"><span>{t('走共享信箱的往来')}</span></div>
          {msgs === null ? <p className="pf-note">{t('读着…')}</p>
           : msgs.length === 0
             ? <p className="pf-note">
                 {t('没有走共享信箱的往来。跟这个机构的信都是跟具体某个人来回的——去他的名片上看。')}
               </p>
             : (
               <div className="pf-msgs">
                 {msgs.map((m) => (
                   <div key={m.id} className="pf-msg">
                     <div className="pf-who">
                       {m.role === 'artist' ? t('你') : <Veil>{org.org}</Veil>}
                       <span className="pf-note"> · {day(m.created_at)}</span>
                       <span className="pf-tag"><Veil>{m.counterpart_email}</Veil></span>
                     </div>
                     <div className="pf-body sm">{m.content}</div>
                   </div>
                 ))}
               </div>
             )}
          <p className="pf-note">
            {t('这些信**不归任何一张名片**——共享信箱署的是一组人，摆在某个人卡上就是撒谎。')}
            {t('它们全都还挂在上面那条机会线上。')}
          </p>
        </section>

        <aside className="fc-r">
          <div className="pf-sect-h"><span>{t('这个机构是什么')}</span></div>
          <p className="pf-note">
            {t('机构条目答的是人卡答不了的一件事：')}<b>{t('这里有谁，谁已经走了')}</b>{t('。')}
            {past.length > 0 && <> {t('比如')} <Veil>{past[0].name}</Veil> {t('{date} 离开，所以她在这儿留下的旧地址仍然认得回她本人。', { date: past[0].until })}</>}
          </p>
        </aside>
      </div>
    </div>
  )
}
