# 一台机器上的 Fairwind · 施工计划（二）：④判据文档 → ⑤打包/装机/更新/备份 → ⑥干净机器验收

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 第一个能发给学员、能更新、有备份的安装包（mac-arm64），学员能写自己的判据文档。

**Spec:** `docs/specs/2026-09-16-one-machine-fairwind-design.md` 第八、九、十、十一、十七节。计划（一）已做完 ⓪–③。

## Global Constraints

计划（一）的全部约束照旧。另加：
- 外部包一律静态 `import`（bytenode 没有动态 import 回调）；`server.js` 不许顶层 await。
- 学员机器上**所有可写的东西**（库、附件、settings、modules、judgments、Gmail token、备份）都在数据目录 `FAIRWIND_DATA_DIR` 底下；应用目录只读，更新整个换。
- key 永不回显、永不进日志。

## 任务

### Task 1: 判据文档——拼进那一格提示词（骨架不动）
- Create `brain/judgments.js`：`loadJudgments(dir)` 读 `judgments/*.md` → `{ 全部, 对方来信, 我发出的信, 手记, 见面之后 }`（文件名 → 事件名映射表）；`judgmentsFor(ev)`；`fs.watch` 热重载；`lintJudgments()` 找「增加/加一个/去掉/删掉/改成 + 字段名」的句子并点名行号。
- Modify `brain/judge.js`：`收尾()` 开头放占位符 `JUDGMENTS_SLOT`；`cellFor()` 返回的 `ask` 包一层，把占位符换成 `judgmentsFor(ev)`（总开关关着或没文件 → 空串）。`server.js` / `replay.js` 里四处 `cell.ask()` 不改。
- 顺手：`server.js` 的 `JUDGE_SYSTEM` 改成 `judgeSystemFor(voice)`，voice 从 `v_pa_voice` 读、缓存 60 秒——语气五栏里的 `judge_rule` 至此真的生效。
- Test `brain/judgments.test.js`：映射、空文件、占位符替换在收尾之前、lint 点名、开关关着为空。
- `judgments/README.md` 由安装包放进数据目录（Task 5 拷），内容：怎么写、哪些写了不生效。

### Task 2: 三个安全阀 + 界面
- 总开关：`settings.judgmentsEnabled`（默认 true）；`/settings` 读写带上。
- 回放看差别：迁移 `0142_judged_facts_for_preview.sql` 加 `pa_judged_facts(p_limit)`——跟 `pa_facts_to_judge` 同形状，但取**已判过的**（join `message_tags`），多两列 `situation`、`old_tag jsonb`。brain `POST /judgments/preview {limit}`：按 `situation` 拆出 state×event → `cellFor` → 用现在的判据文档判一遍（便宜档、只判不写），返回 `[{ subject, when, gist, old:{needs_reply,wait_days,meet_at}, new:{…}, changed:bool }]`。
- 判不出来回退：`tagPass` 里 `parseTag` 失败且判据文档非空 → 同一格用出厂判据再判一次，日志点名文件。
- 前端 `src/components/Judgments.jsx`：放在「关于你」账号块上面（本机模式才有）：开关「用我的判据 / 用出厂判据」、判据目录路径（可复制）、「看看会怎么变」按钮 + 结果表（变了的行高亮）。
- Test：routes 测 `/judgments/preview` 形状（用假 think）；`tagPass` 回退用单元测试覆盖 `judgeWithFallback()`。

### Task 3: 打包成文件夹应用（mac-arm64）
- 静态化两处动态 import：`brain/files.js`（unpdf）、`brain/mail/auth.js`（child_process）。
- 路径进数据目录：`mail/auth.js` 的 `TOKENS` → `<FAIRWIND_DATA_DIR>/gmail/tokens.json`（没设 env 时保持原位置，个人版不变）。
- `packaging/build.mjs`：`vite build`（`VITE_DB_MODE=local`）→ `dist/`；esbuild+bytenode `brain/server.js` → `brain.jsc`；拷 `preamble.sql`、`migrations/`（只拷 `migrationOrder(fresh)` 那批）、`judgments/README.md`、`dist/`；`npm ci --omit=dev` 到 staging 的 `node_modules/`；拷自带 node；写 `launcher.cjs`（设 `FAIRWIND_DATA_DIR`/`FAIRWIND_DIST_DIR`、`require('bytenode')`、`require('./brain.jsc')`、起来后 `open http://localhost:8788`）；写 `VERSION`；打成 `Fairwind-<ver>-mac-arm64.zip` + `latest.json`（版本、URL 占位、sha256）。
- 不带：`demo/` 三处、`.env*`、`*.test.js`、源码、`packaging/runtime` 以外的 node。
- `/health` 带 `version`（读 `package.json` 打进 bundle 的常量）。版本升到 `0.1.0`。
- 验收：`node packaging/build.mjs` → `packaging/out/Fairwind/` → 用里面的 `node launcher.cjs`（`FAIRWIND_DATA_DIR=/tmp/x`）起来，`/health` 有版本，`/me` ready:false，页面能开；`grep -r TRANSITIONS packaging/out/Fairwind --include='*.js*'` 找不到明文。

