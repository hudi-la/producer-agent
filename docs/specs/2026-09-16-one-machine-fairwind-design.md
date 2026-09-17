# 一台机器上的 Fairwind —— 本地库、模块化安装、能往云上走的路

2026-09-16 · 分支 `workshop-edition`

这是 workshop 版**第二次**定形状。第一次（8/24，[路线总纲](2026-08-24-workshop-edition-roadmap.md)）是
「一个库、很多艺术家、作者托管」。这一次改成「数据零托管，作者只发版本」。
8/24 做完的多租户（0118 那套 owner + RLS + invoker）**不扔**——它是这条路的第二步。

正文只写**决定和形状**。为什么这么定，放在末尾「2026-09-16 当时怎么想的」那一节，
带日期，以后想法变了在那节下面续，不回来改正文。

---

## 一、要求（他的原话，精炼）

| # | 要求 | 落在哪一节 |
|---|---|---|
| R1 | 给别人用；我 host 他们不想花钱——用户量少、以后不确定 | 三、九、十 |
| R2 | 以后我能发布新东西，他们能收到更新 | 十 |
| R3 | 模块化：不只是数据库的，是**安装的**模块化（档案 / 加卡片 / 邮件状态机能分开装） | 七 |
| R4 | 数据库可以在学员本地（不泄露邮件） | 五 |
| R5 | 机会池**不共享**——每人建自己的（艺术类每批中选个位数，共享池互相踩） | 七 |
| R6 | 以后用户多了、或决定做成 app，能逐渐把库搬到云上，本地整装变成瘦客户端 | 十三 |
| R7 | 更新手动或自动都行，个位数用户；以后要能变成正常发布 | 十 |
| R8 | 别被拿去做成别的产品；我的内容不跟着走；别让他们改坏；环境别要他们自己配 | 九、十四 |
| R9 | 做技术隔离，让他们碰不到源码；不喜欢 GitHub 私有仓库那条路 | 九、十四 |
| R10 | 判据让他们自己改——给一个本地判据文档接口 | 八 |
| R11 | 理由别在设计稿上写死 | 本文结构 |
| R12 | 线上线下都储存？——他自己云端、学员本地；学员要备份 | 十一、十二 |

前面已定、这次不动的：外发只认他自己的手（agent 按不了发送键）；转移表结构和工具白名单不许改；
Gmail 只存草稿、不发信；①b（agent 退出邮箱）仍暂缓。

## 二、一句话

**学员的机器上装一整套（前端 + brain + 本地库），数据全在本机；作者不托管任何数据，
只发版本。同一套代码、同一批迁移，作者自己继续用云端那份。**

## 三、形状

```
作者                          学员机器
──────────────────            ─────────────────────────────────────────────
发布仓库（公开、只放发布物）    Fairwind/                    ← 应用目录，更新整个换
  ├─ Fairwind-mac-arm64.zip     ├─ node（自带的运行时）
  ├─ Fairwind-mac-x64.zip       ├─ brain.jsc（字节码，不是源码）
  ├─ Fairwind-win-x64.zip       ├─ dist/（前端构建产物，由 brain 直接服务）
  └─ latest.json                ├─ node_modules/（含 SDK 的平台二进制、PGlite wasm）
                                └─ 启动器
代码仓库（私有，学员没有）
                              ~/Library/Application Support/Fairwind/   ← 数据目录，更新永远不碰
                                ├─ db/            PGlite 数据
                                ├─ files/         附件
                                ├─ judgments/     学员自己的判据文档
                                ├─ modules.json   哪些模块开着
                                ├─ settings.json  key、模型档位、备份目录
                                └─ gmail/         OAuth token
```

作者自己：同一个仓库、同一个前端和 brain，配置里连的是云上的库（`dbauth` 的 service 或 user 模式）。

## 四、决定清单

编号是给以后引用用的。理由见十九节。

