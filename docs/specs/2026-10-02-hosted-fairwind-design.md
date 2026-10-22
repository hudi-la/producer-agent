# 托管的 Fairwind —— 一台服务器、一个脑子、一个库，每人一个账号

2026-10-02 · 分支 `workshop-edition`

这是 workshop 版**第三次**定形状。9/16 设计稿第十三节画的「第三步：瘦客户端 → 云上 brain → 云上 Postgres」，
这次就做它。前两步的东西不扔：本机版照常发，他自己的云端个人版照常跑；**同一套代码，三种配置**。

正文只写决定和形状。为什么这么定，放末尾「2026-10-02 当时怎么想的」。

---

## 一、要求（他的原话，精炼）

| # | 要求 | 落在哪一节 |
|---|---|---|
| R1 | 线上肯定是多租户：一台服务器，大家都用它；东西放数据库里，每人一个账号，自己的东西在自己账号里 | 二、三、五 |
| R2 | 一家公司借出它的 DigitalOcean 机器和 Supabase；他们不多花钱 | 三、十 |
| R3 | token 费用学员自理（key 是学员自己的） | 六 |
| R4 | 人少，信息放在别人机器上大家不当回事（这条把 9/16 的 R4 从天平上拿掉） | 六、十九 |
| R5 | 已经跟学员讲过：不保证长期 → 必须回得来 | 十一 |
| R6 | 学员图片多（几百张） | 七 |
| R7 | 页面上能自己下载、上传备份 | 十一 |
| R8 | 机会池不共享（8/24 R5 不变） | 五 |
| R9 | 教学要给 agent 开门：MCP 那三颗接入按钮线上也要能用 | 九 |

前面已定、这次不动的：外发只认他自己的手；转移表结构和工具白名单不许改；Gmail 只存草稿。

## 二、一句话

**公司那台机器上跑一个脑子进程，所有学员共用；数据全在一个 Supabase 项目里，每行盖着 owner，
行级权限守门。学员开浏览器登录就用，电脑上什么都不装。脑子替每个人到点找机会，烧各人自己的 key。**

## 三、形状

```
学员浏览器 ──HTTPS──▶ Caddy（公司机器上已有）──▶ 127.0.0.1:8788 脑子（一个进程，systemd）
   │                                                  │
   │  登录：Supabase Auth（邮箱 + 密码）                 │  每个请求：带着浏览器的 JWT 连库（RLS 生效）
   │  读写档案/机会：直连 Supabase（跟 8/24 一样）        │  后台：service_role 只用来**找活**，干活一律换成那个人的身份
   ▼                                                  ▼
Supabase 项目（公司的，单独一个）
   ├─ Postgres：producer.*（0137 那套 owner + RLS + invoker）+ 本次新表 member_settings / judgment_docs
   ├─ Auth：学员账号
   └─ Storage：pursuit-files 桶，路径以 owner 开头，策略只认自己那一段

公司机器上脑子自己的目录：/var/lib/fairwind/users/<owner>/   ← 只放订阅登录的缓存（claude-auth、chatgpt），没有业务数据
```

三种配置，一套代码：

| 配置 | 谁用 | 库 | 身份 |
|---|---|---|---|
| `local` | 学员本机版（9/16） | PGlite | settings.json 里的 uid |
| `service` | 他自己的云端个人版 | 他的生产库 | service_role，一个人 |
| **`hosted`（本次）** | 学员线上版 | 公司的 Supabase | **每请求 / 每任务一个身份** |

## 四、决定清单

