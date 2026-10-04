import ErrorNotice from './ErrorNotice.jsx'
import React from 'react'
import { t } from '../i18n/index.js'
import { FELL_BACK } from '../lib/backends.js'

// 托管版(线上)学员没有终端,脑子由服务器管——别叫他们跑命令
const HOSTED = (import.meta.env || {}).VITE_HOSTED === '1'

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
//   warn   —— 数据是真的，但 Fairwind 不干活了。

const DANGER = {
  [FELL_BACK.NO_CONFIG]: {
    title: t('没连数据库 —— 现在看到的全是示例假数据'),
    fix: t('检查 .env.local 里的 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY'),
  },
  [FELL_BACK.QUERY_FAILED]: {
    title: t('数据库连不上 —— 现在看到的全是示例假数据'),
    fix: null,   // 用库返回的原话，比我编的准
  },
}

// 空不是出事(2026-08-25 多租户之后):连上了、你也登录了,只是这个账号
// 还什么都没有——每个新账号的第一眼就是它。数据是真的(真的空),不飘红。
// 但留一句给「本来有数据却看见空」的人:那种空是事故,别当成正常。
const FRESH = {
  title: t('这里还是空的'),
  fix: t('新账号从「我的档案」把自己填进去开始。要是你确定原来有数据,现在却是空的——那不正常,先核对登录的账号对不对。'),
}

export default function Trouble({ fellBack, detail, brainDown, brainStale, batchFailed, mail }) {
  const bad = fellBack ? DANGER[fellBack] : null
  const fresh = fellBack === FELL_BACK.EMPTY ? FRESH : null
  // note 是「这一轮发生了什么」，**包括什么都没发生**。它不是出事，
  // 所以另起一档 quiet：不红不黄，说完一句就等你划掉。
  //
  // 为什么它非得有个位置：原来整轮跑完屏幕上一点动静没有，于是「没有新信」
  // 和「按钮坏了」长得一模一样。树皮书那次就是这么被当成坏了的。
  // 邮件那一轮出了事才说：授权掉了、或者太久没收到了。
  // 正常在跑的时候顶栏那句就够了，这儿闭嘴。
  const mailBad = mail && mail.ok === false ? mail : null
  if (!bad && !fresh && !brainDown && !brainStale && !batchFailed && !mailBad) return null

  return (
    <div className="trouble">
      {mailBad && <ErrorNotice error={[mailBad.note, mailBad.fix].filter(Boolean).join(' · ')} context={t('邮件')} />}
      {bad && <ErrorNotice error={detail || bad.fix || bad.title} context={bad.title} />}
      {fresh && (
        <div className="tr-row warn" role="status">
          <span className="tr-dot" aria-hidden="true" />
          <span className="tr-txt">
            <b>{fresh.title}</b>
            <span className="tr-fix">{fresh.fix}</span>
          </span>
        </div>
      )}
      {brainDown && (
        <div className="tr-row warn" role="status">
          <span className="tr-dot" aria-hidden="true" />
          <span className="tr-txt">
            <b>{t('Fairwind 的脑子没开')}</b>
            <span className="tr-fix">
              {t('新机会的卡不会被自动读透，也没法和 Fairwind 对话。数据是真的，只是它不干活。')}
              {HOSTED ? t('服务器那边暂时没应,过一会儿刷新再试;一直这样就告诉 Hu Di。') : <>{t('另开一个终端跑 ')}<code>npm run brain</code></>}
            </span>
          </span>
        </div>
      )}
      {/* 脑子开着，但跑的是旧代码。这个最阴：一切看着都正常，只是新加的行为
          （比如后台读卡）根本没生效，而且没有任何迹象。 */}
      {brainStale && !brainDown && !HOSTED && (
        <div className="tr-row warn" role="status">
          <span className="tr-dot" aria-hidden="true" />
          <span className="tr-txt">
            <b>{t('脑子跑的是旧代码')}</b>
            <span className="tr-fix">
              {t('它开着，但启动之后代码又改过——新加的行为不会生效，而且看不出来。')}
              {t('到跑 brain 的那个终端按 Ctrl-C，再 ')}<code>npm run brain</code>
            </span>
          </span>
        </div>
      )}
      {/* 整批跑（「更新最新信息」/「说一句…」）上一轮有线没跑成。数据是真的，
          只是有几条这轮没轮到——静默失败是最坏的，所以哪怕只挂一条也要在这儿说话。
          两种批量合并成一句：对你来说都是「刚才那批有几条没成」，分开报只是多两行噪音。 */}
      {batchFailed > 0 && (
        <div className="tr-row warn" role="status">
          <span className="tr-dot" aria-hidden="true" />
          <span className="tr-txt">
            <b>{t('有 {n} 条线这轮没跑成', { n: batchFailed })}</b>
            <span className="tr-fix">
              {t('部分任务未完成，请查看错误提示并检查结果，再重试失败的项目。')}
              {t('再跑一次会重试（要群发的话就再勾一次）。')}
            </span>
          </span>
        </div>
      )}
    </div>
  )
}
