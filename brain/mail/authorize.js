// `npm run mail:auth` 的入口。只做一件事：走一次 Google 授权，把凭证落盘。
//
// 这是整条链上**唯一需要你人在场**的一步。之后 refresh token 自己续，
// brain 无人值守地跑。
import { authorize, whoami, hasTokens, MailAuthError } from './auth.js'

try {
  if (hasTokens()) {
    try {
      const me = await whoami()
      console.log(`\n已经授权过了：${me.address}（信箱里 ${me.total} 封）`)
      console.log('要换账号或者授权掉了，先删掉 brain/.mail-tokens.json 再跑一次。\n')
      process.exit(0)
    } catch (_) {
      console.log('\n存着的凭证用不了了，重新授权一次。\n')
    }
  }
  const me = await authorize()
  console.log(`\n✓ 授权好了：${me.address}（信箱里 ${me.total} 封）`)
  console.log('  凭证在 brain/.mail-tokens.json（已 gitignore，别提交）\n')
} catch (err) {
  console.error(`\n✗ ${err.message}`)
  if (err instanceof MailAuthError && err.fix) console.error(`  ${err.fix}`)
  process.exit(1)
}
