# 线上版接 Gmail：每人授权自己的信箱（2026-10-06）

## 为什么现在做

10/6 他定了顺序：先让线上能连 Gmail，再把个人版的全部内容（含邮件数据）一次导进线上。
托管设计稿（2026-10-02）D9 把邮件留到"下一期"，缺的正是三件事：**令牌按人、回调走公网、收信循环按人**。

存储不变：所有信的信头进 `mail_headers`，正文只存挂到机会卡上的（`pursuit_messages.body_raw`）。

## 决定

**D1 OAuth 应用是运营方配置。** `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` 放 `/etc/fairwind/env`，跟 Supabase 的钥匙同级（不是某个人的凭据，D8 那条"key 不进 process.env"管的是每人的 key）。类型是 Google 的 **Web application**，回调 `${BRAIN_ORIGIN}/oauth/gmail/callback`。建议新建一个叫 Fairwind 的 GCP 项目（同意屏幕名干净、未验证 100 人上限独占），同意屏幕设 In production（Testing 下 refresh token 7 天过期）。

**D2 每人的钥匙存 `member_settings`。** 新列 `gmail_address`、`gmail_refresh_token`。理由：这张表本来就放每人的凭据、本来就不进备份包（0157）、读写口现成。
- `pa_member_secrets` 多回 `gmail_refresh_token`、`gmail_address`（脑子用）
- `pa_member_settings` 只回 `gmail_address`、`gmail_connected`（页面用，钥匙不回显）
- 写走新函数 `pa_set_gmail(p_address, p_refresh_token)`（invoker，`where owner = auth.uid()`）；传空 = 断开

**D3 连上 = 邮件模块开。** 不再单独让人拨"邮件"开关再去连——那是"要教才会用"。`modulesFor`：`mail = 已连 && modules.mail === true && 机会线开着`；`mailOffered = true`。连上时顺手把 `modules.mail` 写成 true，断开写 false。设置页模块面板里邮件那一行在没连时就是「连接 Gmail」按钮。

**D4 授权流程。**
1. 页面 `POST /gmail/connect`（带 JWT）→ 脑子生成随机 `state`，内存里记 `state → owner`（10 分钟过期，单进程够用；重启了就重按一次）→ 回 Google 授权网址（`access_type=offline`、`prompt=consent`，保证每次都给 refresh token）
2. 浏览器整页跳 Google → 同意 → 回 `GET /oauth/gmail/callback?code&state`。这条**不带 JWT**，放在认人那道门之前；靠 `state` 认出是谁，`forOwner` 造他的会话
3. 换码 → `getProfile` 拿地址 → `pa_set_gmail` 存钥匙 → `pa_mail_account_upsert` 登记信箱 → 后台起一次全量回填（只信头）→ 302 回 `/?gmail=connected`（失败 `/?gmail=error&why=…`）
4. `POST /gmail/disconnect`：向 Google 撤销 + 清两列 + `modules.mail=false`。库里已收的信不删（[[绝不丢信息]]）

**D5 拿 Gmail 客户端按人。** `mail/auth.js` 的 `client()` / `whoami()`：当前租户是 hosted → 用他的 refresh token 现造（同一个 owner 的客户端缓存在 `t.marks`，access token 复用）；不是 hosted → 原来那套文件，一个字不变。Google 换发新 refresh token 时写回库。授权掉了的 `MailAuthError.fix` 在线上说"去设置里重新连接 Gmail"。

**D6 收信循环按人。** 新的找活口 `pa_mail_due_all()`（definer、只读、只授 service_role，进白名单）：返回所有已连 Gmail 且邮件没关的 owner。`mailLoop` 在 hosted 下走 `forEachOwnerDue`，每人一份 `sweepMail` + `tagPass/judgePass/timerPass`。`loop.js` 的 `last/running/sweeps` 改成按租户存（有租户用 `t.marks`，没有用模块级——个人版逐字不变）。`/health` 本来就按人报，`mail` 那格自然变成"我的"。`forEachOwnerDue` 的模块判断改成参数（机会线看 pursuits，邮件看 mail）。

**D7 发信。** 走脑子自己的 OAuth（`/mail/send` 本来就是），模型照旧够不到发送。`assertSameMailbox` 照旧：画像里填的地址跟授权的不一样就拦。

**D8 认人、按线收信、刷新、放草稿箱：换成脑子自己的 Gmail 工具。** 个人版这四格借 claude.ai 的 Gmail 连接器（模型拿 `mcp__claude_ai_Gmail__*` 去搜、读、建草稿），线上没有那个连接器。`brain/mail/tools.js` 用这个人自己授权的钥匙做同样四件：`search_threads`、`get_thread`、`get_message`、`create_draft`（只建不发）。权限多要一格 `gmail.compose`（建草稿）。`server.js` 的 `gmailKit()` 按配置挑：线上用自己的，个人版照旧走连接器。顺带：GPT / Gemini 线上也能用这四格（连接器只有 Claude 有）。按线收信时「这封属于哪串」线上直接问 Gmail，不花模型。

## 这一期不做

- 邮件界面英文（约 400 句）。线上默认英文，邮件那几块暂时是中文——设置页已经有一句说明。
- 不验证的 Gmail 应用：每人授权时有一页"Google 尚未验证"，点「高级 → 继续」。

## 验收

1. 单测：`modulesFor`、`pa_set_gmail` 隔离（A 写不到 B）、`pa_mail_due_all` 进白名单且只授 service_role、hosted 下 `client()` 按租户造、loop 状态按租户分开、callback 认 state / 拒过期 state
2. 个人版（service）和 local 配置：邮件行为逐字不变（现有测试全绿）
3. 线上真机：他点「连接 Gmail」→ 回来显示已连 → 五分钟内回填开始、看板出现信 → 断开后循环不再替他收
4. `public/privacy.html` 改掉"线上不碰 Gmail"那句

## 这些名字是什么意思

| 名字 | 意思 |
|---|---|
| `member_settings` | 每人一行的设置表，放 key、语言、模块开关 |
| refresh token | Google 给的长期钥匙，凭它随时换短期的 access token 去读信 |
| `state` | 授权时带去 Google、原样带回来的一串随机码，用来认出"是谁按的" |
| `forEachOwnerDue` | 脑子后台"挨个替有活的人干活"的那个函数 |
| definer 找活口 | 唯一能跨所有人查"谁有活"的库函数，只读、只有脑子能调 |