### Task 4: 装机脚本（mac）
- `packaging/install.sh`：查 arch → 下载 zip（URL 来自 `latest.json`，`FAIRWIND_RELEASE_URL` 可覆盖，本地测试用 `file://`）→ 解压到 `~/Applications/Fairwind/app-<ver>/`，`current` 符号链接指过去 → 建 `~/Applications/Fairwind.app`（`Contents/MacOS/Fairwind` 是一段 sh：`exec "$HOME/Applications/Fairwind/current/node" "$HOME/Applications/Fairwind/current/launcher.cjs"`；`Info.plist` 最小）→ `open` 它。
- win 的 `install.ps1` 留到有 win 构建再写（本计划不做）。
- 验收：用 `file://` 指向 Task 3 的产物跑一遍脚本（`HOME=/tmp/fakehome`），`.app` 结构对，`current` 指对。

### Task 5: 更新
- `packaging/release.json`：`{ "latestUrl": "<占位>" }`，esbuild `define` 进 bundle；`FAIRWIND_RELEASE_URL` env 可覆盖。
- brain：`GET /update/check` → 取 `latest.json`，跟自己版本比 → `{ current, latest, note, canUpdate }`（缓存 1 小时；启动时查一次）；`POST /update/apply` → 下载到 `<应用目录>/../app-<ver>.zip` → sha256 校验 → 解压到 `app-<ver>/` → 先备份（Task 6）→ `current` 指过去 → `{ ok, restart: true }`。应用目录由 `launcher.cjs` 通过 `FAIRWIND_APP_ROOT` 告诉 brain（`~/Applications/Fairwind`）。
- 前端：`/health` 轮询里带 `update`；顶栏名字旁一个小点，点开 `ModulesPanel` 下面一行「有新版本 x.y.z：<note>」+「更新」按钮 → 提示「关掉再打开就是新版」。
- Test：`brain/local/update.test.js` 用本地 http 假发布位：check 认版本、apply 校验 sha、解压、指针换、旧版还在。

### Task 6: 备份与恢复
- `brain/local/backup.js`：`backupNow(pg, dir)` → `pg.dumpDataDir('gzip')` → `<dir>/fairwind-YYYY-MM-DD-HHmm.tar.gz`，留最近 14 份；每天一次（`applyTimers` 里再加一个，跟模块无关、`backupDir` 非空才起）；更新前调一次。
- 恢复：`POST /backup/restore { path }` → 校验文件存在 → 拷到 `<数据目录>/restore.tar.gz` → 回 `{ ok, restart: true }`；`openLocalDb` 启动时发现它：把现在的 `db/` 改名 `db.bak-<ts>`，`new PGlite(dir, { loadDataDir: blob })`，删标记。
- 路由：`POST /backup/now`、`GET /backup/list`、`POST /backup/restore`。前端账号块底下「现在备份」「从备份恢复…」+ 最近一次时间。
- Test：dump → 新目录 restore → 每张表行数一致；保留 14 份；标记恢复流程。

### Task 7: 干净机器验收（能做到的最接近版本）
- 在 `/tmp/cleanhome` 下：`HOME=/tmp/cleanhome PATH=/usr/bin:/bin`（没有本机 node）跑 `install.sh`（`file://` 指向产物）→ 双击等价：执行 `.app` 里的脚本 → 无头浏览器走首次启动 → 填三样 → 我的档案能填名字、传一条作品 → 关掉重开还在 → 「现在备份」有文件 → `judgments/` 里写一个文件、「看看会怎么变」有结果（用假 key 时接口应明确报错而不是静默）。
- 把过程写成 `packaging/ACCEPTANCE.md`，每条勾上。

## 明确不做（这份）
win / mac-x64 构建（要 CI 矩阵）；判据热更新；Gmail 共用应用（他的一次性动作）；学员 scout 的默认提示词（记在计划一末尾，归机会线模块，下次）。
