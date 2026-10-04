// brain/engine/index.js —— 哪条引擎、连哪儿、用什么模型。
//
//   claude   Agent SDK(起 Claude Code 子进程),自己的 API key 或订阅令牌。今天的原路,一个字不变
//   openai   OpenAI 兼容接口,OPENAI_API_KEY
//   chatgpt-subscription   官方 Codex app-server,独立登录,走 ChatGPT 订阅
//   gemini   Gemini 的 OpenAI 兼容接口,GEMINI_API_KEY
// 选哪条由 FAIRWIND_PROVIDER 定(本机模式从 settings.provider 来;作者自己那份没设 = claude)。
// 模型名:两档(models.js)没配就用下面的默认;默认写死在这一处,学员在账号块里改。
import { modelFor } from '../models.js'
import { envNow } from '../tenant.js'

import { PROVIDERS } from '../../src/lib/modelDefaults.js'
export { PROVIDERS } from '../../src/lib/modelDefaults.js'

/** 现在走哪条。'claude' | 'openai' | 'gemini' | 'chatgpt-subscription' */
export function engineOf(env = envNow()) {
  const p = env.FAIRWIND_PROVIDER
  return p === 'openai' || p === 'gemini' || p === 'chatgpt-subscription' ? p : 'claude'
}

/** 非 Claude 引擎这一档该连哪儿、用什么模型。没 key 就抛,话说清楚。 */
export function providerConfig(tier, env = envNow()) {
  const name = engineOf(env)
  const p = PROVIDERS[name]
  if (name === 'claude') return null
  if (name === 'chatgpt-subscription') return { name, model: modelFor(tier, env), dataDir: env.FAIRWIND_DATA_DIR }
  const apiKey = env[p.keyEnv]
  if (!apiKey) throw new Error(`选了 ${p.label},但还没填它的 API key(在「关于你 → 账号」里)`)
  const chain = tier === 'cheap' ? p.cheap : p.good
  const model = modelFor(tier, env) || chain[0]
  return { name, baseURL: env[`${p.keyEnv.replace('_API_KEY', '')}_BASE_URL`] || p.baseURL, apiKey, model, fallbacks: chain.filter((m) => m !== model) }
}