- **D1** 数据零托管。作者唯一 host 的东西是发布位（免费）。
- **D2** 一套迁移文件，三种执行者：云端 service（作者个人版）、云端 user（8/24 的多租户版）、本地 PGlite（学员）。不为本地单开一套 schema。
- **D3** 数据访问只走 `pa_*` 函数和 `v_pa_*` 视图。今天 91 处调用 0 处裸表，以后也必须是 0。
- **D4** 本地模式下前端不直连库，一律经 brain；brain 直接服务前端构建产物。作者自己的云端模式照旧直连。
- **D5** 模块 = 能力开关，不是 schema 分区：**表全建，能力分装**。三个模块按 A←B←C 单向依赖。
- **D6** scout 和机会池随机会线模块在本机跑，各找各的，烧各自的 key。
- **D7** 判据分两层：骨架（转移表结构、字段、走向）在代码里、不许改；口味由学员在 `judgments/` 目录里用文档写，拼进提示词。
- **D8** 判据热更新第一版不做；判据随版本更新。
- **D9** 打包成**文件夹应用**：自带 node 运行时 + 字节码编译的 brain + 前端产物 + 依赖。不是单文件 SEA。
- **D10** 装机一行命令；启动器由脚本在本机创建。更新由应用自己完成，不再经浏览器下载。
- **D11** 更新第一版手动（页面上一颗按钮），机制分「检查」「执行」两段，以后把检查改成自动。
- **D12** 备份 = 定时把整个库导出到学员自己选的文件夹（iCloud Drive / Google Drive）。
- **D13** 隔离做到字节码为止；再往上靠许可证。不再为藏代码追加投入。
- **D14** 安装包不带作者的内容（`demo/` `src/demo/` `supabase/demo/`）、不带作者的 `.env`、不带作者的 `judgments/`。
- **D15** 施工第一步是把主线合进本分支并给迁移重号——不合并，学员拿到的档案层没有书桌。

## 五、数据层

### 5.1 一批迁移，三个执行者

| 执行者 | 谁在用 | RLS | `auth.uid()` | 连的是 |
|---|---|---|---|---|
| 云端 service | 作者个人版（今天） | 绕过 | null（无主行） | `jjgvvtrs…` 生产库 |
| 云端 user | 8/24 多租户版；将来第二步 | 生效 | Supabase Auth 的 uuid | 作者托管的库 |
| **本地 PGlite** | **学员（这次）** | 超级用户，不生效 | 本机固定的一个 uuid | `<数据目录>/db/` |

三者跑的是**同一批** `supabase/migrations/*.sql`，顺序由 `scripts/migration-order.mjs` 定（不是文件名字典序），
全新库跳过一次性数据修复（那个脚本里的 `数据修复` 集合）。这三条已在 8/24 做好，本次不动。

### 5.2 本地前言（preamble）

PGlite 是裸 Postgres，没有 Supabase 那几样东西。本地建库前先跑一段前言，只在本地跑，
不进 `supabase/migrations/`：

```sql
create role anon; create role authenticated; create role service_role;   -- 迁移里 grant 要用
create schema auth;
create table auth.users (id uuid primary key, email text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable
  as $$ select current_setting('fairwind.uid', true)::uuid $$;
```

`fairwind.uid` 由 brain 在每个连接上 `set`，值是 `settings.json` 里生成一次的 uuid。

### 5.3 本地「注册」

装机时往 `auth.users` 插一行（本机 uuid + 学员填的邮箱）。0118 的 `handle_new_user` 触发器
照常跑，造出这个人的 `profile` 和 `voice` 行。**注册流程零改动**，云端和本地走的是同一个触发器。

### 5.4 RLS 在本地

PGlite 的连接是超级用户，policy 不生效——本地只有一个人，不需要门。但 `owner default auth.uid()`
照样把每一行盖上本机 uuid。将来搬云（十三节）时，把这个 uuid 映射成 Supabase Auth 的 uuid 即可，
不用回头补 owner。

### 5.5 迁移记账

本地库里一张表 `producer_meta.applied(filename text primary key, applied_at timestamptz)`。
启动时对照 `migration-order.mjs` 给的顺序，没记过的按序跑，每支一个事务。
这也是「更新自动跑没跑过的迁移」的机制——同一个函数，装机和更新都调它。