- **D1 一个脑子伺候所有人。** 不做「一人一个进程」。
- **D2 「我是谁」从进程里拿出来，放进一个随请求/随任务走的「租户上下文」。** 脑子里所有 `db`、key、语言、模块开关、判据的读取都改成从上下文取；`local` 和 `service` 两种配置下这个上下文在启动时建一次、一辈子不变，行为逐字等于今天。
- **D3 HTTP 请求的身份 = 浏览器的 JWT。** 前端每次调脑子都带 `Authorization: Bearer <access_token>`；脑子用这个 JWT 建一个 Supabase 客户端去读写，RLS 自然生效，owner 自然是 `auth.uid()`。没带、过期 → 401。`/health` 和静态文件除外。
- **D4 后台活儿：service_role 找活，换身份干活。** 到点的任务、要读的新机会，用 service_role 跨所有人查出 `(owner, 任务)`；每一件都在**那个 owner 的身份**下执行（见 D5）。脑子代码里永远不出现「以 service_role 写业务表」。
- **D5 替一个人干活的身份，靠 Supabase Auth 的管理接口造一个会话**：`auth.admin.generateLink({type:'magiclink'})` 拿到 `hashed_token`，再 `verifyOtp` 换成那个人的 session（不发邮件）。每个 owner 缓存一个自动续期的客户端，进程重启重造。换方案只改一个函数 `clientForOwner(owner)`。
- **D6 每人的设置进库：** 新表 `producer.member_settings`（provider、几把 key、两档模型、语言、判据开关、模块开关、MCP 令牌）。key 明文存（R4，见十九）。读写走 `pa_member_settings` / `pa_set_member_settings`，key 不回显。
- **D7 判据文档进库：** 新表 `producer.judgment_docs`（owner、name、body）。`judgments.js` 加一个「从行加载」的入口，lint / 拼接 / 回退逻辑不动；设置页里编辑的还是同一份界面。
- **D8 模型 key 不进 process.env。** `envFor(settings)` 造一个 env 对象，随上下文走；SDK 的 `query()` 用它的 `env` 选项，GPT / Gemini 引擎本来就吃传入的 env。订阅登录（`claude setup-token`、Codex）各人一个 HOME，在 `/var/lib/fairwind/users/<owner>/`。
- **D9 模块：线上第一期只开档案 + 机会线。** 邮件模块在 hosted 配置下不出现（Gmail 令牌按人存、回调走公网，是下一期）。每人的开关存在 member_settings.modules。
- **D10 附件桶的路径以 owner 开头，策略只认自己那一段，anon 一律收回。** 前端和脑子拼 key 的两处都加前缀。
- **D11 9/16 之后写回 security definer 的五个函数改回 invoker，anon 的授权收回。** 加一条机器判：以后任何 `pa_*` 是 definer 或授给 anon，隔离测试当场红。
- **D12 pulse 按人。** 把 0138 写好的 `pulse_bump` 真正接到触发器上，每人一行。
- **D13 MCP 线上走令牌。** `/mcp` 不再只认本机回环，改认 `Authorization: Bearer <mcp_token>`（每人一串，设置页里看、能换）。桥的那一行命令带上令牌。
- **D14 脑子直接服务前端产物**，三种配置一样。Caddy 只做一条 `reverse_proxy`。
- **D15 账号由作者建。** Supabase 后台关掉自助注册；他在 Auth 页面给三个学员建账号发密码。登录页不动。
- **D16 回得来：** 页面上「下载我的备份」= 我名下所有行 + 附件打成一个 zip；「用备份恢复」= 上传同样的 zip 导进本机版或线上版。格式跟本机版的 tar.gz 不同（那个是整库 dump），本机版也换成这个格式，**一种备份两边通**。
- **D17 隔离测试扩到脑子的接口**：两个用户各一套数据，以 A 的 JWT 调脑子每一个端点，B 的标记串不许出现；再查目录里没有 definer、没有 anon 授权、桶策略带 owner。
- **D18 作者看不见内容。** 脑子日志不打业务数据；service_role 只在服务器的 env 文件里，不进代码库。

## 五、数据层

### 5.1 现成的

0137 那套：每张 `producer.*` 表（除 `pulse_areas`）`owner uuid default auth.uid()`、RLS `owner = auth.uid()`；
全部 `pa_*` 是 invoker，授给 authenticated + service_role；全部 `v_pa_*` `security_invoker`。
`handle_new_user` 注册触发器给新账号建 profile / voice / 出厂 scout 任务。

### 5.2 要修的（本次迁移，编号 0150 起）

| 号 | 做什么 |
|---|---|
| 0150 | `member_settings` 表 + `pa_member_settings`（key 只回显末几位）+ `pa_set_member_settings` + `pa_rotate_mcp_token`；`handle_new_user` 顺手建一行默认设置 |
| 0151 | `judgment_docs` 表 + `pa_judgment_docs` / `pa_set_judgment_doc` / `pa_drop_judgment_doc` |
| 0152 | 五个 definer 函数改回 invoker（`pa_set_entry_box`、`pa_set_entry_box_json`、`pa_restart_studio`、`pa_rewind_studio`、`pa_link_thread`），全部 `pa_*` 收回 anon |
| 0153 | 桶策略：`(storage.foldername(name))[1] = auth.uid()::text`，只授 authenticated；旧 key 的搬家由脚本做（他自己的生产库跑一次，学员库从零没有旧 key） |
| 0154 | pulse 按人：触发器换成 0138 的 `pulse_bump`；`handle_new_user` 给新账号建 pulse 行 |
| 0155 | `pa_tasks_due_all`：**service_role 专用**、definer，返回所有人到点的 `(owner, task)`——这是脑子「找活」的唯一越权入口；同类的 `pa_briefs_due_all`。两者只授 service_role |

### 5.3 不动的

转移表、工具白名单、`pa_*` 的签名、前端直连库的那些调用（它们本来就带着浏览器的 JWT）。

## 六、脑子：租户上下文

