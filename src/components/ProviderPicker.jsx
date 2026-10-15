import ErrorNotice from './ErrorNotice.jsx'
// src/components/ProviderPicker.jsx —— 模型来源:首次启动页和账号块共用这一块。
//
// 模型来源:Claude API key / Claude 订阅(Claude Code 登录令牌)走 Agent SDK;
// GPT / Gemini 走 brain/engine 里那套 OpenAI 兼容接口 + 自己的工具循环。
// 各家的 key 分开存,切来切去不丢;凭据永不回显,只给末四位。
import { useEffect, useRef, useState } from 'react'
import { brainApi, DB_MODE } from '../lib/backends.js'
import { t } from '../i18n/index.js'

export const PROVIDERS = [
  { key: 'claude-key', label: 'Claude API key' },
  { key: 'claude-subscription', label: 'Claude 订阅' },   // i18n-ok 显示时过 t()(t(p.label) / t(f.label) / t(f.hint)),英文在 en.js
  { key: 'gpt', label: 'GPT API', value: 'openai' },
  { key: 'chatgpt-subscription', label: 'ChatGPT 订阅' },   // i18n-ok 显示时过 t()(t(p.label) / t(f.label) / t(f.hint)),英文在 en.js
  { key: 'gemini', label: 'Gemini' },
]
const FIELD = {
  'claude-key': { k: 'apiKey', label: 'Anthropic API key', hint: '模型的钱走你自己的 key。去 console.anthropic.com 建一个（sk-ant- 开头）', ph: 'sk-ant-…' },   // i18n-ok 显示时过 t()(t(p.label) / t(f.label) / t(f.hint)),英文在 en.js
  'claude-subscription': { k: 'oauthToken', label: 'Claude Code 的登录令牌', hint: '走你的 Claude 订阅（Pro / Max）。在终端里跑一次 claude setup-token，把打出来的那一串粘到这儿', ph: 'sk-ant-oat01-…' },   // i18n-ok 显示时过 t()(t(p.label) / t(f.label) / t(f.hint)),英文在 en.js
  openai: { k: 'openaiKey', label: 'OpenAI API key', hint: '去 platform.openai.com 建一个（sk- 开头）。联网查走 DuckDuckGo，不用另配', ph: 'sk-…' },   // i18n-ok 显示时过 t()(t(p.label) / t(f.label) / t(f.hint)),英文在 en.js
  gemini: { k: 'geminiKey', label: 'Gemini API key', hint: '去 aistudio.google.com/apikey 建一个（AIza 开头）。联网查走 DuckDuckGo，不用另配', ph: 'AIza…' },   // i18n-ok 显示时过 t()(t(p.label) / t(f.label) / t(f.hint)),英文在 en.js
}

/** value:当前来源;keys:{apiKey,oauthToken,openaiKey,geminiKey} 正在输入的;hints:{apiKey:'sk-ant-…1234',…} 已设置的末四位
 *  inUse:已存下、正在用的来源(账号块传;黑药丸只是「选中」,点了保存才算换——不标出来就看不出现在在用哪个) */
export default function ProviderPicker({ value, onChange, keys, onKey, hints = {}, compact = false, inUse, onConnected }) {
  const f = FIELD[value] || FIELD['claude-key']
  return (
    <div className={'prov' + (compact ? ' compact' : '')}>
      <div className="prov-row" role="radiogroup" aria-label={t('模型来源')}>
        {PROVIDERS.map((p) => { const v = p.value || p.key;  return (
          <label key={p.key} className={'prov-opt' + (value === v ? ' on' : '')}>
            <input type="radio" name="provider" value={v} checked={value === v} onChange={() => onChange(v)} />
            {t(p.label)}{inUse === v && <small className="prov-inuse">· {t('在用')}</small>}
          </label>
        ) })}
      </div>
      {inUse && value !== inUse && <small className="prov-unsaved">{t('还没保存：现在在用的还是 {p}。点「保存」才换过去', { p: t(PROVIDERS.find((p) => (p.value || p.key) === inUse)?.label || inUse) })}</small>}
      {value === 'chatgpt-subscription' ? <ChatGPTLogin onConnected={onConnected} /> : value === 'claude-subscription' ? <ClaudeLogin hint={hints.oauthToken} keys={keys} onKey={onKey} onConnected={onConnected} /> : <label>{t(f.label)}<small>{t(f.hint)}</small>
        <input key={f.k} type="password" value={keys[f.k] || ''} onChange={(e) => onKey(f.k, e.target.value)} autoComplete="new-password"
               placeholder={hints[f.k] ? t('已设置 · {hint}(要换就填新的)', { hint: hints[f.k] }) : f.ph} required={!hints[f.k]} /></label>}
    </div>
  )
}