### 5.6 附件

今天附件在 Supabase Storage 的 `pursuit-files` 桶，`attachments.storage_key` 是键。
本地：字节落在 `<数据目录>/files/<storage_key>`；`createSignedUrl` 变成 `http://localhost:8788/files/<key>`。
brain 里读附件那处（`db.storage.from('pursuit-files').download`）和前端 `deliverables.js` 四处，
都过适配层（六节），代码不动。

## 六、窄口与适配层

### 6.1 今天的窄口（2026-09-16 实测）

| | `.rpc('pa_*')` | `.from('v_pa_*')` | 裸表 |
|---|---|---|---|
| brain（排除测试） | 37 | 9 | 0 |
| 前端（排除测试） | 28 | 17 | 0 |

`.from()` 链上用到的方法只有：`select` `eq` `in` `order` `limit` `maybeSingle`。
`select` 里没有嵌套资源（没有 `works(*)` 这种）。`.rpc()` 后面没有链式调用。
另外用到的：`.auth.getUser/getSession/onAuthStateChange/signInWithPassword/signUp/signOut`（4 个前端文件 + dbauth）、
`.storage.from().upload/download/remove/createSignedUrl`（1 个前端文件 + server.js 一处）。

**适配层要仿的就是这么大一个表面。** 不做通用 PostgREST。

### 6.2 brain 侧：`makeDb()` 第三模

```
dbauth.js
  service  → supabase-js（service_role）          今天就有
  user     → supabase-js（anon + 会话文件）        今天就有
  local    → PGlite 适配对象                       新加
```

选模的规则：`.env` 里有 `SUPABASE_SERVICE_ROLE_KEY` → service；有 `SUPABASE_ANON_KEY` → user；
都没有、有 `FAIRWIND_DATA_DIR` → local。学员的包只会有最后一种。

适配对象（`brain/localdb.js`）：

- `.rpc(name, args)`：启动时从 `pg_catalog.pg_proc` 读一次每个 `pa_*` 的参数名、参数类型、返回类型、是否 setof；
  调用拼成 `select * from public.<name>(p_x => $1::type, …)`；按 PostgREST 的规矩整形返回值
  （setof/table → 数组；json/jsonb → 解析后的值；标量 → 标量；void → null）。
  参数带显式类型转换，是为了同名函数有多个版本时不歧义。
- `.from(view).select(cols).eq().in().order().limit().maybeSingle()`：一个小 builder，拼成一条 `select`。
  列名白名单检查（只许字母数字下划线逗号空格），防注入。
- `.storage.from(bucket)`：读写 `<数据目录>/files/`。
- `.auth.getUser()`：返回本机那个人。
- 返回形状与 supabase-js 一致：`{ data, error }`，绝不抛。

每个连接先 `set fairwind.uid = '<uuid>'`（5.2）。

### 6.3 前端侧：`backends.js` 按构建模式换客户端

```
VITE_DB_MODE=local   → supa = brainClient(BRAIN)   同一个表面，打到 brain 的 /db/*
（未设）             → supa = createClient(url, anon)   今天的样子，作者自己用
```

`brainClient` 把 `.from().select()…` 链序列化成一个 JSON 发到 `POST /db/from`，
`.rpc` 发到 `POST /db/rpc/<name>`，`.storage` 发到 `/files/*`，`.auth.getSession()` 返回本机那个人的假会话
（`AuthGate` 于是直接放行，`Login.jsx` 在本地模式下永远不出现）。21 个 import `supa` 的文件**一个不改**。

brain 新增的四条路由：`POST /db/rpc/:name`、`POST /db/from`、`GET|POST|DELETE /files/:key`、`GET /me`。
只接受来自 localhost 的请求（今天 `BRAIN_ORIGIN` 那道 CORS 照旧）。

### 6.4 三条不许破的规矩

