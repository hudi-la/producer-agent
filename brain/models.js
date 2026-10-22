// 模型分两档。给「打包给学员」铺的路,规矩见 models.test.js 顶上那三条。
//
// 谁走哪档(接线在 server.js 和 mail/ask.js):
//   便宜档 CHEAP —— 判断类(JUDGE_SYSTEM 那四处)、邮件小活(ask.js 全部)、
//     Gmail 后台四处(建草稿/查 thread/认人/收信):机械抽取和小判断,便宜模型够用。
//   好档 GOOD —— 聊天、讲懂、写信、催办、重排待办、带全卷宗的判笔记:
//     带人格和战绩信息库、或产出要落到人眼前的那些。
//
// 两档都不配 = SDK 默认(订阅路径),这是 Hu Di 自己的用法,一个字不变。
// 学员的 .env 里配上自己的 ANTHROPIC_API_KEY + 两档模型,钱走自己的 key。
import { envNow } from './tenant.js'

export const GOOD = 'good'
export const CHEAP = 'cheap'

const KEYS = { [GOOD]: 'BRAIN_MODEL', [CHEAP]: 'BRAIN_MODEL_CHEAP' }

/** 这一档该用什么模型。没配(含空白)= null = 让 SDK 用默认。 */
export function modelFor(tier, env = envNow()) {
  const m = env[KEYS[tier]]
  return m && m.trim() ? m.trim() : null
}

/** 往 query 的 options 里挂 model。null 时不挂键——挂了空值 SDK 会当真。 */
export function withModel(opts, tier, env = envNow()) {
  const model = modelFor(tier, env)
  return model ? { ...opts, model } : { ...opts }
}
