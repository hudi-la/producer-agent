// brain/engine/index.js —— 哪条引擎、连哪儿、用什么模型。
//
//   claude   Agent SDK(起 Claude Code 子进程),自己的 API key 或订阅令牌。今天的原路,一个字不变
//   openai   OpenAI 兼容接口,OPENAI_API_KEY
//   gemini   Gemini 的 OpenAI 兼容接口,GEMINI_API_KEY
// 选哪条由 FAIRWIND_PROVIDER 定(本机模式从 settings.provider 来;作者自己那份没设 = claude)。
// 模型名:两档(models.js)没配就用下面的默认;默认写死在这一处,学员在账号块里改。
import { modelFor } from '../models.js'

export const PROVIDERS = {
  claude: { label: 'Claude' },
  openai: { label: 'GPT', baseURL: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', good: 'gpt-5', cheap: 'gpt-5-mini' },
  gemini: { label: 'Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY', good: 'gemini-3.1-pro-preview', cheap: 'gemini-3.5-flash' },
}

/** 现在走哪条。'claude' | 'openai' | 'gemini' */
export function engineOf(env = process.env) {
  const p = env.FAIRWIND_PROVIDER
  return p === 'openai' || p === 'gemini' ? p : 'claude'
}

/** 非 Claude 引擎这一档该连哪儿、用什么模型。没 key 就抛,话说清楚。 */
export function providerConfig(tier, env = process.env) {
  const name = engineOf(env)
  const p = PROVIDERS[name]
  if (name === 'claude') return null
  const apiKey = env[p.keyEnv]
  if (!apiKey) throw new Error(`选了 ${p.label},但还没填它的 API key(在「关于你 → 账号」里)`)
  const model = modelFor(tier, env) || (tier === 'cheap' ? p.cheap : p.good)
  return { name, baseURL: env[`${p.keyEnv.replace('_API_KEY', '')}_BASE_URL`] || p.baseURL, apiKey, model }
}