1. **只走 `pa_*` 和 `v_pa_*`。** 本地库让写 SQL 变得很方便——这是最容易破的一条。隔离测试按目录扫 `brain/` 和 `src/`，
   出现 `db.query(` / `sql\`` 之类直连即红。
2. **迁移文件是 schema 的唯一真相，本地云端共用同一批。** 本地前言（5.2）是唯一的例外，且不碰 `producer` schema。
3. **本地模式下前端不直连库。** `backends.js` 是唯一建客户端的地方；`VITE_DB_MODE=local` 时不允许 import `@supabase/supabase-js`
   之外的东西碰网络。

## 七、模块

### 7.1 三层与归属

| 模块 | 表 | 学员看见的 |
|---|---|---|
| **A 档案** | `profile` `voice` `works` `studio_messages`（主线 0127 书桌） | 我的档案、作品与履历、盒子、语气五栏、书桌 |
| **B 机会线** | `pursuits` `pursuit_parties` `pursuit_seen` `pursuit_messages` `tasks` `deliverables` `pulse` `pulse_areas` `cue_marks` `cue_judged` `contacts` `contact_orgs` `contact_seen` `opportunities`（主线 0120 机会池） | 看板、机会卡、人、机构、时间线、通知、手记、状态机、写信稿/填表、scout 找机会 |
| **C 邮件** | `mail_accounts` `mail_headers` `mail_label_audit` `pursuit_threads` `message_tags` `attachments` `letter_verdicts` `address_verdicts` `contact_emails` `org_mailboxes` `thread_marks`（主线） | 连 Gmail、信自动归线归人、分诊、陌生人、草稿进信箱 |

依赖只往一个方向：C 要 B，B 要 A。`stage_backup_0015` 是作者个人史，新库里为空，不归任何模块。

### 7.2 表全建，能力分装

**所有模块的表在装机时全部建出来**（空表零成本），模块开关控制的是**能力**：

| 层 | 门控点 | 关了之后 |
|---|---|---|
| brain 路由 | `server.js` 那张 `if (req.url === …)` 分发表，每条标模块 | 不属于开着的模块的路由返回 404 `{ module: 'mail', enabled: false }` |
| brain 后台循环 | `sweepBriefs`（B）、`mailLoop`（C）、scout 定时（B）、`timerPass`/`judgePass`（B） | 不起定时器 |
| brain 工具白名单 | `GMAIL_TOOLS`（C）、`FILE_TOOL`/`WORK_IMG_TOOL`（B） | 不进 `allowedTools` |
| 前端主区 | `App.jsx` 的 `AREAS`：`profile`（A）、`desk` `pursue` `people` `ledger`（B） | 主区按钮不渲染；URL 带了也回落到开着的第一个区 |
| 前端面板 | `Mail.jsx` `Strangers.jsx` `Recipients.jsx`、卡里的「连 Gmail」「放进草稿箱」（C） | 不渲染 |

前端从 `GET /modules` 拿到 `{ profile: true, pursuits: false, mail: false }`，放进一个 context；门控就是读它。

### 7.3 开关与依赖

`<数据目录>/modules.json`。装机默认只开 A。页面上「设置 → 模块」三行开关；开 C 时若 B 没开，先自动开 B；
关 B 时若 C 开着，一起关。改开关 = 写文件 + brain 热重载门控（不用重启）。

### 7.4 代码结构（本次做到哪）

本次只做门控，不搬文件。`server.js` 里每条路由、每个定时器、每组工具**标上模块名**并过一个 `enabled(module)` 检查。
物理拆成 `brain/modules/<name>/` 是以后的一刀，门控做好之后拆起来是搬家，不是重写。

## 八、判据：骨架与判据文档

### 8.1 两层

| 层 | 是什么 | 谁能动 | 在哪 |
|---|---|---|---|
| **骨架** | `judge.js` 的 `TRANSITIONS`：每格问什么、返回哪几个字段（`gist` `needs_reply` `awaiting` `wait_days` `meet_at` `resolves`）、从哪格走到哪格 | 作者，随版本发 | 字节码里 |
| **判据文档** | 学员对某一类事的判断口味：催的节奏、拿不准偏哪边、见面和等待撞上听谁的 | 学员 | `<数据目录>/judgments/*.md` |

