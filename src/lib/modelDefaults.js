// Shared by the engine and settings UI: display the same defaults that requests use.
export const PROVIDERS = {
  claude: { label: 'Claude' },
  'chatgpt-subscription': { label: 'ChatGPT 订阅' },
  // good / cheap 各是一条备选链:第一个是默认;它 404 下线、429 没额度(免费档 key 用不了 pro)、503 挤不上时,
  // 顺着往下换(engine/openaiCompat.js)。9/25 用免费档 Gemini key 实测:pro 一律 429 没额度,flash 常 503 挤,3.5-flash 和 3-flash-preview 稳。
  openai: { label: 'GPT', baseURL: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', good: ['gpt-5', 'gpt-5-mini'], cheap: ['gpt-5-mini', 'gpt-5'] },
  gemini: { label: 'Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY', good: ['gemini-3.1-pro-preview', 'gemini-3.5-flash', 'gemini-3-flash-preview'], cheap: ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash'] },
}

export function modelDefaults(provider) {
  const config = PROVIDERS[provider]
  return { model: config?.good?.[0] || (provider === 'chatgpt-subscription' ? 'Codex' : 'SDK'), modelCheap: config?.cheap?.[0] || (provider === 'chatgpt-subscription' ? 'Codex' : 'SDK') }
}

// Display labels are not model IDs. Keep an unset override unset when saving.
export function modelOverride(value, provider, field) {
  const text = value.trim()
  return text === modelDefaults(provider)[field] ? '' : text
}

// Offer only configured API models and SDK-supported Claude family aliases.
export function modelChoices(provider, field, current = '') {
  const fallback = modelDefaults(provider)[field]
  const config = PROVIDERS[provider]
  const known = config?.good ? [...config.good, ...config.cheap] : provider === 'chatgpt-subscription' ? [] : ['sonnet', 'haiku', 'opus']
  return [...new Set([fallback, ...known, ...(current ? [current] : [])])]
}

export function modelFamily(provider) {
  return !provider || provider === 'claude-key' || provider === 'claude-subscription' ? 'claude' : provider
}
