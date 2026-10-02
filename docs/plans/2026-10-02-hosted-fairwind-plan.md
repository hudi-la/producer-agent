# 托管的 Fairwind · 施工计划

设计稿：[2026-10-02-hosted-fairwind-design.md](../specs/2026-10-02-hosted-fairwind-design.md)。
分支 `workshop-edition`，worktree `.claude/worktrees/workshop-edition`。每个任务：先写测试、看它红、再写实现、看它绿、提交。
闸：`npm test` 全程全绿；单人配置（local / service）行为逐字不变。

## 阶段 A · 库（不等公司的 Supabase）

**A1 · 0150 member_settings**
- 表 `producer.member_settings(owner uuid pk default auth.uid() references auth.users on delete cascade, provider text default 'claude-key', api_key text, oauth_token text, openai_key text, gemini_key text, model text, model_cheap text, lang text default 'zh', judgments_enabled bool default true, modules jsonb default '{"profile":true,"pursuits":true,"mail":false}', mcp_token text default encode(gen_random_bytes(24),'hex'), updated_at timestamptz)`；RLS own_rows；授 authenticated + service_role。
- `pa_member_settings()` 返回一行，key 字段只回显 `…末 6 位`、另给 `*_set bool`。`pa_set_member_settings(p jsonb)`：只改传了的字段；空串 = 清掉。`pa_rotate_mcp_token()`。
- `handle_new_user` 加一句 insert member_settings。
- 测试：`brain/local/migrate.test.js` 风格，PGlite 上跑全部迁移后：注册用户 → 有一行；A 看不见 B；`pa_member_settings` 不回显全 key。

**A2 · 0151 judgment_docs**
- 表 `(owner, name text, body text, updated_at)` pk (owner, name)；RLS；`pa_judgment_docs()`、`pa_set_judgment_doc(name, body)`、`pa_drop_judgment_doc(name)`。
- 测试同上。

**A3 · 0152 五个 definer 改回 invoker + 收回 anon**
- `create or replace` 五个函数，不写 `security definer`；`revoke all on function … from anon`；再扫一遍：`revoke execute on all functions in schema public from anon`。
- 测试：PGlite 查 `pg_proc.prosecdef` 对 `public.pa_%` 全为 false；`has_function_privilege('anon', …)` 全为 false。**同一条判据加进 `scripts/isolation-test.mjs`。**

**A4 · 0153 桶策略按 owner**
- 三条策略改成 `bucket_id = 'pursuit-files' and (storage.foldername(name))[1] = auth.uid()::text`，`to authenticated` 只。
- `scripts/storage-prefix-keys.mjs`：他自己的生产库跑一次，把旧 key 搬到 `<owner>/…`（service_role move + 更新 `attachments.storage_key`、`works.box->files[].key`）。
- 本机 preamble 的 storage 桩要能跑这条迁移（`storage.foldername` 桩）。

**A5 · 0154 pulse 按人**
- 读 0115 的 `pulse_wire` / `pulse_bump_areas` 和 0138 的 `pulse_bump`；把触发器函数换成按 owner 的；`handle_new_user` 建 pulse 行；给已有用户补行。
- 测试：两个用户各改一条 works，各自 `v_pa_pulse` 只动自己的。

**A6 · 0155 找活函数**
- `pa_tasks_due_all()` definer，`security definer set search_path`，只授 service_role，返回 `(owner, task_id, …)`，谓词逐字抄 `pa_tasks_due`。`pa_briefs_due_all()` 同理，谓词抄 `sweepBriefs` 今天读的那条查询。
- 测试：authenticated 调它 → 权限错；superuser 调 → 两人的都在。

## 阶段 B · 脑子

**B1 · `brain/tenant.js`**
- `T`、`tenant()`（无 store → 静态租户）、`withTenant`、`setStaticTenant`、`envFor(settings)`、`settingsCache`。
- `tenantFromRequest(req, {url, anon})`：解析 Bearer → `createClient(url, anon, {global:{headers:{Authorization}}, auth:{persistSession:false}})` → `auth.getUser(jwt)`（按 jwt 缓存到 exp）→ 读 member_settings → 对象。
- `tenantForOwner(owner, {url, anon, service})`：admin.generateLink → verifyOtp → 客户端缓存（Map by owner，autoRefresh）。
- 测试：纯函数部分（envFor、缓存过期、Bearer 解析、无 store 回退）。

**B2 · server.js 改读上下文（机械活，分三刀）**
- 刀一：`db` → `tenant().db`（含 `mail/store.js`），`process.env.{FAIRWIND_PROVIDER,ANTHROPIC_API_KEY,CLAUDE_CODE_OAUTH_TOKEN,OPENAI_API_KEY,GEMINI_API_KEY,BRAIN_MODEL,BRAIN_MODEL_CHEAP,FAIRWIND_LANG,FAIRWIND_DATA_DIR}` → `tenant().env.X`；`think()` 给 SDK `query()` 传 `env`；`exportEnv` 在 local 下改成只更新静态租户的 env，**不再写 process.env**。
- 刀二：`MODS` → `tenant().modules`；judgments 的 `DOCS/ENABLED` → `tenant().judgments`（`judgments.js` 加 `fromRows(rows)` 返回同结构）。
- 刀三：进程级标记按 owner：`scouting/lastScout/sweeping/briefed/failed/VOICE_CACHE/IDENTIFIED/_profile/RUNS`。
- 每刀后 `npm test` 全绿 + local e2e 一遍。