`voice.judge_rule`（判断时的小人格）继续存库、页面上改，不动。

### 8.2 文件布局

```
judgments/
  README.md        怎么写；哪些写了不生效（由安装包放进来，更新时覆盖）
  全部.md          每一格都带上
  对方来信.md      THEIR_LETTER
  我发出的信.md    MY_LETTER
  手记.md          NOTE
  见面之后.md      YOUR_ANSWER（DEBRIEF 那格）
```

文件名到事件名的映射在 `judge.js` 里一张小表。没有的文件 = 空。

### 8.3 拼装位置

`收尾()` 输出的那段（「最后一行单独输出 `[[TAG]] {…}`」）是硬边界，必须在提示词**最后**。
判据文档拼在它**前面**：

```
<开头>
<这一格的问题（骨架）>
<judgments/全部.md>
<judgments/<这一格对应的>.md>
<收尾：字段规格>
```

实现：`收尾()` 在开头放一个占位符 `JUDGMENTS_SLOT`；`cellFor(state, ev)` 返回的 `ask` 包一层，
把占位符换成当时读到的文档内容（没有则空串）。`server.js` / `replay.js` 里调 `cell.ask()` 的四处**不改**。
文档内容启动时读一次，文件改了热重载（`fs.watch`）。

### 8.4 硬边界与提醒

字段由骨架定。判据文档里出现「增加/加一个/去掉/删掉/改成 + 字段名」这样的句子，启动时和热重载时**明说一句**
「`对方来信.md` 第 7 行：字段由系统定，这句不生效」，文件照用，那句照拼（模型会忽略或不忽略都无所谓——
解析器只认骨架定的字段，多余的字段丢掉）。

### 8.5 三个安全阀

1. **总开关**：`settings.json` 里 `judgments.enabled`，页面上一个开关「用我的判据 / 用出厂判据」。关了 = 占位符换成空串。
2. **回放看差别**：`POST /judgments/preview` —— 取这个人最近 N 条已判过的事实（`pa_facts_to_judge` 的历史），
   用**现在的**判据文档重判一遍（只判不写标签，跟 `replay.js` 同一条规矩），把「原来的结论 / 现在的结论」并排返回。
   页面上一颗「看看会怎么变」。第一版 N=20，用便宜档。
3. **判不出来就回退**：模型没按格式回话（`parseTag` 失败）时，同一格**用出厂判据再判一次**；仍失败按今天的规矩留着下一轮。
   日志明说是哪个文档惹的。

### 8.6 热更新：第一版不做

`TRANSITIONS` 是带模板函数的 JS，不是纯数据；要热更新得先把它变成数据格式，那是另一刀。第一版判据随版本发。

## 九、打包与安装

### 9.1 为什么是文件夹不是单文件（决定 D9 的事实依据）

- Agent SDK 靠起一个**子进程**跑（`@anthropic-ai/claude-agent-sdk-<平台>` 可选依赖带一个约 256MB 的 `claude` 二进制）。
  单文件 SEA 只能跑它自己嵌的脚本，起不了这个子进程。
- PGlite 是 wasm + 数据文件，从 `import.meta.url` 相对路径加载。
- 字节码（bytenode）要求跑它的 node 版本跟编译时一致——**所以要自带 node**。

### 9.2 包里有什么

```
Fairwind/
  node                       固定版本的 node 可执行文件
  brain.jsc                  esbuild 把 brain/ 打成一个 CJS → bytenode 编成字节码
  dist/                      vite build 的前端
  node_modules/              仅运行时依赖（含 SDK 平台二进制、PGlite）
  launcher.js                十行：设 FAIRWIND_DATA_DIR，require('./brain.jsc')
  Fairwind.app / Fairwind.cmd 由装机脚本在本机生成（不在 zip 里）
```

