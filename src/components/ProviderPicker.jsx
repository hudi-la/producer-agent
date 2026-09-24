// src/components/ProviderPicker.jsx —— 模型来源:首次启动页和账号块共用这一块。
//
// 能用的两条:自己的 Claude API key;Claude 订阅(Claude Code 的登录令牌,SDK 认 CLAUDE_CODE_OAUTH_TOKEN)。
// GPT / Gemini / GPT 订阅:这套程序是 Claude Agent SDK 起子进程跑的,换不了模型——摆在这儿灰着、写明原因,
// 不做一个填了没用的格子(2026-09-24 他要的是"加几个选项",这是不骗人的加法)。
import { t } from '../i18n/index.js'

export const PROVIDERS = [
  { key: 'claude-key', label: 'Claude API key', ok: true },
  { key: 'claude-subscription', label: 'Claude 订阅', ok: true },
  { key: 'gpt', label: 'GPT', ok: false },
  { key: 'gemini', label: 'Gemini', ok: false },
]

export default function ProviderPicker({ value, onChange, apiKey, onApiKey, token, onToken, apiKeyHint, tokenHint, compact = false }) {
  return (
    <div className={'prov' + (compact ? ' compact' : '')}>
      <div className="prov-row" role="radiogroup" aria-label={t('模型来源')}>
        {PROVIDERS.map((p) => (
          <label key={p.key} className={'prov-opt' + (value === p.key ? ' on' : '') + (p.ok ? '' : ' off')} title={p.ok ? '' : t('暂不支持：Fairwind 目前只会跟 Claude 说话')}>
            <input type="radio" name="provider" value={p.key} disabled={!p.ok} checked={value === p.key} onChange={() => onChange(p.key)} />
            {p.key === 'claude-subscription' ? t('Claude 订阅') : p.label}
            {!p.ok && <small>{t('暂不支持')}</small>}
          </label>
        ))}
      </div>
      {value === 'claude-key' ? (
        <label>Anthropic API key<small>{t('模型的钱走你自己的 key。去 console.anthropic.com 建一个（sk-ant- 开头）')}</small>
          <input type="password" value={apiKey} onChange={(e) => onApiKey(e.target.value)} autoComplete="off"
                 placeholder={apiKeyHint ? t('已设置 · {hint}(要换就填新的)', { hint: apiKeyHint }) : ''} required={!apiKeyHint} /></label>
      ) : (
        <label>{t('Claude Code 的登录令牌')}<small>{t('走你的 Claude 订阅（Pro / Max）。在终端里跑一次 claude setup-token，把打出来的那一串粘到这儿')}</small>
          <input type="password" value={token} onChange={(e) => onToken(e.target.value)} autoComplete="off"
                 placeholder={tokenHint ? t('已设置 · {hint}(要换就填新的)', { hint: tokenHint }) : 'sk-ant-oat01-…'} required={!tokenHint} /></label>
      )}
    </div>
  )
}