```
brain/tenant.js
  T = new AsyncLocalStorage()
  tenant()            → 当前上下文；没有就返回启动时那个静态的（local / service 配置）
  withTenant(t, fn)   → T.run(t, fn)
  tenantFromRequest(req)   hosted：验 JWT → {owner, email, db(JWT 客户端), settings, env, modules, judgments}
  tenantForOwner(owner)    hosted 后台：D5 的会话 → 同样一个对象
  envFor(settings)         → { FAIRWIND_PROVIDER, ANTHROPIC_API_KEY | CLAUDE_CODE_OAUTH_TOKEN, OPENAI_API_KEY, GEMINI_API_KEY,
                               BRAIN_MODEL, BRAIN_MODEL_CHEAP, FAIRWIND_LANG, FAIRWIND_DATA_DIR(= users/<owner>) }
```

server.js 里所有 `db.` → `tenant().db.`；`process.env.X`（key / 模型 / 语言 / 数据目录）→ `tenant().env.X`；
`MODS` → `tenant().modules`；judgments 的 `DOCS` → `tenant().judgments`。`mail/store.js` 的 `db()` 同样改从上下文取。

进程级的忙碌标记（`scouting`、`sweeping`、`lastScout`、`VOICE_CACHE`、`IDENTIFIED`、`ask.js` 的 `_profile`）
全部改成按 owner 的 Map，或者挂在上下文对象上。`RUNS`（聊天中止句柄）的 key 加上 owner。

设置缓存：每 owner 一份，60 秒过期；`/settings` 写入后当场失效。

### 6.1 后台循环

```
scoutPass():  due = service.rpc('pa_tasks_due_all')           ← 跨人找活
              for (owner, task) of due, 最多 2 个并发:
                withTenant(await tenantForOwner(owner), () => runScoutTask(task))
sweepBriefs(): 同样的形状，pa_briefs_due_all
mailLoop():   hosted 下不起（D9）
```

`local` / `service` 配置下这两个函数走原来的 `pa_tasks_due`（那时上下文就一个人），行为不变。

### 6.2 路由

```
hosted:  /health、静态文件、/mcp(令牌) 不验 JWT；其余一律 tenantFromRequest，401 就是 401
         CORS：allow-origin = BRAIN_ORIGIN（= 自己的域名），allow-headers 加 authorization
         监听 127.0.0.1
/me /settings /modules /judgments/* /claude/* /chatgpt/*  三种配置都在（原来只在 local），实现按配置分：
         local → settings.json；hosted → member_settings
/backup/* /update/* /quit /mcp/targets                       只在 local
```

## 七、附件

key 规则改成 `<owner>/box/<entry>/<ts>-<name>`、`<owner>/<pursuit>/<uuid>-<name>`。本机模式的 `makeStorage` 不在乎前缀，照旧。
几百张图：本体在 Storage 桶里（Supabase 免费档 1GB、付费档 100GB 起），库里只有 key；模型只在开图时读，一条对话最多 3 张，不变。

## 八、前端

- `backends.js` 加 `brainFetch(path, init)`：cloud 配置自动带 `Authorization`；十处直接 `fetch(BRAIN…)` 全换。
- 右上角「设置」在 cloud 配置也出现：`ModulesPanel`（邮件那行不出现）+ 账号块（语言、模型来源、key、两档模型、判据开关、MCP 那一行命令）。备份两颗按钮（D16）。机器级的（更新、退出、备份目录）只在 local。
- `/me` 三种配置都有，语言从 member_settings 来；`main.jsx` 那句「云端永远中文」删掉。
- 登录页不动（邮箱 + 密码）。

## 九、MCP

`/mcp`：hosted 下认 `Authorization: Bearer <mcp_token>`，查 member_settings 找到 owner，建上下文，其余逐字今天。
桥 `mcp-bridge.cjs` 的 URL 参数支持 `https://user:TOKEN@host/mcp` 写法（node 的 http 会自动变成 Authorization 头），三颗接入按钮生成的命令带上它。

## 十、部署

```
packaging/hosted/
  fairwind.service      systemd：User=fairwind，EnvironmentFile=/etc/fairwind/env，Restart=always，MemoryMax=2G
  Caddyfile.snippet     fairwind.<域名> { reverse_proxy 127.0.0.1:8788 }
  deploy.sh             在服务器上：git pull → npm ci → vite build:hosted → systemctl restart
  env.example           SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / FAIRWIND_MODE=hosted /
                        FAIRWIND_DATA_DIR=/var/lib/fairwind / BRAIN_ORIGIN=https://fairwind.<域名> / BRAIN_PORT=8788
```

服务器上要装：node 24（官方 tarball）、`expect`（setup-token 用）、全局 `@anthropic-ai/claude-code`（setup-token 用）。
源码在公司机器上：他接受（R4）；真在乎时在服务器上做字节码构建，流程现成。

