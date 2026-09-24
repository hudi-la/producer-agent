// src/components/ProviderPicker.jsx —— 模型来源:首次启动页和账号块共用这一块。
//
// 四条都能走(2026-09-24):Claude API key / Claude 订阅(Claude Code 登录令牌)走 Agent SDK;
// GPT / Gemini 走 brain/engine 里那套 OpenAI 兼容接口 + 自己的工具循环。
// 各家的 key 分开存,切来切去不丢;凭据永不回显,只给末四位。
import { t } from '../i18n/index.js'

export const PROVIDERS = [
  { key: 'claude-key', label: 'Claude API key' },
  { key: 'claude-subscription', label: 'Claude 订阅' },
  { key: 'gpt', label: 'GPT', value: 'openai' },
  { key: 'gemini', label: 'Gemini' },
]
const FIELD = {
  'claude-key': { k: 'apiKey', label: 'Anthropic API key', hint: '模型的钱走你自己的 key。去 console.anthropic.com 建一个（sk-ant- 开头）', ph: 'sk-ant-…' },
  'claude-subscription': { k: 'oauthToken', label: 'Claude Code 的登录令牌', hint: '走你的 Claude 订阅（Pro / Max）。在终端里跑一次 claude setup-token，把打出来的那一串粘到这儿', ph: 'sk-ant-oat01-…' },
  openai: { k: 'openaiKey', label: 'OpenAI API key', hint: '去 platform.openai.com 建一个（sk- 开头）。联网查走 DuckDuckGo，不用另配', ph: 'sk-…' },
  gemini: { k: 'geminiKey', label: 'Gemini API key', hint: '去 aistudio.google.com/apikey 建一个（AIza 开头）。联网查走 DuckDuckGo，不用另配', ph: 'AIza…' },
}

/** value:当前来源;keys:{apiKey,oauthToken,openaiKey,geminiKey} 正在输入的;hints:{apiKey:'sk-ant-…1234',…} 已设置的末四位 */
export default function ProviderPicker({ value, onChange, keys, onKey, hints = {}, compact = false }) {
  const f = FIELD[value] || FIELD['claude-key']
  return (
    <div className={'prov' + (compact ? ' compact' : '')}>
      <div className="prov-row" role="radiogroup" aria-label={t('模型来源')}>
        {PROVIDERS.map((p) => { const v = p.value || p.key; return (
          <label key={p.key} className={'prov-opt' + (value === v ? ' on' : '')}>
            <input type="radio" name="provider" value={v} checked={value === v} onChange={() => onChange(v)} />
            {p.key === 'claude-subscription' ? t('Claude 订阅') : p.label}
          </label>
        ) })}
      </div>
      <label>{t(f.label)}<small>{t(f.hint)}</small>
        <input type="password" value={keys[f.k] || ''} onChange={(e) => onKey(f.k, e.target.value)} autoComplete="off"
               placeholder={hints[f.k] ? t('已设置 · {hint}(要换就填新的)', { hint: hints[f.k] }) : f.ph} required={!hints[f.k]} /></label>
    </div>
  )
}