三个平台各一个 zip：`mac-arm64` `mac-x64` `win-x64`。构建在 GitHub Actions 上做（免费额度够）。

**不在包里**：`demo/` `src/demo/` `supabase/demo/`、任何 `.env`、作者的 `judgments/`、`brain/*.test.js`、源码。

### 9.3 brain 直接服务前端

本地模式下 brain 多做一件事：`GET /` 和静态文件从 `dist/` 出。前端和 brain 同源，`VITE_BRAIN_URL` 不再需要。
今天 `scripts/fairwind.mjs` 起 vite dev server 那条路只在开发时用。

### 9.4 装机

一行命令，装机答疑时作者在场、学员粘一次：

```
mac:  curl -fsSL https://<发布位>/install.sh | sh
win:  irm https://<发布位>/install.ps1 | iex
```

脚本做四件事：按平台下载 zip 到 `~/Applications/Fairwind/`（或 `%LOCALAPPDATA%\Fairwind\`）；解压；
**在本机创建启动器**（mac 是一个最小的 `.app` 包，里面一个 shell 脚本；win 是一个 `.cmd`）；建数据目录。
用脚本创建启动器而不是放在 zip 里，是因为 macOS 给浏览器下载的可执行文件打隔离标记、拦未签名的应用；
`curl` 和本机脚本创建的文件没有这个标记，双击就开。以后应用自己下载的更新也没有这个标记。

第一次启动：浏览器开到 `localhost:8788`，页面问三样——邮箱（本机注册用）、Anthropic API key、备份放哪个文件夹。
Gmail 那步用作者建的共用 Desktop OAuth 应用（`setup/defaults.mjs` 里的 client id/secret 随包出厂）。

学员全程：不装 Node、不开终端（除了粘那一行）、不开任何云控制台。

### 9.5 数据目录

mac `~/Library/Application Support/Fairwind/`，win `%APPDATA%\Fairwind\`。更新只换应用目录，永远不碰这里。

## 十、更新

### 10.1 发布位

一个**公开的、只放发布物的** GitHub 仓库（没有源码，只有 Releases）。每个 Release：三个 zip + `latest.json`
（版本号、每个平台的 URL 和 sha256、这版的一句话）。GitHub Releases 匿名可下、单文件 2GB 上限、免费。
代码仓库另有一个，私有，学员没有。

### 10.2 流程

```
检查   GET latest.json → 跟本地版本比 → 页面右上角出一个小点「有新版本 0.3.1：…」
执行   点「更新」→ 下载 zip 到 <应用目录>/../Fairwind-next/ → 校验 sha256 → 解压
      → 启动器下次启动指向新目录 → 旧目录留一版（回滚用）
启动   新版 brain 起来 → 5.5 的迁移记账跑没跑过的迁移 → judgments/README.md 覆盖 → 其余数据目录不碰
```

第一版：检查在每次启动时做一次，执行靠人点。以后把「执行」也挂到自动，机制不变。

### 10.3 版本

`package.json` 的 `version` 是唯一版本号，构建时写进 `latest.json` 和 `/health`。

## 十一、备份

`settings.json` 里 `backup.dir`。brain 每天一次（以及每次更新前）`pg.dumpDataDir()` → `<backup.dir>/fairwind-YYYY-MM-DD.tar.gz`，
保留最近 14 份。`backup.dir` 选在 iCloud Drive / Google Drive 目录里，备份就自动上了学员自己的云。

恢复：页面上「从备份恢复」选一个文件 → brain 关库 → `new PGlite({ loadDataDir })` → 重开。
恢复前先把当前库也存一份。

## 十二、作者自己

不变。他继续在主线 + 生产库上用；`dbauth` 走 service 模式；手机能看；Supabase 有备份。
同一个仓库，`VITE_DB_MODE` 不设、`.env` 里有 service key，就是今天的样子。

## 十三、往云上走的三步

```
第一步（这次）   前端 ─┐
                 brain ─┴─→ pa_* / v_pa_* →  本机 PGlite

