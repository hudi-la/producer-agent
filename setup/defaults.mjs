// Fairwind 出厂默认值——学员 setup 时不用输的那部分,都在这儿。
//
// 这个文件**随仓库发**,里面没有秘密:
//   · anon key 生来就是公开的(它只能打开「登录之后走行级权限」这扇门,
//     没登录什么都读不到——0118 起 anon 被全部收走)
//   · Desktop 类型的 OAuth client secret 按 Google 的设计就不算真秘密
//     (装在每台用户机器上的东西藏不住,Google 文档自己说的)
//
// 换生产库 = 只改这一个文件。
export default {
  // ── 数据库(作者托管的那一个)──────────────────────────
  SUPABASE_URL: 'https://jsmdnzkoxudzppaczwsl.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzbWRuemtveHVkenBwYWN6d3NsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2MTUzNTUsImV4cCI6MjEwMzE5MTM1NX0.anDvvMQqYMeBik4tODaEbc1UzV8HIfIQQ4Hc2p8z82I',

  // ── Gmail 共用 OAuth 应用(作者建一次,全体学员用)────────
  // ⚠️ 还没建。开课前 Hu Di 要做的一次性动作(照 brain/README.md 那五步,
  // Desktop 类型 + PUBLISH 成 In production),建完把两个值填进来。
  // 空着的话 setup 会明说「Gmail 那步先跳过」,不会静默坏。
  GMAIL_CLIENT_ID: '',
  GMAIL_CLIENT_SECRET: '',

  // ── 模型默认档位(学员可在 setup 里改)────────────────────
  BRAIN_MODEL: 'sonnet',        // 好档:聊天、讲懂、写信
  BRAIN_MODEL_CHEAP: 'haiku',   // 便宜档:收信、认人、分诊
}