## 十一、备份与回得来

- **页面**：「下载我的备份」→ 脑子以我的身份把所有 `v_pa_*` 读成 JSON + 桶里我的文件 → zip 流给浏览器。「用备份恢复」→ 上传 zip → 脑子以我的身份 `pa_*` 写回（先清我名下的行，有确认）。本机版用同一对接口（本机 storage 是文件夹，一样走）。
- **作者**：服务器上每晚一个任务，service_role 跑同一份导出，每人一个 zip，推到 Google Drive（rclone）。Supabase 自己的快照是否有看公司的档位。
- **公司撤了**：学员拿着 zip 装本机版点「恢复」。

## 十二、明确不做

- 邮件模块上线（下一期）
- 自助注册、找回密码（三个人，作者手建）
- key 加密存储（R4；以后人多了再说，字段不用改）
- ChatGPT 订阅（Codex）线上：结构留着（各人 CODEX_HOME），Linux 上的二进制和登录流程下一期验
- 共享机会池（R8）

## 十三、验收（全部机器判）

| # | 事 | 判据 |
|---|---|---|
| 1 | 单人配置零回归 | `npm test` 全绿；`local` 配置本机 e2e（scratchpad/e2e-device.mjs）照旧全绿 |
| 2 | 库隔离 | `scripts/isolation-test.mjs`：原有断言 + 「没有 definer 的 `pa_*`」+「没有 anon 授权」+ 桶策略含 owner |
| 3 | 脑子隔离 | 新 `scripts/isolation-brain.mjs`：A、B 两账号，A 的 JWT 调每个端点，响应里无 B 的标记；无 JWT → 401；B 的 mcp_token 调 `/mcp` 只见 B |
| 4 | 找机会按人 | 两账号各一条到点任务；一轮 `scoutPass` 后各自的机会池只有自己的卡，owner 正确 |
| 5 | key 不漏 | 跑一轮后 `process.env` 里没有任何 `*_KEY` / `*_TOKEN`；`/settings` 回显只有末几位 |
| 6 | 备份往返 | 导出 A → 清空 A → 导入 → 每张表行数、每个文件相同 |
| 7 | 真机 | 公司机器：三个账号登录、建档案、上传图、「现在跑一次」出卡、桥接 Claude 桌面版读到自己的档案 |

## 十四、施工顺序

```
A 库：0150–0155 + 隔离测试加判据          ← 不等公司的 Supabase，PGlite + 本地 Postgres 就能验
B 脑子：tenant.js、server.js 改读上下文、后台循环按人、路由验 JWT、/mcp 令牌   ← 单人配置零回归是闸
C 前端：brainFetch、cloud 设置页、/me、桶 key 前缀
D 备份：导出/导入接口 + 两颗按钮（本机版同步换格式）
E 部署：packaging/hosted + 服务器装机 + 真机验收            ← 等公司的 Supabase 项目 + ssh
```

## 十九、2026-10-02 当时怎么想的

- 9/16 把脑子钉在本机是因为四条：不想为托管花钱、用户量不确定、要能推更新、邮件不经他手。今天前三条被公司借机器解决，第四条他自己拿掉了（人少，大家不当回事）。四条都没了，形状自然回到 8/24 画的「一个库多租户」，再往前一步把脑子也托管。
- 「一人一个进程」被他否了：那是把本机版照抄到服务器上，省了改脑子的功夫，但不是线上服务该有的形状，几百人时就得重做。
- 替人干活的身份用 Auth 管理接口造会话，而不是拿 JWT secret 自己签，是因为新 Supabase 项目默认用非对称签名，legacy secret 不一定在；管理接口哪个项目都有。
- key 明文存库是 R4 的直接后果，字段设计不排除以后加密。
- 邮件不上线：Gmail 令牌按人、回调走公网、收信循环按人，三件事加起来是另一期的量，而三个学员现在用的是档案和机会线。

## 名词表

| 名字 | 意思 |
|---|---|
| 租户 / owner | 一个学员账号；库里每行盖着的那个 uuid |
| 租户上下文 | 脑子处理一件事时「我现在替谁干活」的那包东西：库连接、key、语言、模块、判据 |
| JWT | 浏览器登录后拿到的通行证，带着它连库，库就知道你是谁 |
| service_role | 越过所有权限的总钥匙，只在服务器的 env 文件里，只用来找活 |
| RLS | 行级权限：每行有主人，别人的账号查不到 |
| invoker / definer | 函数按「调用的人」还是「写函数的人」的权限跑；多租户必须是前者 |
| AsyncLocalStorage | node 里让「这一次请求的上下文」自动跟着所有后续调用走的机制 |
| magiclink + verifyOtp | 不发邮件、在服务器端替某个账号造一个登录会话的办法 |