**B3 · 后台循环按人**
- hosted：`scoutPass` / `sweepBriefs` 走 `pa_*_due_all` + `tenantForOwner`，并发 2；local / service 原路。
- 测试：假的 service 客户端返回两人的到点任务，断言两次 `runScoutTask` 各在正确租户下跑。

**B4 · 路由与配置**
- `dbauth.js` 加 `hosted` 模式（`FAIRWIND_MODE=hosted`：url + anon + service）；`/health` 报 mode。
- 请求入口：hosted 下除白名单外 `tenantFromRequest`，失败 401；CORS 加 authorization；监听 host 可配（hosted 默认 127.0.0.1）。
- `/me /settings /modules /judgments/* /claude/* /chatgpt/*` 搬出 `handleLocalRoute`，按模式分实现（local：settings.json；hosted：member_settings）。
- `/mcp`：hosted 认 Bearer mcp_token（service 查 member_settings）。
- 静态文件三种配置都服务。
- 测试：`routes.test.js` 风格，假请求：无 JWT 401、有 JWT 进入、`/health` 不验。

**B5 · 订阅登录按人**
- `claudeAuth.js`：HOME = `users/<owner>/claude-auth`，Linux 也跑（找 `claude` 二进制：包里的或全局的）；拿到 token 写 member_settings。Codex：CODEX_HOME 同样按人（登录流程线上不验，结构留）。

## 阶段 C · 前端

**C1** `backends.js` `brainFetch`（cloud 自动带 Authorization）；替换十处 `fetch(BRAIN…)`。
**C2** cloud 配置的「设置」：`SettingsPage` 复用，`LocalAccount` 拆成「账号块（三配置通用）」+「机器块（local 专有）」；邮件那行按 `canToggle`/模块表隐藏。
**C3** `/me` 三配置都调，语言跟着；`main.jsx` 删「云端永远 zh」。
**C4** 桶 key 前缀 owner：`deliverables.js`、`Library.jsx` 两处；本机 `brainClient` 的 storage 路径兼容前缀。
**C5** MCP 那一行命令带令牌（`ProviderPicker` / 接入按钮那块）。

## 阶段 D · 备份往返

**D1** 脑子：`GET /backup/export` → zip 流（JSON per view + files）；`POST /backup/import`（multipart）→ 确认后清我名下 + 写回。本机版同样接口（storage 是文件夹）。
**D2** 页面两颗按钮；去掉「贴路径恢复」。本机版原来的 tar.gz 备份保留为「机器备份」，页面上只露这两颗。
**D3** 验收 6：导出 → 清 → 导入 → 行数/文件一致。

## 阶段 E · 部署（等公司的 Supabase 项目 + ssh）

**E1** `packaging/hosted/`：service、Caddy 片段、deploy.sh、env.example。
**E2** 服务器：node 24、expect、claude-code、clone、build、systemd、Caddy 规则、`/var/lib/fairwind`。
**E3** Supabase：在公司项目上 `db push` 全部迁移（fresh）；关自助注册；建三个账号。
**E4** `scripts/isolation-brain.mjs` 对着真库跑；验收 7 真机走一遍（截图进 `packaging/ACCEPTANCE.md`）。
**E5** 夜间备份任务 + rclone。

## 要向公司要的（E 之前）
1. Supabase：单独一个项目；项目 URL、anon key、service_role key；他是项目 owner。
2. 机器：fairwind 用户的 ssh（公钥已给）；Caddy 里加一条子域名规则；子域名 DNS。

---

## 进度(2026-10-02 晚)

| 阶段 | 状态 | 提交 |
|---|---|---|
| A 库(0150–0157) | 做完,PGlite 上全绿;隔离测试加了目录检查 | 67a21a8、2dbe283 |
| B 脑子 | 做完;本机配置 / 托管配置各冒烟一遍 | a9412e3 |
| C 前端 | 做完;两种构建过;本机设置页截图看过,托管设置页没真渲染过(没会话) | 82d02bf |
| D 备份往返 | 做完;导入时附件 key 换主人(本机包 → 线上加前缀) | 2dbe283 |
| E 部署 | 文件写好(`packaging/hosted/`),**没上机器**;`scripts/isolation-brain.mjs` 没跑过 | e633adc |

**还差的、要东西的:**
1. 公司的 Supabase 项目(URL + anon + service_role,他做 owner)→ `supabase db push` → 关自助注册 → 建三个账号 → 跑 `isolation-test.mjs`(DEV_DATABASE_URL)和 `isolation-brain.mjs`。
2. 机器上的 fairwind 用户(他在 DO 网页 Console 贴那段命令)→ 按 `packaging/hosted/README.md` 装 → Caddy 加一条 → 子域名。
3. 真机验收(设计稿十三节第 7 条)。
4. **他自己的生产库**要推这批迁移时:0153 之后旧附件 key 读不到,先 `node scripts/storage-prefix-keys.mjs`(预演)再 `--yes`;0152 把五个函数改回 invoker、0154 换了 pulse 触发器——都该在他自己的云端版上先验一遍。
5. 下一期:邮件模块线上(Gmail 令牌按人、回调走公网)、ChatGPT 订阅(Codex)Linux 登录、MCP 判据工具在托管下读库(现在判据工具跟邮件模块一起藏着,没露出)。