function ChatGPTLogin({ onConnected }) {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestVersion = useRef(0)
  const loginBusy = useRef(false)
  useEffect(() => {
    let active = true, timer
    const poll = async () => {
      if (loginBusy.current) { timer = setTimeout(poll, 2000); return }
      const version = requestVersion.current
      try {
        const r = await brainApi.chatgpt.status()
        if (!active) return
        if (version === requestVersion.current && !loginBusy.current) {
          setStatus(r)
          setError(r.error?.message || '')
        }
        timer = setTimeout(poll, r.pending ? 2000 : 10000)
      } catch (e) {
        if (!active) return
        if (version === requestVersion.current && !loginBusy.current) setError(e.message)
        timer = setTimeout(poll, 2000)
      }
    }
    poll()
    return () => { active = false; clearTimeout(timer) }
  }, [])
  useEffect(() => { onConnected?.(Boolean(status?.connected)) }, [status?.connected])
  const login = async (restart = false) => {
    if (loginBusy.current) return
    loginBusy.current = true; requestVersion.current++
    setBusy(true); setError(''); setStatus(null)
    try {
      const r = await brainApi.chatgpt.login({ restart })
      setStatus(r)
      setError(r.error?.message || '')
    } catch (e) { setError(e.message) }
    finally { loginBusy.current = false; setBusy(false) }
  }
  return <div className="prov-login">
    <small>{t('通过 Codex 使用你的 ChatGPT 订阅额度，无需 API key。额度和模型取决于你的套餐。')}</small>
    {/* 已连上:换账号是偶尔的事,一个小链接就够(2026-10-08 他说大黑按钮太抢,「重新登录」也不如「登录另一个账户」说得清) */}
    {status?.connected ? <div><p role="status">{t('已连接 ChatGPT')} · {status.email} {status.plan && `(${status.plan})`}</p><button type="button" className="lnk prov-switch" disabled={busy} onClick={() => login()}>{t('登录另一个账户')}</button></div>
      : <>
        <button type="button" className="b" disabled={busy || status?.pending} onClick={() => login()}>{busy ? t('正在连接…') : t('登录 ChatGPT')}</button>
        {status?.pending && <p role="status">{t('等待你在 ChatGPT 完成授权…')}</p>}
        {status?.userCode && <label>{t('一次性验证码')}<input readOnly value={status.userCode} onFocus={(e) => e.target.select()} /><small>{t('打开下面的登录页面，输入此验证码。请勿分享给他人。')}</small></label>}
        {status?.authUrl && <p><a href={status.authUrl} target="_blank" rel="noopener noreferrer">{t('打开 ChatGPT 登录页面')}</a><small>{t('登录完成后回到这里，再保存或开始。')}</small></p>}
      </>}
    {DB_MODE === 'cloud' && <small>{t('授权凭据保存在 Fairwind 服务器上你的独立账号目录，用于运行你的任务。')}</small>}
    {DB_MODE === 'cloud' && !status?.connected && <div className="prov-retry">
      <p><strong>{t('刚去 ChatGPT 开启了设备码登录权限？')}</strong></p>
      <small>{t('如提示设备码登录未开启，请在 ChatGPT 的安全设置中开启后重试。')}</small>
      <small>{t('开启权限后还没有连接成功。请回到这里点下面的按钮，获取新的验证码，再打开 ChatGPT 登录页面输入新验证码并授权。')}</small>
      <button type="button" className="b" disabled={busy} onClick={() => login(true)}>{busy ? t('正在连接…') : t('已开启权限，重新连接 ChatGPT')}</button>
      <small>{t('请使用重新连接后显示的新验证码。等这里显示「已连接 ChatGPT」，再点「开始使用」或保存。')}</small>
    </div>}
    {error && <ErrorNotice error={error} context={t('模型来源')} />}
  </div>
}