第二步（已做完） 前端 ─┐                       ← 0118 那套，原地留着
                 brain ─┴─→ pa_* / v_pa_* →  云上 Postgres（RLS）

第三步（将来）   瘦客户端 → 云上 brain → pa_* / v_pa_* → 云上 Postgres
```

每步换的是配置和部署。从一到二：学员的库 `dumpDataDir` → 作者导入云库、把本机 uuid 映射成 Auth uuid；
学员那边 `.env` 换成 anon key + 登录。从二到三：前端已经不直连库（D4），只要把 brain 托管起来。

## 十四、隔离的定位

技术上做到：源码不在包里（字节码）、Node 不用装、文件夹结构对非工程师不可读。
挡住的是学员；挡不住肯花一下午的工程师、也挡不住学员让 agent 帮着拆。**不再为这件事追加投入。**

真正的约束是：仓库和包里各放一份许可证（可自用、不可转售、不可用它开班教学）；
他跟这十个人的关系；以及持续更新——抄走的是快照。

## 十五、Gmail

沿用：共用 Desktop OAuth 应用、token 在本机、只存草稿不发信、①b 暂缓。
`setup/defaults.mjs` 里 `GMAIL_CLIENT_ID/SECRET` 至今是空的——这是作者的一次性动作，代码替不了（路线总纲末尾第 1 条）。

## 十六、明确不做

- 共享机会池
- 判据热更新（D8）
- 那四栏（催信天数之类）——看这期的判据文档再降级
- 两边都能写的同步
- 单文件 SEA
- 藏代码的进一步投入（D13）
- 发信
- 物理拆 `brain/modules/`（7.4）
- 现在就搬云

## 十七、验收（全部机器判）

| 事 | 判据 |
|---|---|
| 本地建库 | 空 PGlite 跑完前言 + 全部迁移，表/函数/视图数量与 `db-reset.mjs --wipe` 在 dev 库上建出来的一致 |
| 适配层 | 对每个 `v_pa_*` 视图和每个前端/brain 实际调用的 `pa_*`，本地与 dev 库返回同形状（自动对拍脚本） |
| 窄口 | 扫 `brain/` `src/`：裸 SQL / 裸表访问 = 0 |
| 模块门控 | 关 C：`/mail/*` 404、`mailLoop` 未起、`Mail.jsx` 未渲染；开 C 自动带开 B |
| 判据文档 | 写一个文件 → 提示词里出现在收尾之前；「改字段」的句子被点名；解析失败回退到出厂并留日志 |
| 备份 | dump → 新库 restore → 每张表行数一致 |
| 更新 | 装 v1、造数据、更新到 v2：数据与 `judgments/` 不变、新迁移增量跑、旧版目录还在 |
| 干净机器 | 一台没有 Node 的机器：粘一行、双击启动器、页面上填完三样、能填档案传作品。全程不开云控制台 |
| 打包 | 包里 `grep -r "TRANSITIONS"` 找不到明文 |

## 十八、施工顺序

```
⓪ 合并：主线（batch-and-queue，40 个提交）合进 workshop-edition（12 个）
   · 冲突 7 个文件：server.js、App.jsx、scout.js、scout.test.js、prompt.test.js、TasksPanel.jsx、styles.css
   · 迁移重号一把改到位：ORDER.md 那十支 + 主线的两支 0124 + 本分支 0116–0122 → 0128–0134
   · 之后 db-reset --wipe 在 dev 库上全绿，隔离测试全绿
① 验证：esbuild → bytenode → 自带 node 跑起 brain；PGlite 上前言（create role、auth schema）能跑、开库跑一支迁移；SDK query() 答一句
   （这是地基；不成就换打包形状，其余不动）
② 壳：前言 + 本地迁移记账 + localdb 适配 + dbauth 第三模 + brain 服务 dist + 前端 brainClient + 首次启动页
③ 模块门控 + modules.json + 设置页开关（默认只开 A）      ← 到这里就是「第一个安装包：档案层」
④ 判据文档接口 + 三个安全阀
⑤ 打包流水线 + 装机脚本 + 更新 + 备份
⑥ 干净机器验收
```

③ 完成即可出第一个包给人装；④⑤ 之后才是"能更新的"第一个包。

## 十九、2026-09-16 当时怎么想的

这一节记的是**那天的判断**，会变。以后想法变了，在下面续一段带日期的，不回头改上面。

- **为什么从「作者托管一个库」改成「零托管」**：他给的两条硬约束——不花钱、且用户量不确定——把托管任何数据都排除了；
  免费档撑不住增长，付费档按人涨。托管的唯一剩余物是发版本的地方，而那是免费的。
- **为什么表全建、能力分装，而不是真拆 schema**：`v_pa_state` `v_pa_cue_facts` `v_pa_pursuit_mail` 这些状态机视图
  读 `mail_headers` 和 `pursuit_threads`；`pa_brain_context` 读 `pursuit_threads`。真拆 = 重写 29 个视图里的 8 个、
  十几个函数，而且拆的地方正是耦合最紧的地方。空表零成本，门控在能力层做，学员看到的效果一样。
- **为什么机会池不共享**：他的原话——艺术类每批中选个位数，共享池让学员互相踩。
- **为什么判据能改**：报名页卖的是 *you build your own AI agent*；口味因人而异；judgments/ 是棘轮的读数口。
  为什么先不加那四栏：格子是「很多人在改同一个数字」被证明之后才该出现的东西。
- **为什么隔离到字节码为止**：学员人手一个 agent，`ANTHROPIC_BASE_URL` 指到自己的代理就能看到全部提示词；
  README 里的许可声明对 agent 的约束很弱。技术手段的作用是让「顺手拿走」变成「刻意拿走」，不是防线。
- **为什么不是单文件**：Agent SDK 靠子进程；PGlite 靠 wasm 相对路径；bytenode 要固定 node。三样都指向文件夹。
- **为什么装机要粘一行**：macOS 对浏览器下载的未签名应用有隔离标记；签名公证要 $99/年。粘一行绕开了标记，
  且作者在场。以后如果这一步被证明太痛，$99 是备选。
- **为什么先不做热更新**：`TRANSITIONS` 是带函数的 JS。变成数据是另一刀，而发版本已经覆盖了"推更新"。
- **两条明知的代价**：本地库没有云端备份（用 iCloud/Drive 目录补）；手机上看看板在本地版没有了。
  两条都写在验收之外，是他知道并接受的。

## 名词表

| 名字 | 是什么 |
|---|---|
| PGlite | Postgres 编译成 WASM 的版本，npm 装，不用 Docker，本地库就是它 |
| 前言（preamble） | 本地建库前先跑的一小段 SQL，补上 Supabase 才有的角色和 `auth` schema |
| `pa_*` / `v_pa_*` | 数据库里的函数（写）和视图（读），前端和 brain 只通过它们碰数据 |
| 适配层 | 一个仿 supabase-js 表面的对象，底下连的是 PGlite；前端那份底下连的是 brain |
| `dbauth.js` | brain 里决定「用什么身份连库」的文件，现在两模，这次加第三模 |
| 骨架 / 判据文档 | 转移表的结构（不许改）/ 学员写的口味（`judgments/*.md`） |
| 占位符 `JUDGMENTS_SLOT` | 收尾那段开头的一个标记，运行时换成判据文档内容 |
| bytenode | 把 JS 编成 V8 字节码，源码不在包里 |
| esbuild | 把 `brain/` 几十个文件打成一个文件，给 bytenode 用 |
| SEA | Node 的单文件可执行打包，这次不用 |
| 发布位 | 只放发布物的公开 GitHub 仓库，学员的更新从这里拿 |
| 数据目录 / 应用目录 | 学员机器上两处：一处存数据（更新不碰），一处放程序（更新整个换） |
| 门控 | 一个模块关着时，它的路由、定时器、工具、界面都不出现 |
| 隔离测试 | `scripts/isolation-test.mjs`，8/24 做的，扫全部表和视图证明谁也看不见谁 |
