import React from 'react'
import { t } from '../i18n/index.js'

// 看板和通讯录头一行共用的那一段：平时是各自的动作按钮（children），
// 勾选时换成「已选 N · 说一句… · 全部展开 · 取消」。两边勾的是同一摞 picked，
// 所以这一段也只能是同一份——抄两遍迟早一边改了措辞另一边没改。
//
// 动作跟着它作用的东西走，不再站在导航带子上（2026-09-02，工作区那稿）。
// 「说一句…」在前：它是主动作，「全部展开」只是把这几张摆进那一排。
// （原来叫「过一遍」——过卡那套 2026-09-02 整个并进「展开的卡片」了，名字跟着走。）
export default function PickBar({ picking, pickedCount, saying, onStart, onCancel, onSay, onPickAll, children }) {
  return (
    <div className="areabar">
      {picking && <span className="pickinfo">{t('已选 {n} 张', { n: pickedCount })}</span>}
      {/* 系统在报，不能点——所以不进按钮组，灰字带转圈 */}
      {saying && <span className="refreshing"><i className="spin" aria-hidden="true" />{t('说给第 {i}/{n} 条', { i: saying.i, n: saying.n })}</span>}
      <span className="sp" />
      {picking ? (
        <>
          <button className="wbtn" disabled={!pickedCount || Boolean(saying)} onClick={onSay}>{t('说一句…')}</button>
          <button className="wbtn" disabled={!pickedCount} onClick={onPickAll}>{t('全部展开')}</button>
          <button className="btn" onClick={onCancel}>{t('取消')}</button>
        </>
      ) : (
        <>
          {children}
          <button className="wbtn" onClick={onStart}>{t('批量操作')}</button>
        </>
      )}
    </div>
  )
}