// Claude 订阅:一颗按钮登录,不用开终端。包里自带的 Claude 程序跑 setup-token,我们只是替学员把链接和那串码来回传。
// 三个状态各一个样子:没连 → 一颗按钮;等码 → 两步卡片(去登录 / 粘码);连上 → 一行绿勾。等待的时候按钮里转圈、写清在等什么。
export function Spin() { return <span className="spin" aria-hidden="true" /> }

function ClaudeLogin({ hint, keys, onKey, onConnected }) {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState('')          // '' | 'start' | 'code'
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [manual, setManual] = useState(false)
  useEffect(() => { let on = true; brainApi.claude.status().then((r) => { if (on) { setStatus(r); if (r.error) setError(r.error.message) } }); return () => { on = false } }, [])
  const login = async () => {
    setBusy('start'); setError(''); setCode('')
    const r = await brainApi.claude.login(); setBusy(''); setStatus(r)
    if (r.error) setError(r.error.message); else if (r.authUrl) window.open(r.authUrl, '_blank', 'noopener')
  }
  const submit = async () => { setBusy('code'); setError(''); const r = await brainApi.claude.code(code); setBusy(''); setStatus(r); if (r.error) setError(r.error.message); else setCode('') }
  const connected = status?.connected || (!status && hint)
  const waiting = status?.awaitingCode
  useEffect(() => { onConnected?.(Boolean(connected && !waiting)) }, [connected, waiting])
  const where = DB_MODE === 'cloud' ? t('只存在你的账号里。') : t('只存在这台机器上。')
  return <div className="prov-login">
    <small className="prov-lead">{t('走你的 Claude 订阅（Pro / Max）。登录一次，拿到的是一年期令牌，')}{where}</small>

    {connected && !waiting && <div className="cl-ok" role="status">
      <span className="cl-check" aria-hidden="true">✓</span>
      <span>{t('已连接 Claude')}{(status?.hint || hint) ? <small> · {status?.hint || hint}</small> : null}</span>
      <button type="button" className="lnk prov-switch" disabled={!!busy} onClick={login}>{busy === 'start' ? <><Spin />{t('正在打开…')}</> : t('登录另一个账户')}</button>
    </div>}

    {!connected && !waiting && <button type="button" className="b" disabled={!!busy} onClick={login}>
      {busy === 'start' ? <><Spin />{t('正在打开 Claude 登录页…')}</> : t('登录 Claude')}
    </button>}

    {waiting && <ol className="cl-steps">
      <li>
        <b>{t('在新标签页登录 Claude')}</b>
        <small>{t('没弹出来？')}<a href={status.authUrl} target="_blank" rel="noopener noreferrer">{t('点这里打开')}</a></small>
      </li>
      <li>
        <b>{t('把页面最后给的那串码粘到这里')}</b>
        <div className="prov-code-row">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('把那串码粘到这儿')} autoComplete="off" disabled={busy === 'code'}
                 onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (code.trim() && !busy) submit() } }} />
          <button type="button" className="b primary" disabled={!!busy || !code.trim()} onClick={submit}>{busy === 'code' ? <><Spin />{t('正在连接…')}</> : t('提交')}</button>
        </div>
        {busy === 'code' && <small className="cl-wait">{t('Claude 在核对这串码，一般几秒钟。')}</small>}
      </li>
    </ol>}

    {error && <ErrorNotice error={error} context={t('模型来源')} />}

    <div className="cl-manual">
      <a href="#" onClick={(e) => { e.preventDefault(); setManual((m) => !m) }}>{manual ? t('收起') : t('已经有令牌？自己粘')}</a>
      {manual && <label>{t('Claude Code 的登录令牌')}<small>{t('在终端里跑一次 claude setup-token，把打出来的那一串粘到这儿')}</small>
        <input key="oauthToken" type="password" value={keys.oauthToken || ''} onChange={(e) => onKey('oauthToken', e.target.value)} autoComplete="new-password" placeholder="sk-ant-oat01-…" /></label>}
    </div>
  </div>
}
