# 一台机器上的 Fairwind · 施工计划（一）：⓪合并 → ①验证 → ②壳 → ③模块门控

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Fairwind 在一台没有云、没有登录的机器上，用本地 PGlite 库跑起来，并且只开「档案层」——这是第一个安装包的内容。

**Architecture:** 同一批迁移文件在 PGlite 上原样跑（前面加一段本地前言）；brain 的 `makeDb()` 加第三模 `local`，返回一个仿 supabase-js 表面的适配对象；前端在 `VITE_DB_MODE=local` 时把 `supa` 换成打到 brain 的客户端，21 个调用文件不改。模块是能力开关：表全建，路由/定时器/工具/界面按 `modules.json` 门控。

**Tech Stack:** Node 24（自带）、@electric-sql/pglite 0.5.x、esbuild 0.28、bytenode 1.6、supabase-js 2.x（云端模式不变）、React 18 + Vite 5。

**Spec:** `docs/specs/2026-09-16-one-machine-fairwind-design.md`（本计划只覆盖第十八节的 ⓪①②③；④⑤⑥ 另起一份）

## Global Constraints

- 数据访问只走 `pa_*` 函数和 `v_pa_*` 视图；`brain/` 和 `src/` 里不许出现裸 SQL、裸表（设计稿 6.4 规矩 1）。**唯一例外**：`brain/local/` 目录（前言、迁移记账、适配层本身）。
- 迁移文件是 schema 唯一真相；本地前言不碰 `producer` schema。
- 本地模式下前端不直连库；`src/lib/backends.js` 是唯一建客户端的地方。
- 作者的云端模式（`SUPABASE_SERVICE_ROLE_KEY` 在 `brain/.env`）行为**一个字不变**——每个任务的测试里都要有一条「云端模式不受影响」。
- 功能只增不减：云端模式下所有模块永远开着。
- 所有工作在 worktree `/Users/dihu/Desktop/producer-agent/.claude/worktrees/workshop-edition`（分支 `workshop-edition`）。**不碰主目录、不碰生产库 `jjgvvtrsnoqnoigukobi`**。dev 库在根 `.env` 的 `DEV_DATABASE_URL`。
- 提交信息用中文，说清「改了什么、为什么」；每个任务至少一次提交。
- 测试命令：根目录 `npm test`（`node --test 'src/lib/*.test.js' 'brain/*.test.js' 'brain/mail/*.test.js'`）。新测试文件放在被测文件旁边，`*.test.js`。

---

## 文件结构（这份计划新建/改动的）

| 文件 | 职责 |
|---|---|
| `supabase/migrations/*`（改名 31 支） | 一条线递增，重号清零 |
| `scripts/migration-order.mjs` | 重号表退化成「纯排序 + 跳过数据修复」 |
| `brain/local/preamble.sql` | 本地前言：角色、`auth` schema、`auth.users`、`auth.uid()` |
| `brain/local/migrate.js` | 打开 PGlite、跑前言、按序跑没跑过的迁移、记账 |
| `brain/local/spike.js` | ①的验证入口（可弃） |
| `brain/local/localdb.js` | 适配对象：`.rpc` `.from` `.storage` `.auth` |
| `brain/local/routes.js` | `/db/rpc/:name` `/db/from` `/files/*` `/me` `/setup` `/modules` |
| `brain/local/settings.js` | `settings.json`（uuid、邮箱、key、备份目录）读写 |
| `brain/modules.js` | 模块清单、依赖闭包、`modules.json` 读写、`enabled()` |
| `brain/dbauth.js` | 第三模 `local` |
| `brain/server.js` | 启动改 `main()`；接本地路由；服务 `dist/`；路由/定时器/工具门控 |
| `brain/package.json` | 加 `@electric-sql/pglite` `bytenode`（运行时）、`esbuild`（开发） |
| `packaging/build-brain.mjs` | esbuild → bytenode |
| `src/lib/brainClient.js` | 前端的本地客户端（同 supabase-js 表面） |
| `src/lib/backends.js` | 按 `VITE_DB_MODE` 选客户端 |
| `src/lib/modules.js` + `src/lib/ModulesContext.jsx` | 前端读 `/modules` |
| `src/components/AuthGate.jsx` | 本地未初始化 → `FirstRun` |
| `src/components/FirstRun.jsx` | 首次启动页：邮箱、API key、备份目录 |
| `src/components/ModulesPanel.jsx` | 设置里的三行开关 |
| `src/App.jsx` | `AREAS` 按模块过滤；邮件界面门控 |
| `package.json` | `npm run local`、`npm run build:local` |

---

## ⓪ 合并与迁移重号

### Task 1: 主线合进 workshop-edition

**Files:**
- Modify: 冲突的 7 个——`brain/server.js` `src/App.jsx` `brain/scout.js` `brain/scout.test.js` `brain/prompt.test.js` `src/components/TasksPanel.jsx` `src/styles.css`

**Interfaces:**
- Produces: 一棵同时含主线 40 个提交（书桌、机会池、任务定时、[[MEMO]]…）和本分支 12 个提交（语气五栏、多租户、dbauth 双模、setup）的树。

- [ ] **Step 1: 确认起点干净**

Run: `git status --short && git log --oneline -1 && git rev-list --count 997593d..HEAD && git rev-list --count 997593d..batch-and-queue`
Expected: 无未提交改动；`12` 和 `40`。

- [ ] **Step 2: 合并**

```bash
git merge batch-and-queue --no-commit
git status --short | grep '^UU\|^AA'
```
Expected: 正好 7 行冲突。

- [ ] **Step 3: 逐个解冲突（原则）**

每处冲突问一句：**这段是主线新长的功能，还是本分支加的「认人」钩子？两者都留。** 具体：

- `brain/server.js`：留主线的全部新路由/定时器（studio、scout 定时、[[MEMO]]、`0125` 那套）；留本分支的 `makeDb()/DB_MODE/requireUser` 启动段、`judgeSystemFor(voice)`/`systemFor(profile, voice)` 调用、`asOwner`。`BRAIN_BUILD` 取主线的值。
- `brain/scout.js` `brain/scout.test.js`（add/add）：以主线为底（247 行那版），把本分支 `0122_scout_reads_your_profile` 对应的「从 `v_pa_profile` 读匹配规则」那段合进去；测试两边的用例都保留。
- `brain/prompt.test.js`：两边的用例都留；若同名用例，留断言更多的那个。
- `src/App.jsx`：以主线为底；本分支只改了 11 行（`Identity`/登录相关），把那 11 行搬进去。
- `src/components/TasksPanel.jsx` `src/styles.css`：两边都留，样式冲突处以主线为准。

解完每个文件立刻 `node --check`（js）或 `npx vite build`（jsx）验语法。

- [ ] **Step 4: 语法与测试**

Run: `npm test 2>&1 | tail -15 && npm run build 2>&1 | tail -3 && (cd brain && node --check server.js && node --check scout.js)`
Expected: 测试全过（主线和本分支的测试数相加）；vite build 成功。

- [ ] **Step 5: 提交合并**

```bash
git add -A && git commit -m "合并主线（997593d..batch-and-queue，40 个提交）进 workshop-edition

书桌、机会池、任务定时、[[MEMO]] 都进来了；本分支的认人钩子（dbauth 双模、
语气五栏、scout 读档案）原样保留。迁移暂时重号，下一支提交一把改到位。"
```

### Task 2: 迁移重号一把改到位

**Files:**
- Rename: `supabase/migrations/` 里 31 支（清单见 Step 1）
- Modify: `scripts/migration-order.mjs`、`supabase/migrations/ORDER.md`

**Interfaces:**
- Produces: `migrationOrder(dir, { fresh })` 语义不变，但内部不再有重号表；文件名字典序 = 真实顺序。

- [ ] **Step 1: 改名（真实应用顺序：祖先重号块 → 主线 → 本分支）**

```bash
cd supabase/migrations
# 祖先重号块（ORDER.md 那十支，按生产库时间戳）
git mv 0113_rule_pass_only_writes_real_verdicts.sql   0114_rule_pass_only_writes_real_verdicts.sql
git mv 0114_pulse_by_area.sql                          0115_pulse_by_area.sql
git mv 0115_the_board_stops_hauling_long_text.sql      0116_the_board_stops_hauling_long_text.sql
git mv 0111_needs_reply_is_not_shadowed.sql            0117_needs_reply_is_not_shadowed.sql
git mv 0112_scheduled_sends_get_audited.sql            0118_scheduled_sends_get_audited.sql
git mv 0113_retag_replays_in_order.sql                 0119_retag_replays_in_order.sql
git mv 0114_the_clock_follows_your_last_letter.sql     0120_the_clock_follows_your_last_letter.sql
# 主线分叉后的 14 支（已按顺序，只是整体后移；两支 0124 按提交日期 9/4 → 9/5）
git mv 0115_a_replying_sibling_mailbox_lets_itself_in.sql 0121_a_replying_sibling_mailbox_lets_itself_in.sql
git mv 0116_a_reply_is_not_silence.sql                 0122_a_reply_is_not_silence.sql
git mv 0117_the_nth_follow_up.sql                      0123_the_nth_follow_up.sql
git mv 0118_three_letters_then_change_tack.sql         0124_three_letters_then_change_tack.sql
git mv 0119_a_task_runs_on_a_schedule.sql              0125_a_task_runs_on_a_schedule.sql
git mv 0120_a_pool_of_opportunities.sql                0126_a_pool_of_opportunities.sql
git mv 0121_copied_people_join_the_line.sql            0127_copied_people_join_the_line.sql
git mv 0122_a_thread_full_of_people.sql                0128_a_thread_full_of_people.sql
git mv 0123_a_chat_moves_the_state.sql                 0129_a_chat_moves_the_state.sql
git mv 0124_only_a_note_resets_the_count.sql           0130_only_a_note_resets_the_count.sql
git mv 0124_a_person_can_have_unread_too.sql           0131_a_person_can_have_unread_too.sql
git mv 0125_say_it_and_fairwind_files_it.sql           0132_say_it_and_fairwind_files_it.sql
git mv 0126_an_introduction_has_a_third_person.sql     0133_an_introduction_has_a_third_person.sql
git mv 0127_a_desk_in_the_archive.sql                  0134_a_desk_in_the_archive.sql
# 本分支的 7 支（只应用过 dev，dev 会重建）
git mv 0116_the_voice_is_data.sql                      0135_the_voice_is_data.sql
git mv 0117_the_four_the_repo_could_not_build.sql      0136_the_four_the_repo_could_not_build.sql
git mv 0118_many_artists_one_database.sql              0137_many_artists_one_database.sql
git mv 0119_the_pulse_belongs_to_someone.sql           0138_the_pulse_belongs_to_someone.sql
git mv 0120_a_curator_belongs_to_each_address_book.sql 0139_a_curator_belongs_to_each_address_book.sql
git mv 0121_no_key_remembers_the_single_user.sql       0140_no_key_remembers_the_single_user.sql
git mv 0122_scout_reads_your_profile.sql               0141_scout_reads_your_profile.sql
cd ../..
ls supabase/migrations/*.sql | sed -E 's/.*\/([0-9]{4}).*/\1/' | sort | uniq -d
```
Expected: 最后一行**没有输出**（无重号）。

注意：主线 `0121_copied…`/`0122_a_thread…` 先改名走，再改本分支同号的——上面顺序已经排好，别调换。

- [ ] **Step 2: 写 migration-order.mjs 的新样子**

```js
// scripts/migration-order.mjs
// 迁移顺序 = 文件名字典序。2026-09-16 合并时重号已清零（见 ORDER.md）。
// 这个文件留下的只有一件事:哪些是一次性数据修复,新装要跳过。
import { readdirSync } from 'node:fs'

// 一次性的**数据修复**,不是 schema。它们修的是他库里某几行历史数据,
// 而且带护栏——「该修 N 条,实际 0 条就整道回滚」。空库上本来就没东西可修。
const 数据修复 = new Set([
  '0067_work_notes_are_not_the_reply.sql',
  '0113_a_second_workshop_to_offer.sql',   // 他个人的 offer 条目——学员的新库里不该有他的档案
])

/**
 * 全部迁移文件名,按该跑的顺序。
 * @param {object} opts
 * @param {boolean} opts.fresh  true = 新装,跳过一次性数据修复
 */
export function migrationOrder(dir = 'supabase/migrations', { fresh = false } = {}) {
  const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  const nums = all.map((f) => f.slice(0, 4))
  const dup = nums.find((n, i) => nums.indexOf(n) !== i)
  if (dup) throw new Error(`迁移重号:${dup}。一条线递增,不许再撞。`)
  return fresh ? all.filter((f) => !数据修复.has(f)) : all
}

export { 数据修复 as DATA_REPAIRS }
```

- [ ] **Step 3: ORDER.md 改成「已做完」的记录**

在 `supabase/migrations/ORDER.md` 顶部加一节：

```markdown
## 2026-09-16 · 已改到位

合并主线那次一把改的：祖先重号块十支按下表；主线 0115–0127 → 0121–0134
（两支 0124 按提交日 9/4 → 9/5）；本分支 0116–0122 → 0135–0141。
`migration-order.mjs` 从此只剩「跳过数据修复」，顺序 = 文件名。
生产库 `schema_migrations` 里记的还是旧名——上 CLI 之前要对一次账（下面第 2 条）。
```
下面的旧内容保留。

- [ ] **Step 4: dev 库从零重建 + 隔离测试**

Run: `node scripts/db-reset.mjs --wipe 2>&1 | tail -8`
Expected: `跑完:N/N 支成功`，失败 0；报出的表/函数/视图数**记下来**（后面 Task 5 要对）。
若某支失败：多半是本分支 0139（email 唯一索引）撞上主线 0127/0128 改过的索引名——对着报错改那支迁移（改本分支这 7 支，不改主线的）。

Run: `node scripts/isolation-test.mjs 2>&1 | tail -5`
Expected: 全绿（对方标记 0 字节）。主线新表（`opportunities` `studio_messages` `contact_seen` `thread_marks`）被 0137 的循环自动带上 owner——测试报告里要能看到它们。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "迁移重号一把改到位：祖先十支 + 主线十四支 + 本分支七支，顺序=文件名

migration-order.mjs 退化成纯排序 + 跳过数据修复；再撞号会当场抛。
dev 库从零重建 N/N 绿，隔离测试绿。"
```

---

## ① 打包验证（地基）

### Task 3: esbuild → bytenode → 自带 node 跑起 PGlite 与 SDK

**Files:**
- Modify: `brain/package.json`（deps 加 `@electric-sql/pglite@^0.5.8` `bytenode@^1.6.0`；devDeps 加 `esbuild@^0.28.2`）
- Create: `brain/local/preamble.sql`（最小版，Task 4 补全）、`brain/local/spike.js`、`packaging/build-brain.mjs`、`packaging/.gitignore`

**Interfaces:**
- Produces: `packaging/build-brain.mjs <entry> <outname>` → `brain/dist/<outname>.jsc`；结论写进 `packaging/SPIKE.md`。

- [ ] **Step 1: 装依赖**

Run: `cd brain && npm i @electric-sql/pglite@^0.5.8 bytenode@^1.6.0 && npm i -D esbuild@^0.28.2 && cd ..`

- [ ] **Step 2: 最小前言**

```sql
-- brain/local/preamble.sql —— 本地建库前先跑的一段。只在 PGlite 上跑,不进 supabase/migrations。
create role anon;
create role authenticated;
create role service_role;
create schema if not exists auth;
create table if not exists auth.users (
  id         uuid primary key,
  email      text,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('fairwind.uid', true), '')::uuid $$;
```

- [ ] **Step 3: 验证入口**

```js
// brain/local/spike.js —— ①的验证:字节码 + 自带 node 上,PGlite 能建库、SDK 能答话。可弃。
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'fairwind-spike-'))
  const pg = new PGlite(dir)
  await pg.exec(readFileSync(join(HERE, 'preamble.sql'), 'utf8'))
  console.log('前言 ✓  (create role / auth schema 在 PGlite 上能跑)')
  const first = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()[0]
  await pg.exec(readFileSync(join(ROOT, 'supabase/migrations', first), 'utf8'))
  const { rows } = await pg.query(`select count(*)::int as n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='producer' and c.relkind='r'`)
  console.log(`迁移 ${first} ✓  producer 里 ${rows[0].n} 张表`)
  await pg.query(`select set_config('fairwind.uid', $1, false)`, ['11111111-1111-4111-8111-111111111111'])
  const u = await pg.query('select auth.uid() as uid')
  console.log(`auth.uid() = ${u.rows[0].uid} ✓`)
  await pg.close()

  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  let text = ''
  for await (const m of query({ prompt: '只回一个字：好', options: { maxTurns: 1, allowedTools: [] } })) {
    if (m.type === 'result') text = m.result
  }
  console.log(`SDK 子进程 ✓  它说:${String(text).trim().slice(0, 20)}`)
  console.log('\n全部通过。')
}
main().catch((e) => { console.error('✗', e); process.exit(1) })
```

- [ ] **Step 4: 构建脚本**

```js
// packaging/build-brain.mjs —— esbuild 把一个入口打成 CJS,bytenode 编成字节码。
//   node packaging/build-brain.mjs brain/local/spike.js spike
//   node packaging/build-brain.mjs brain/server.js brain
// 产物在 brain/dist/<name>.cjs 和 .jsc。放在 brain/ 底下,是为了运行时能找到 brain/node_modules。
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdirSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const [entry, name] = process.argv.slice(2)
if (!entry || !name) { console.error('用法:node packaging/build-brain.mjs <entry> <name>'); process.exit(1) }
const out = resolve('brain/dist', `${name}.cjs`)
mkdirSync(resolve('brain/dist'), { recursive: true })

await build({
  entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'cjs', target: 'node24',
  packages: 'external',                       // node_modules 不打进去,运行时从 brain/node_modules 找
  define: { 'import.meta.url': '__IMPORT_META_URL' },
  banner: { js: "const __IMPORT_META_URL = require('node:url').pathToFileURL(__filename).href;" },
  logLevel: 'warning',
})
// bytenode 是 CLI 也可以 require;用 CLI 最省事,它自己会用当前 node 的 V8 编
execFileSync(process.execPath, [resolve('brain/node_modules/bytenode/lib/cli.js'), '--compile', out], { stdio: 'inherit' })
unlinkSync(out)                               // 只留字节码,不留明文
console.log(`✓ brain/dist/${name}.jsc`)
```

注意 esbuild 对 `import.meta.url` 的 `define` 要求值是标识符——上面用 banner 声明了那个标识符。

- [ ] **Step 5: 拿一份「自带的」node 24**

```bash
mkdir -p packaging/runtime && cd packaging/runtime
curl -fsSLO https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.gz
tar xzf node-v24.21.0-darwin-arm64.tar.gz && mv node-v24.21.0-darwin-arm64 node-darwin-arm64 && rm *.tar.gz
cd ../.. && printf 'runtime/\nout/\n' > packaging/.gitignore
packaging/runtime/node-darwin-arm64/bin/node -v
```
Expected: `v24.21.0`

- [ ] **Step 6: 用自带 node 编译并运行字节码**

**字节码必须由将来跑它的那个 node 编**（V8 版本要一致），所以编译也用自带 node：

```bash
NODE=packaging/runtime/node-darwin-arm64/bin/node
$NODE packaging/build-brain.mjs brain/local/spike.js spike
cd brain && ../$NODE -e "require('bytenode'); require('./dist/spike.jsc')"; cd ..
```
Expected 四行 ✓ + `全部通过。`

若 `require(esm)` 报错（SDK 是 ESM）：Node 24 默认支持同步 require ESM；若仍报，把 spike 里对 SDK 的 `import()` 保持动态（已是动态）并在 esbuild 里加 `--external:@anthropic-ai/claude-agent-sdk`（`packages: 'external'` 已覆盖）。
若 PGlite 找不到 wasm：确认 bundle 落在 `brain/dist/`、`brain/node_modules/@electric-sql/pglite` 存在。
若 `create role` 在 PGlite 上报错：把前言里三行改成 `do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if; ... end $$;`。

- [ ] **Step 7: 记结论**

写 `packaging/SPIKE.md`：日期、node 版本、三样各自通过/不通过、遇到的坑和绕法。**不通过的话停在这里，回设计稿改打包形状，不往下做 ②。**

- [ ] **Step 8: 提交**

```bash
git add brain/package.json brain/package-lock.json brain/local packaging && git commit -m "①验证通过：esbuild→bytenode→自带 node，PGlite 建库、SDK 子进程都能跑

前言里 create role / auth schema 在 PGlite 上没问题。结论在 packaging/SPIKE.md。"
```

---

## ② 壳

### Task 4: 本地建库——前言、按序跑迁移、记账

**Files:**
- Modify: `brain/local/preamble.sql`（补全）
- Create: `brain/local/migrate.js`、`brain/local/migrate.test.js`

**Interfaces:**
- Produces:
  - `openLocalDb(dataDir: string): Promise<PGlite>` —— 打开（或新建）`<dataDir>/db`，跑前言（幂等）
  - `applyMigrations(pg, { fresh }): Promise<{ applied: string[], skipped: number }>` —— 按 `migrationOrder()` 跑没记过的，每支一个事务，记进 `producer_meta.applied`
  - `setLocalUid(pg, uid: string): Promise<void>` —— `set_config('fairwind.uid', …)`
  - `registerLocalUser(pg, { id, email }): Promise<void>` —— 往 `auth.users` 插一行（触发 `handle_new_user`）

- [ ] **Step 1: 补全前言（幂等）**

```sql
-- brain/local/preamble.sql
-- 本地建库前先跑的一段。只在 PGlite 上跑,不进 supabase/migrations,不碰 producer schema。
-- 补的是 Supabase 才有的三样:三个角色(迁移里 grant 要用)、auth schema、auth.uid()。
-- 全部幂等:每次启动都跑一遍也没事。
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon;          end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role;  end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id         uuid primary key,
  email      text,
  created_at timestamptz not null default now()
);
-- 「现在登录的是谁」:brain 每次开库后 set_config 一次(PGlite 只有一个会话,设一次一直在)
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('fairwind.uid', true), '')::uuid $$;
-- 迁移记账
create schema if not exists producer_meta;
create table if not exists producer_meta.applied (
  filename   text primary key,
  applied_at timestamptz not null default now()
);
```

- [ ] **Step 2: 写测试（先失败）**

```js
// brain/local/migrate.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser } from './migrate.js'

const UID = '11111111-1111-4111-8111-111111111111'
const tmp = () => mkdtempSync(join(tmpdir(), 'fairwind-migrate-'))

test('空目录:前言跑通,auth.uid() 跟着 set_config 走', async () => {
  const dir = tmp()
  const pg = await openLocalDb(dir)
  const before = await pg.query('select auth.uid() as uid')
  assert.equal(before.rows[0].uid, null)
  await setLocalUid(pg, UID)
  const after = await pg.query('select auth.uid() as uid')
  assert.equal(after.rows[0].uid, UID)
  await pg.close(); rmSync(dir, { recursive: true, force: true })
})

test('全部迁移在 PGlite 上从零跑绿;第二次跑是 no-op', async () => {
  const dir = tmp()
  const pg = await openLocalDb(dir)
  const r1 = await applyMigrations(pg, { fresh: true })
  assert.ok(r1.applied.length > 100, `只跑了 ${r1.applied.length} 支`)
  const r2 = await applyMigrations(pg, { fresh: true })
  assert.deepEqual(r2.applied, [])
  assert.equal(r2.skipped, r1.applied.length)
  const { rows } = await pg.query(`
    select (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='producer' and c.relkind='r') as tables,
           (select count(*)::int from pg_proc  p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'pa\\_%') as fns,
           (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' and c.relname like 'v\\_pa\\_%') as views`)
  // 这三个数要跟 Task 2 Step 4 里 db-reset 在 dev 库上报的一致——对不上就是某支迁移在 PGlite 上静默少建了东西
  console.log(`  PGlite 建出来:${rows[0].tables} 张表 · ${rows[0].fns} 个函数 · ${rows[0].views} 个视图`)
  assert.ok(rows[0].tables >= 29 && rows[0].views >= 29)
  await pg.close(); rmSync(dir, { recursive: true, force: true })
})

test('注册本机用户:触发器造出 profile 和 voice 行,owner 盖上 uid', async () => {
  const dir = tmp()
  const pg = await openLocalDb(dir)
  await applyMigrations(pg, { fresh: true })
  await setLocalUid(pg, UID)
  await registerLocalUser(pg, { id: UID, email: 'a@b.c' })
  const p = await pg.query('select owner from producer.profile')
  const v = await pg.query('select owner from producer.voice')
  assert.equal(p.rows.length, 1); assert.equal(p.rows[0].owner, UID)
  assert.equal(v.rows.length, 1); assert.equal(v.rows[0].owner, UID)
  await pg.close(); rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 3: 跑,确认失败**

Run: `node --test brain/local/migrate.test.js 2>&1 | tail -5`
Expected: FAIL（`./migrate.js` 不存在）

- [ ] **Step 4: 实现**

```js
// brain/local/migrate.js —— 本地库:打开、前言、按序跑迁移、记账。
//
// 这是设计稿(2026-09-16)6.4 规矩 2 的唯一例外:这里能碰裸 SQL,因为它就是把
// supabase/migrations 原样喂给 PGlite 的那只手。别的地方一律走 pa_* / v_pa_*。
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrationOrder } from '../../scripts/migration-order.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
// 打包后迁移文件在 <应用目录>/migrations;开发时在仓库的 supabase/migrations
export const MIGRATIONS_DIR = existsSync(join(HERE, '..', '..', 'supabase', 'migrations'))
  ? join(HERE, '..', '..', 'supabase', 'migrations')
  : join(HERE, '..', 'migrations')

/** 打开(或新建)<dataDir>/db,跑前言。前言幂等,每次开都跑。 */
export async function openLocalDb(dataDir) {
  const pg = new PGlite(join(dataDir, 'db'))
  await pg.exec(readFileSync(join(HERE, 'preamble.sql'), 'utf8'))
  return pg
}

export async function setLocalUid(pg, uid) {
  await pg.query(`select set_config('fairwind.uid', $1, false)`, [uid])
}

/** 往 auth.users 插一行;0137 的触发器随即造出这个人的 profile / voice。 */
export async function registerLocalUser(pg, { id, email }) {
  await pg.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [id, email])
}

/**
 * 按 migrationOrder 跑没记过的迁移,每支一个事务,记进 producer_meta.applied。
 * 装机和更新调的是同一个函数。
 */
export async function applyMigrations(pg, { fresh = true, dir = MIGRATIONS_DIR, log = () => {} } = {}) {
  const files = migrationOrder(dir, { fresh })
  const { rows } = await pg.query('select filename from producer_meta.applied')
  const done = new Set(rows.map((r) => r.filename))
  const applied = []
  for (const f of files) {
    if (done.has(f)) continue
    const sql = readFileSync(join(dir, f), 'utf8')
    try {
      await pg.exec('begin')
      await pg.exec(sql)
      await pg.query('insert into producer_meta.applied (filename) values ($1)', [f])
      await pg.exec('commit')
      applied.push(f); log(`  ✓ ${f}`)
    } catch (err) {
      await pg.exec('rollback').catch(() => {})
      throw new Error(`迁移 ${f} 失败:${err.message.split('\n')[0]}`)
    }
  }
  return { applied, skipped: files.length - applied.length }
}
```

- [ ] **Step 5: 跑测试**

Run: `node --test brain/local/migrate.test.js 2>&1 | tail -12`
Expected: 3 pass。第二个测试打印的三个数**跟 Task 2 Step 4 记下的一致**。不一致 → 找出哪支迁移在 PGlite 上没建出东西（多半是 `grant`/`alter default privileges` 之类静默失败），修前言或那支迁移。

常见坑:
- 某支迁移里有 `alter table … enable row level security` + `create policy … to authenticated` → 前言里角色已建,应能过。
- `security invoker` 视图需要 PG15+;PGlite 0.5 是 PG17,可以。
- 迁移里若引用 `extensions.` 或 `auth.jwt()`:grep 一下,有就在前言里补一个桩。

- [ ] **Step 6: 把测试加进 npm test**

`package.json` 的 `test` 脚本改成:
`node --test 'src/lib/*.test.js' 'brain/*.test.js' 'brain/mail/*.test.js' 'brain/local/*.test.js'`

- [ ] **Step 7: 提交**

```bash
git add brain/local package.json && git commit -m "本地建库：前言 + 按序跑迁移 + 记账，PGlite 上从零全绿

同一批 supabase/migrations，前面加一段幂等前言（角色、auth schema、auth.uid()）。
注册 = 往 auth.users 插一行，0137 的触发器照常造 profile/voice。"
```

### Task 5: 适配对象 `localdb.js`——仿 supabase-js 的表面

**Files:**
- Create: `brain/local/localdb.js`、`brain/local/localdb.test.js`

**Interfaces:**
- Consumes: Task 4 的 `openLocalDb` `applyMigrations` `setLocalUid` `registerLocalUser`
- Produces: `makeLocalDb({ pg, dataDir, user }): LocalDb`，其中
  - `db.rpc(name, args) → Promise<{ data, error }>`
  - `db.from(view).select(cols).eq(c,v).in(c,arr).order(c,{ascending}).limit(n).maybeSingle()` —— 可 `await`（thenable）→ `{ data, error }`
  - `db.storage.from(bucket).upload(key, bytes, {contentType}) / download(key) / remove([keys]) / createSignedUrl(key, sec)`
  - `db.auth.getUser() → { data: { user }, error: null }`
  - `db.refreshFunctions()` —— 迁移之后重读 `pg_proc`

- [ ] **Step 1: 测试（先失败）**

```js
// brain/local/localdb.test.js
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser } from './migrate.js'
import { makeLocalDb } from './localdb.js'

const UID = '11111111-1111-4111-8111-111111111111'
let dir, pg, db
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fairwind-localdb-'))
  pg = await openLocalDb(dir)
  await applyMigrations(pg, { fresh: true })
  await setLocalUid(pg, UID)
  await registerLocalUser(pg, { id: UID, email: 'a@b.c' })
  // 三个夹具函数,专门测返回值整形(跟 PostgREST 同规矩)
  await pg.exec(`
    create function public.pa_t_scalar(p_x int) returns int language sql as $$ select p_x * 2 $$;
    create function public.pa_t_setof(p_n int) returns setof int language sql as $$ select generate_series(1, p_n) $$;
    create function public.pa_t_table(p_s text) returns table (a text, b int) language sql as $$ select p_s, 1 union all select p_s, 2 $$;
    create function public.pa_t_json(p_s text) returns jsonb language sql as $$ select jsonb_build_object('s', p_s) $$;
    create function public.pa_t_void(p_s text) returns void language sql as $$ select 1 $$;
    create function public.pa_t_dflt(p_a int, p_b int default 10) returns int language sql as $$ select p_a + p_b $$;
  `)
  db = await makeLocalDb({ pg, dataDir: dir, user: { id: UID, email: 'a@b.c' } })
})
after(async () => { await pg.close(); rmSync(dir, { recursive: true, force: true }) })

test('rpc:标量 / setof 标量 / table / json / void / 默认参数', async () => {
  assert.deepEqual(await db.rpc('pa_t_scalar', { p_x: 3 }), { data: 6, error: null })
  assert.deepEqual((await db.rpc('pa_t_setof', { p_n: 3 })).data, [1, 2, 3])
  assert.deepEqual((await db.rpc('pa_t_table', { p_s: 'x' })).data, [{ a: 'x', b: 1 }, { a: 'x', b: 2 }])
  assert.deepEqual((await db.rpc('pa_t_json', { p_s: 'x' })).data, { s: 'x' })
  assert.deepEqual(await db.rpc('pa_t_void', { p_s: 'x' }), { data: null, error: null })
  assert.equal((await db.rpc('pa_t_dflt', { p_a: 1 })).data, 11)
})

test('rpc:不存在的函数 / SQL 错误 → error,不抛', async () => {
  const r = await db.rpc('pa_nope', {})
  assert.equal(r.data, null); assert.match(r.error.message, /pa_nope/)
})

test('rpc:真函数——pa_set_profile 写、v_pa_profile 读', async () => {
  const w = await db.rpc('pa_set_profile', { p_name: '测试' })
  assert.equal(w.error, null, w.error?.message)
  const { data, error } = await db.from('v_pa_profile').select('*').maybeSingle()
  assert.equal(error, null); assert.equal(data.name, '测试')
})

test('from:select/eq/in/order/limit 拼成一条 select', async () => {
  const q = db.from('v_pa_entries').select('id, title').eq('kind', 'work').in('id', ['a', 'b']).order('title', { ascending: false }).limit(5)
  assert.equal(q.toSQL().text, 'select id, title from public.v_pa_entries where kind = $1 and id = any($2) order by title desc limit 5')
  assert.deepEqual(q.toSQL().values, ['work', ['a', 'b']])
  const { data, error } = await q
  assert.equal(error, null); assert.deepEqual(data, [])
})

test('from:列名只许字母数字下划线逗号空格', async () => {
  const r = await db.from('v_pa_profile').select('*; drop table x')
  assert.match(r.error.message, /列名/)
})

test('storage:upload → download → createSignedUrl → remove', async () => {
  const s = db.storage.from('pursuit-files')
  const up = await s.upload('p1/hello.txt', Buffer.from('hi'), { contentType: 'text/plain' })
  assert.equal(up.error, null)
  const dl = await s.download('p1/hello.txt')
  assert.equal(Buffer.from(await dl.data.arrayBuffer()).toString(), 'hi')
  const url = await s.createSignedUrl('p1/hello.txt', 60)
  assert.equal(url.data.signedUrl, 'http://localhost:8788/files/p1%2Fhello.txt')
  await s.remove(['p1/hello.txt'])
  assert.notEqual((await s.download('p1/hello.txt')).error, null)
})

test('storage:key 不许跳出 files 目录', async () => {
  const r = await db.storage.from('pursuit-files').upload('../../etc/x', Buffer.from(''))
  assert.match(r.error.message, /key/)
})

test('auth.getUser 返回本机那个人', async () => {
  assert.deepEqual(await db.auth.getUser(), { data: { user: { id: UID, email: 'a@b.c' } }, error: null })
})
```

`pa_set_profile` 的参数名要看真实签名:`grep -A6 "function public.pa_set_profile" supabase/migrations/*.sql | tail -8`,按实际改 `p_name`。

- [ ] **Step 2: 跑,确认失败**

Run: `node --test brain/local/localdb.test.js 2>&1 | tail -3`
Expected: FAIL（`./localdb.js` 不存在）

- [ ] **Step 3: 实现**

```js
// brain/local/localdb.js —— 仿 supabase-js 表面的适配对象,底下是 PGlite。
//
// 只仿今天代码真用到的那一点(2026-09-16 实测):
//   .rpc(name, args)
//   .from(view).select().eq().in().order().limit().maybeSingle()   可 await
//   .storage.from(bucket).upload/download/remove/createSignedUrl
//   .auth.getUser()
// 返回形状跟 supabase-js 一样:{ data, error },绝不抛。
// 不做通用 PostgREST。多一个方法就多一处要对拍的地方。
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs'
import { join, normalize, resolve } from 'node:path'

const ok = (data) => ({ data, error: null })
const bad = (message) => ({ data: null, error: { message } })
const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const COLS = /^[a-zA-Z0-9_,\s*]+$/

// PostgREST 对返回值的整形规矩:
//   setof 标量 → [v, v]      setof 复合/table → [{}, {}]
//   标量 → v                  json/jsonb → 解析后的值(PGlite 已解析)
//   void → null
function shape(fn, rows) {
  if (fn.rettype === 'void') return null
  if (fn.retset) return fn.scalar ? rows.map((r) => Object.values(r)[0]) : rows
  if (!rows.length) return null
  return fn.scalar ? Object.values(rows[0])[0] : rows[0]
}

async function loadFunctions(pg) {
  const { rows } = await pg.query(`
    select p.proname as name, p.proretset as retset, t.typname as rettype, t.typtype as typtype,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype
     where n.nspname = 'public' and p.proname like 'pa\\_%'`)
  const byName = new Map()
  for (const r of rows) {
    // "p_a uuid, p_b text" → [{name, type}];identity arguments 不含默认值,正好
    const args = r.args ? r.args.split(', ').map((s) => { const i = s.lastIndexOf(' '); return { name: s.slice(0, i), type: s.slice(i + 1) } }) : []
    // 标量 = 非复合、非 record、非 void。json/jsonb 也算标量(一格值)
    const scalar = r.typtype !== 'c' && r.rettype !== 'record' && r.rettype !== 'void'
    if (!byName.has(r.name)) byName.set(r.name, [])
    byName.get(r.name).push({ name: r.name, args, retset: r.retset, rettype: r.rettype, scalar })
  }
  return byName
}

function pickOverload(cands, given) {
  const keys = Object.keys(given)
  // 参数名能盖住调用方给的全部键的那个;多个就取参数最少的
  const fit = cands.filter((f) => keys.every((k) => f.args.some((a) => a.name === k)))
  return fit.sort((a, b) => a.args.length - b.args.length)[0] || null
}

class FromBuilder {
  constructor(pg, view) { this.pg = pg; this.view = view; this.cols = '*'; this.filters = []; this.orders = []; this.lim = null; this.single = false; this.err = null }
  select(cols = '*') { if (!COLS.test(cols)) this.err = `列名只许字母数字下划线逗号空格:${cols}`; else this.cols = cols; return this }
  eq(col, v) { if (!IDENT.test(col)) this.err = `列名不合法:${col}`; this.filters.push({ op: 'eq', col, v }); return this }
  in(col, arr) { if (!IDENT.test(col)) this.err = `列名不合法:${col}`; this.filters.push({ op: 'in', col, v: arr }); return this }
  order(col, { ascending = true } = {}) { if (!IDENT.test(col)) this.err = `列名不合法:${col}`; this.orders.push({ col, ascending }); return this }
  limit(n) { this.lim = Number(n); return this }
  maybeSingle() { this.single = true; return this }
  toSQL() {
    const values = []
    const where = this.filters.map((f) => { values.push(f.v); return f.op === 'eq' ? `${f.col} = $${values.length}` : `${f.col} = any($${values.length})` })
    let text = `select ${this.cols} from public.${this.view}`
    if (where.length) text += ` where ${where.join(' and ')}`
    if (this.orders.length) text += ` order by ${this.orders.map((o) => `${o.col} ${o.ascending ? 'asc' : 'desc'}`).join(', ')}`
    if (this.lim != null) text += ` limit ${this.lim}`
    return { text, values }
  }
  async run() {
    if (this.err) return bad(this.err)
    if (!IDENT.test(this.view)) return bad(`视图名不合法:${this.view}`)
    try {
      const { text, values } = this.toSQL()
      const { rows } = await this.pg.query(text, values)
      return ok(this.single ? (rows[0] ?? null) : rows)
    } catch (e) { return bad(e.message) }
  }
  then(res, rej) { return this.run().then(res, rej) }
}

function makeStorage(dataDir, brainUrl) {
  const root = resolve(dataDir, 'files')
  mkdirSync(root, { recursive: true })
  const pathOf = (key) => {
    const p = resolve(root, normalize(key))
    if (!p.startsWith(root + '/')) throw new Error(`key 不合法:${key}`)
    return p
  }
  return {
    from() {
      return {
        async upload(key, bytes, { contentType } = {}) {
          try { const p = pathOf(key); mkdirSync(join(p, '..'), { recursive: true })
            writeFileSync(p, Buffer.isBuffer(bytes) ? bytes : Buffer.from(await new Response(bytes).arrayBuffer()))
            if (contentType) writeFileSync(p + '.type', contentType)
            return ok({ path: key }) } catch (e) { return bad(e.message) }
        },
        async download(key) {
          try { const p = pathOf(key); if (!existsSync(p)) return bad(`没有这个文件:${key}`)
            const buf = readFileSync(p); return ok({ arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), size: buf.length }) } catch (e) { return bad(e.message) }
        },
        async remove(keys) {
          try { for (const k of keys) { const p = pathOf(k); if (existsSync(p)) unlinkSync(p); if (existsSync(p + '.type')) unlinkSync(p + '.type') } return ok(keys) } catch (e) { return bad(e.message) }
        },
        async createSignedUrl(key) {
          try { pathOf(key); return ok({ signedUrl: `${brainUrl}/files/${encodeURIComponent(key)}` }) } catch (e) { return bad(e.message) }
        },
        contentTypeOf(key) { const p = pathOf(key) + '.type'; return existsSync(p) ? readFileSync(p, 'utf8') : 'application/octet-stream' },
      }
    },
  }
}

/**
 * @param {object} o
 * @param {import('@electric-sql/pglite').PGlite} o.pg
 * @param {string} o.dataDir   数据目录(files/ 在它底下)
 * @param {{id:string,email:string}} o.user  本机那个人
 * @param {string} [o.brainUrl]  签名 URL 的前缀
 */
export async function makeLocalDb({ pg, dataDir, user, brainUrl = 'http://localhost:8788' }) {
  let fns = await loadFunctions(pg)
  const db = {
    mode: 'local',
    async refreshFunctions() { fns = await loadFunctions(pg) },
    async rpc(name, args = {}) {
      const cands = fns.get(name)
      if (!cands) return bad(`没有这个函数:${name}`)
      const fn = pickOverload(cands, args)
      if (!fn) return bad(`${name} 的参数对不上:${Object.keys(args).join(',')}`)
      const values = []
      const named = fn.args.filter((a) => a.name in args).map((a) => { values.push(args[a.name]); return `${a.name} => $${values.length}::${a.type}` })
      try {
        const { rows } = await pg.query(`select * from public.${name}(${named.join(', ')})`, values)
        return ok(shape(fn, rows))
      } catch (e) { return bad(`${name}:${e.message}`) }
    },
    from(view) { return new FromBuilder(pg, view) },
    storage: makeStorage(dataDir, brainUrl),
    auth: { async getUser() { return ok({ user: { id: user.id, email: user.email } }) } },
  }
  return db
}
```

注意 `select * from f(...)` 对标量函数返回一列、列名 = 函数名——`shape()` 用 `Object.values(r)[0]` 取,不依赖列名。

- [ ] **Step 4: 跑测试**

Run: `node --test brain/local/localdb.test.js 2>&1 | tail -12`
Expected: 8 pass。

若 `pa_t_json` 那条失败、data 是字符串:PGlite 版本没把 jsonb 解析——在 `shape()` 里对 `rettype` 为 `json`/`jsonb` 的值 `JSON.parse`(字符串时)。
若 `pa_set_profile` 报参数对不上:看 Step 1 的 grep,按真实签名改测试。

- [ ] **Step 5: 提交**

```bash
git add brain/local && git commit -m "本地适配对象：仿 supabase-js 的那一点表面，底下是 PGlite

rpc 按 pg_proc 查签名、显式转型、按 PostgREST 规矩整形；from 只认
select/eq/in/order/limit/maybeSingle；storage 落 <数据目录>/files。"
```

### Task 6: `settings.json` 与 `dbauth` 第三模

**Files:**
- Create: `brain/local/settings.js`、`brain/local/settings.test.js`
- Modify: `brain/dbauth.js`

**Interfaces:**
- Produces:
  - `loadSettings(dataDir) → { uid, email, apiKey, model, modelCheap, backupDir, ready }`（文件不存在 → `ready:false`,`uid` 当场生成并写盘）
  - `saveSettings(dataDir, patch) → settings`
  - `makeDb()` 第三模:`process.env.FAIRWIND_DATA_DIR` 存在且没有云端 key → `{ db, mode: 'local', pg, settings }`（**异步**——所以签名变成 `await makeDb()`;两处调用点跟着改）

- [ ] **Step 1: settings 测试**

```js
// brain/local/settings.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSettings, saveSettings } from './settings.js'

test('没文件:生成 uid、ready=false、写盘', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fw-settings-'))
  const s = loadSettings(dir)
  assert.match(s.uid, /^[0-9a-f-]{36}$/); assert.equal(s.ready, false)
  assert.equal(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).uid, s.uid)
  rmSync(dir, { recursive: true, force: true })
})

test('save 合并、ready 由 email+apiKey 决定、uid 不变', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fw-settings-'))
  const a = loadSettings(dir)
  const b = saveSettings(dir, { email: 'a@b.c' })
  assert.equal(b.ready, false)
  const c = saveSettings(dir, { apiKey: 'sk-ant-x' })
  assert.equal(c.ready, true); assert.equal(c.uid, a.uid); assert.equal(c.email, 'a@b.c')
  rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 2: 跑,确认失败** — Run: `node --test brain/local/settings.test.js 2>&1 | tail -3`

- [ ] **Step 3: 实现 settings.js**

```js
// brain/local/settings.js —— <数据目录>/settings.json:本机那个人是谁、key、模型档位、备份目录。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const FILE = (dir) => join(dir, 'settings.json')
const withReady = (s) => ({ ...s, ready: Boolean(s.email && s.apiKey) })

export function loadSettings(dataDir) {
  mkdirSync(dataDir, { recursive: true })
  if (!existsSync(FILE(dataDir))) {
    const fresh = { uid: randomUUID(), email: '', apiKey: '', model: '', modelCheap: '', backupDir: '' }
    writeFileSync(FILE(dataDir), JSON.stringify(fresh, null, 2))
    return withReady(fresh)
  }
  return withReady(JSON.parse(readFileSync(FILE(dataDir), 'utf8')))
}

export function saveSettings(dataDir, patch) {
  const cur = loadSettings(dataDir)
  const { ready, ...rest } = { ...cur, ...patch }   // ready 是算出来的,不落盘
  writeFileSync(FILE(dataDir), JSON.stringify(rest, null, 2))
  return withReady(rest)
}
```

- [ ] **Step 4: 跑测试** — Expected: 2 pass

- [ ] **Step 5: dbauth 第三模**

把 `brain/dbauth.js` 的 `makeDb` 改成异步并加分支。文件顶部注释补一段 `local` 的说明;函数体:

```js
import { openLocalDb, applyMigrations, setLocalUid, registerLocalUser } from './local/migrate.js'
import { makeLocalDb } from './local/localdb.js'
import { loadSettings } from './local/settings.js'

/** 建客户端。mode: 'service'(老路)| 'user'(学员路)| 'local'(本机库)。配置不对就抛,话说清楚。 */
export async function makeDb() {
  const url = process.env.SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anon = process.env.SUPABASE_ANON_KEY
  const dataDir = process.env.FAIRWIND_DATA_DIR

  if (url && service) return { db: createClient(url, service, { auth: { persistSession: false } }), mode: 'service' }
  if (url && anon) {
    const db = createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true, storage: fileStorage, storageKey: 'fairwind' } })
    return { db, mode: 'user' }
  }
  if (dataDir) {
    // 本机库:没有任何云端钥匙。数据、附件、设置都在 dataDir 底下。
    const settings = loadSettings(dataDir)
    const pg = await openLocalDb(dataDir)
    await applyMigrations(pg, { fresh: true, log: (s) => console.log(s) })
    await setLocalUid(pg, settings.uid)
    if (settings.email) await registerLocalUser(pg, { id: settings.uid, email: settings.email })
    const db = await makeLocalDb({ pg, dataDir, user: { id: settings.uid, email: settings.email },
      brainUrl: `http://localhost:${process.env.BRAIN_PORT || 8788}` })
    return { db, mode: 'local', pg, settings }
  }
  throw new Error('brain/.env 里要么填 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY(个人版),' +
                  '要么填 SUPABASE_URL + SUPABASE_ANON_KEY 再跑 npm run db:login(云端学员),' +
                  '要么设 FAIRWIND_DATA_DIR(本机库)')
}
```

两处调用点:`brain/server.js:67` 的 `({ db, mode: DB_MODE } = makeDb())` → `= await makeDb()`(它本来就在顶层 try 里,可以 await——Task 7 会把整个启动搬进 `main()`);`brain/mail/store.js` 的 `db()` 是同步的,改成:

```js
let _db = null
export function db() {
  if (!_db) throw new Error('store.db() 在 initStore() 之前被调了')
  return _db
}
export async function initStore(dbHandle) { _db = dbHandle }
```
并在 `server.js` 拿到 `db` 之后调 `await initStore(db)`。`mail/*-run.js` 那几个 CLI 脚本各自开头加 `await initStore((await makeDb()).db)`。

- [ ] **Step 6: 云端模式不受影响**

Run: `cd brain && node --env-file=.env -e "import('./dbauth.js').then(async m => { const r = await m.makeDb(); console.log(r.mode) })"; cd ..`
Expected: 打印 `service`（作者的 `brain/.env` 有 service key 时）——若 `brain/.env` 是空的(worktree 里就是空的),用根 `.env` 的 dev anon:`SUPABASE_URL=$DEV_SUPABASE_URL SUPABASE_ANON_KEY=$DEV_SUPABASE_ANON_KEY node -e …` 应打印 `user`。

Run: `FAIRWIND_DATA_DIR=/tmp/fw-test node -e "import('./brain/dbauth.js').then(async m => { const r = await m.makeDb(); console.log(r.mode, (await r.db.from('v_pa_profile').select('*')).data.length) })"`
Expected: `local 0`（还没注册,profile 空）

- [ ] **Step 7: 全量测试 + 提交**

Run: `npm test 2>&1 | tail -5`
```bash
git add brain/dbauth.js brain/local brain/mail/store.js brain/mail/*-run.js && git commit -m "dbauth 第三模：FAIRWIND_DATA_DIR 在就开本机库，settings.json 记本机那个人

makeDb 变异步（本机模式要开库跑迁移）；mail/store 改成显式 initStore。"
```

### Task 7: brain 接本地路由、启动改 `main()`、服务 `dist/`

**Files:**
- Create: `brain/local/routes.js`、`brain/local/routes.test.js`
- Modify: `brain/server.js`（启动段、请求分发开头、listen 段）

**Interfaces:**
- Consumes: `makeDb()`（异步）、`makeLocalDb` 的 `db`、`saveSettings`
- Produces: `handleLocalRoute(req, res, ctx) → Promise<boolean>`（处理了返回 true）,ctx = `{ db, mode, pg, dataDir, settings, distDir, onSetup }`
  - `POST /db/rpc/:name`  body = args → `{ data, error }`
  - `POST /db/from`  body = `{ view, select, filters:[[op,col,v]], order:[{col,ascending}], limit, single }` → `{ data, error }`
  - `GET /files/:key` `PUT /files/:key`(body 字节,`content-type` 头) `DELETE /files/:key`
  - `GET /me` → `{ mode, ready, user:{id,email}|null }`
  - `POST /setup` body `{ email, apiKey, model, modelCheap, backupDir }` → `{ ok, ready }`(写 settings、注册用户、设 env)
  - `GET /` 与静态文件:本地模式且 `distDir` 存在时从 `dist/` 出

- [ ] **Step 1: 测试(用假的 req/res)**

```js
// brain/local/routes.test.js
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { openLocalDb, applyMigrations, setLocalUid } from './migrate.js'
import { makeLocalDb } from './localdb.js'
import { saveSettings } from './settings.js'
import { handleLocalRoute } from './routes.js'

const UID = '11111111-1111-4111-8111-111111111111'
let dir, pg, ctx
const req = (method, url, body, headers = {}) => Object.assign(Readable.from(body == null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]), { method, url, headers: { 'content-type': 'application/json', ...headers } })
const res = () => { const r = { code: 0, headers: {}, chunks: [] }; r.writeHead = (c, h) => { r.code = c; Object.assign(r.headers, h || {}); return r }; r.setHeader = (k, v) => { r.headers[k] = v }; r.end = (b) => { if (b) r.chunks.push(Buffer.from(b)); r.done = true }; r.write = (b) => r.chunks.push(Buffer.from(b)); r.json = () => JSON.parse(Buffer.concat(r.chunks).toString()); r.text = () => Buffer.concat(r.chunks).toString(); return r }

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fw-routes-'))
  pg = await openLocalDb(dir); await applyMigrations(pg, { fresh: true }); await setLocalUid(pg, UID)
  const settings = saveSettings(dir, { uid: UID })   // settings.json 里的 uid 要跟 set_config 的一致
  const db = await makeLocalDb({ pg, dataDir: dir, user: { id: UID, email: '' } })
  mkdirSync(join(dir, 'dist')); writeFileSync(join(dir, 'dist', 'index.html'), '<h1>hi</h1>')
  ctx = { db, pg, mode: 'local', dataDir: dir, settings, distDir: join(dir, 'dist'), onSetup: async () => {} }
})
after(async () => { await pg.close(); rmSync(dir, { recursive: true, force: true }) })

test('/me:未初始化 → ready:false', async () => {
  const r = res(); assert.equal(await handleLocalRoute(req('GET', '/me'), r, ctx), true)
  assert.deepEqual(r.json(), { mode: 'local', ready: false, user: null })
})

test('/setup 写 settings、注册用户,之后 /me ready:true', async () => {
  const r = res()
  await handleLocalRoute(req('POST', '/setup', { email: 'a@b.c', apiKey: 'sk-ant-1', backupDir: '' }), r, ctx)
  assert.equal(r.json().ready, true)
  const m = res(); await handleLocalRoute(req('GET', '/me'), m, ctx)
  assert.deepEqual(m.json().user, { id: UID, email: 'a@b.c' })
  const p = await pg.query('select count(*)::int as n from producer.profile'); assert.equal(p.rows[0].n, 1)
})

test('/db/rpc 和 /db/from 原样转发', async () => {
  const w = res(); await handleLocalRoute(req('POST', '/db/rpc/pa_set_profile', { p_name: 'X' }), w, ctx)
  assert.equal(w.json().error, null)
  const r = res(); await handleLocalRoute(req('POST', '/db/from', { view: 'v_pa_profile', select: '*', filters: [], order: [], limit: null, single: 'maybe' }), r, ctx)
  assert.equal(r.json().data.name, 'X')
})

test('/files PUT → GET → DELETE,带 content-type', async () => {
  const k = encodeURIComponent('p1/a.txt')
  const w = res(); await handleLocalRoute(req('PUT', `/files/${k}`, Buffer.from('hey'), { 'content-type': 'text/plain' }), w, ctx); assert.equal(w.code, 200)
  const g = res(); await handleLocalRoute(req('GET', `/files/${k}`), g, ctx); assert.equal(g.text(), 'hey'); assert.equal(g.headers['content-type'], 'text/plain')
  const d = res(); await handleLocalRoute(req('DELETE', `/files/${k}`), d, ctx); assert.equal(d.code, 200)
  const g2 = res(); await handleLocalRoute(req('GET', `/files/${k}`), g2, ctx); assert.equal(g2.code, 404)
})

test('GET / 从 dist 出', async () => {
  const r = res(); assert.equal(await handleLocalRoute(req('GET', '/'), r, ctx), true); assert.equal(r.text(), '<h1>hi</h1>')
})

test('不是本地模式:/db/* 不处理', async () => {
  const r = res(); assert.equal(await handleLocalRoute(req('POST', '/db/rpc/x', {}), r, { ...ctx, mode: 'service' }), false)
})
```

- [ ] **Step 2: 跑,确认失败** — Run: `node --test brain/local/routes.test.js 2>&1 | tail -3`

- [ ] **Step 3: 实现 routes.js**

```js
// brain/local/routes.js —— 本机模式下 brain 多出来的几条路:前端借它碰库、碰文件、问「我是谁」,
// 以及首次启动的 /setup。云端模式下这个文件什么都不做(前端直连 Supabase)。
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, normalize, resolve, extname } from 'node:path'
import { saveSettings } from './settings.js'
import { registerLocalUser } from './migrate.js'

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
const readAll = (req) => new Promise((ok, no) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); req.on('error', no) })
const readJson = async (req) => { const b = await readAll(req); return b.length ? JSON.parse(b.toString()) : {} }

/** 处理了返回 true;不是这儿的事返回 false,交给 server.js 原来的分发。 */
export async function handleLocalRoute(req, res, ctx) {
  if (ctx.mode !== 'local') return false
  const { db, dataDir, distDir } = ctx
  const url = new URL(req.url, 'http://localhost')
  const p = url.pathname

  if (req.method === 'GET' && p === '/me') {
    const s = ctx.settings
    return json(res, 200, { mode: 'local', ready: Boolean(s.ready), user: s.ready ? { id: s.uid, email: s.email } : null }), true
  }

  if (req.method === 'POST' && p === '/setup') {
    const body = await readJson(req)
    const s = saveSettings(dataDir, { email: body.email || '', apiKey: body.apiKey || '', model: body.model || '', modelCheap: body.modelCheap || '', backupDir: body.backupDir || '' })
    ctx.settings = s
    if (s.email) await registerLocalUser(ctx.pg, { id: s.uid, email: s.email })
    if (s.apiKey) process.env.ANTHROPIC_API_KEY = s.apiKey          // SDK 起子进程时读的是 process.env
    await ctx.onSetup?.(s)
    return json(res, 200, { ok: true, ready: s.ready }), true
  }

  if (req.method === 'POST' && p.startsWith('/db/rpc/')) {
    const name = p.slice('/db/rpc/'.length)
    return json(res, 200, await db.rpc(name, await readJson(req))), true
  }

  if (req.method === 'POST' && p === '/db/from') {
    const q = await readJson(req)
    let b = db.from(q.view).select(q.select || '*')
    for (const [op, col, v] of q.filters || []) b = op === 'in' ? b.in(col, v) : b.eq(col, v)
    for (const o of q.order || []) b = b.order(o.col, { ascending: o.ascending !== false })
    if (q.limit != null) b = b.limit(q.limit)
    if (q.single === 'maybe') b = b.maybeSingle()
    return json(res, 200, await b), true
  }

  if (p.startsWith('/files/')) {
    const key = decodeURIComponent(p.slice('/files/'.length))
    const s = db.storage.from('pursuit-files')
    if (req.method === 'PUT') {
      const r = await s.upload(key, await readAll(req), { contentType: req.headers['content-type'] })
      return json(res, r.error ? 400 : 200, r), true
    }
    if (req.method === 'DELETE') { const r = await s.remove([key]); return json(res, r.error ? 400 : 200, r), true }
    if (req.method === 'GET') {
      const r = await s.download(key)
      if (r.error) return json(res, 404, r), true
      res.writeHead(200, { 'content-type': s.contentTypeOf(key) }); res.end(Buffer.from(await r.data.arrayBuffer())); return true
    }
  }

  // 静态:dist/ 里的文件;找不到的路径回 index.html(前端自己按 ?a= 路由)
  if (req.method === 'GET' && distDir && existsSync(distDir)) {
    const rel = p === '/' ? 'index.html' : normalize(p).replace(/^\/+/, '')
    let f = resolve(distDir, rel)
    if (!f.startsWith(resolve(distDir))) return false
    if (!existsSync(f) || statSync(f).isDirectory()) f = join(distDir, 'index.html')
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f)); return true
  }
  return false
}
```

- [ ] **Step 4: 跑测试** — Expected: 6 pass

- [ ] **Step 5: server.js 接进去 + 启动改 main()**

三处改动,都在 `brain/server.js`:

(a) 顶部 import 加 `import { handleLocalRoute } from './local/routes.js'`,以及 `import { initStore } from './mail/store.js'`。

(b) 启动段(原 65–74 行)改成:

```js
let db, DB_MODE, LOCAL = null
async function connect() {
  const r = await makeDb()
  db = r.db; DB_MODE = r.mode
  if (DB_MODE === 'user') {
    const u = await requireUser(db)
    console.log(`· 以 ${u.email} 的身份连库(行级权限生效)`)
  }
  if (DB_MODE === 'local') {
    LOCAL = { pg: r.pg, settings: r.settings, dataDir: process.env.FAIRWIND_DATA_DIR,
              distDir: process.env.FAIRWIND_DIST_DIR || new URL('../dist/', import.meta.url).pathname }
    if (r.settings.apiKey) process.env.ANTHROPIC_API_KEY = r.settings.apiKey
    console.log(`· 本机库:${LOCAL.dataDir}${r.settings.ready ? '' : '(还没初始化,等页面上填)'}`)
  }
  await initStore(db)
}
```

(c) 请求分发开头(`if (req.method === 'OPTIONS') …` 之后)插一行:
```js
  if (LOCAL && await handleLocalRoute(req, res, { db, mode: DB_MODE, ...LOCAL })) return
```
`handleLocalRoute` 里 `/setup` 改了 `ctx.settings`——而这里每次都是新对象,所以 `onSetup` 要把它写回:在 (b) 的 `LOCAL` 里加 `onSetup: async (s) => { LOCAL.settings = s }`。

(d) 文件最底:`server.listen(PORT, () => {…})` 整段包进
```js
async function main() {
  try { await connect() } catch (err) { console.error('\n✗ ' + err.message + '\n'); process.exit(1) }
  server.listen(PORT, () => { …原来那段… })
}
main()
```
并把顶层其它 `await`(若有)一并搬进 `main()`。**改完 `grep -n "^const .* = await\|^await" brain/server.js` 必须为空**——这是 bytenode 的硬约束(CJS 不能有顶层 await)。

listen 那段的计费那行改成按模式说话:`DB_MODE === 'local' && process.env.ANTHROPIC_API_KEY ? '走你自己的 API key' : '走你的 Claude 订阅用量(没用 API key)'`。

- [ ] **Step 6: 三种模式都起得来**

Run(云端 service,作者):`cd brain && npm start & sleep 4; curl -s localhost:8788/health | head -c 200; kill %1; cd ..`
Expected: 跟改之前一样的 `/health`。

Run(本机):`FAIRWIND_DATA_DIR=/tmp/fw-test npm --prefix brain start & sleep 6; curl -s localhost:8788/me; curl -s -X POST localhost:8788/db/from -H 'content-type: application/json' -d '{"view":"v_pa_profile","select":"*"}'; kill %1`
Expected: `{"mode":"local","ready":false,"user":null}` 和 `{"data":[],"error":null}`。

- [ ] **Step 7: 提交**

```bash
git add brain/server.js brain/local && git commit -m "brain 认本机模式：/me /setup /db/* /files/*，服务 dist/，启动搬进 main()

顶层没有 await 了——这是字节码那条路的硬约束。云端两种模式行为不变。"
```

### Task 8: 前端 `brainClient` + `backends.js` 选模

**Files:**
- Create: `src/lib/brainClient.js`、`src/lib/brainClient.test.js`
- Modify: `src/lib/backends.js`、`src/components/AuthGate.jsx`、`package.json`(脚本)

**Interfaces:**
- Produces: `brainClient(base) → 与 supabase-js 同表面的对象`（`.from().select().eq().in().order().limit().maybeSingle()` 可 await;`.rpc`;`.storage.from().upload/remove/createSignedUrl/download`;`.auth.getSession/getUser/onAuthStateChange/signOut`）
- `backends.js`:`VITE_DB_MODE === 'local'` → `supa = brainClient(BRAIN)`,`DB_CONFIGURED = true`,`DB_MODE = 'local'`

- [ ] **Step 1: 测试(mock fetch)**

```js
// src/lib/brainClient.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brainClient } from './brainClient.js'

const calls = []
const fakeFetch = (reply) => async (url, init = {}) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => reply, headers: { get: () => 'text/plain' }, arrayBuffer: async () => new ArrayBuffer(2) } }

test('from 链序列化成一个 POST /db/from', async () => {
  calls.length = 0
  const c = brainClient('http://b', fakeFetch({ data: [{ id: 1 }], error: null }))
  const r = await c.from('v_pa_entries').select('id, title').eq('kind', 'work').in('id', ['a']).order('title', { ascending: false }).limit(5)
  assert.equal(calls[0].url, 'http://b/db/from')
  assert.deepEqual(JSON.parse(calls[0].init.body), { view: 'v_pa_entries', select: 'id, title', filters: [['eq', 'kind', 'work'], ['in', 'id', ['a']]], order: [{ col: 'title', ascending: false }], limit: 5, single: null })
  assert.deepEqual(r, { data: [{ id: 1 }], error: null })
})

test('maybeSingle 带 single:"maybe"', async () => {
  calls.length = 0
  const c = brainClient('http://b', fakeFetch({ data: null, error: null }))
  await c.from('v_pa_profile').select('*').maybeSingle()
  assert.equal(JSON.parse(calls[0].init.body).single, 'maybe')
})

test('rpc → POST /db/rpc/<name>', async () => {
  calls.length = 0
  const c = brainClient('http://b', fakeFetch({ data: 6, error: null }))
  assert.deepEqual(await c.rpc('pa_x', { p_a: 1 }), { data: 6, error: null })
  assert.equal(calls[0].url, 'http://b/db/rpc/pa_x'); assert.deepEqual(JSON.parse(calls[0].init.body), { p_a: 1 })
})

test('网络炸了 → error 不抛', async () => {
  const c = brainClient('http://b', async () => { throw new Error('boom') })
  const r = await c.rpc('pa_x', {}); assert.equal(r.data, null); assert.match(r.error.message, /boom/)
})

test('auth:/me ready → 有会话;未 ready → null 但带 local 标记', async () => {
  const c1 = brainClient('http://b', fakeFetch({ mode: 'local', ready: true, user: { id: 'u', email: 'e' } }))
  const s1 = await c1.auth.getSession(); assert.equal(s1.data.session.user.id, 'u'); assert.equal(s1.data.session.local, true)
  const c2 = brainClient('http://b', fakeFetch({ mode: 'local', ready: false, user: null }))
  const s2 = await c2.auth.getSession(); assert.equal(s2.data.session, null); assert.equal(s2.data.local, true)
  const sub = c2.auth.onAuthStateChange(() => {}); assert.equal(typeof sub.data.subscription.unsubscribe, 'function')
})

test('storage:签名 URL 直接拼,不问网络', async () => {
  const c = brainClient('http://b', fakeFetch({}))
  assert.deepEqual(await c.storage.from('pursuit-files').createSignedUrl('a/b.txt', 60), { data: { signedUrl: 'http://b/files/a%2Fb.txt' }, error: null })
})
```

- [ ] **Step 2: 跑,确认失败** — Run: `node --test src/lib/brainClient.test.js 2>&1 | tail -3`

- [ ] **Step 3: 实现**

```js
// src/lib/brainClient.js —— 本机模式下前端的「supa」:同一个表面,底下是 fetch 到 brain。
// 只仿今天代码真用到的那一点(跟 brain/local/localdb.js 同一份清单)。21 个 import supa 的文件一个不改。
const ok = (data) => ({ data, error: null })
const bad = (message) => ({ data: null, error: { message } })

export function brainClient(base, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const post = async (path, body) => {
    try {
      const r = await fetchImpl(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      return await r.json()
    } catch (e) { return bad(e.message) }
  }

  class From {
    constructor(view) { this.q = { view, select: '*', filters: [], order: [], limit: null, single: null } }
    select(cols = '*') { this.q.select = cols; return this }
    eq(col, v) { this.q.filters.push(['eq', col, v]); return this }
    in(col, arr) { this.q.filters.push(['in', col, arr]); return this }
    order(col, { ascending = true } = {}) { this.q.order.push({ col, ascending }); return this }
    limit(n) { this.q.limit = n; return this }
    maybeSingle() { this.q.single = 'maybe'; return this }
    then(res, rej) { return post('/db/from', this.q).then(res, rej) }
  }

  let me = null
  const whoami = async () => {
    try { const r = await fetchImpl(`${base}/me`); me = await r.json() } catch { me = { ready: false, user: null } }
    return me
  }
  const sessionOf = (m) => (m.ready && m.user ? { user: m.user, local: true } : null)

  return {
    mode: 'local',
    from: (view) => new From(view),
    rpc: (name, args = {}) => post(`/db/rpc/${name}`, args),
    storage: {
      from() {
        return {
          async upload(key, file, { contentType } = {}) {
            try { const r = await fetchImpl(`${base}/files/${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'content-type': contentType || file?.type || 'application/octet-stream' }, body: file }); return await r.json() } catch (e) { return bad(e.message) }
          },
          async remove(keys) {
            try { for (const k of keys) await fetchImpl(`${base}/files/${encodeURIComponent(k)}`, { method: 'DELETE' }); return ok(keys) } catch (e) { return bad(e.message) }
          },
          async download(key) {
            try { const r = await fetchImpl(`${base}/files/${encodeURIComponent(key)}`); if (!r.ok) return bad(`没有这个文件:${key}`); const buf = await r.arrayBuffer(); return ok({ arrayBuffer: async () => buf }) } catch (e) { return bad(e.message) }
          },
          async createSignedUrl(key) { return ok({ signedUrl: `${base}/files/${encodeURIComponent(key)}` }) },
        }
      },
    },
    auth: {
      async getSession() { const m = await whoami(); return { data: { session: sessionOf(m), local: true }, error: null } },
      async getUser() { const m = await whoami(); return { data: { user: m.user }, error: null } },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } } },
      async signOut() { return { error: null } },
      async signInWithPassword() { return { data: null, error: { message: '本机模式没有登录这回事' } } },
      async signUp() { return { data: null, error: { message: '本机模式没有登录这回事' } } },
    },
    /** 首次启动页用 */
    setup: (body) => post('/setup', body),
    whoami,
  }
}
```

- [ ] **Step 4: 跑测试** — Expected: 6 pass

- [ ] **Step 5: backends.js 选模**

`src/lib/backends.js` 顶部那段改成:

```js
import { createClient } from '@supabase/supabase-js'
import { brainClient } from './brainClient.js'

const env = import.meta.env || {}
export const BRAIN = env.VITE_BRAIN_URL || (env.VITE_DB_MODE === 'local' && typeof location !== 'undefined' ? location.origin : 'http://localhost:8788')
export const DB_MODE = env.VITE_DB_MODE === 'local' ? 'local' : (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY ? 'cloud' : 'none')

// 本机模式:supa 是打到 brain 的客户端,同一个表面;云端模式:今天的样子,一个字不变
export const supa = DB_MODE === 'local' ? brainClient(BRAIN)
  : DB_MODE === 'cloud' ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY) : null
export const DB_CONFIGURED = !!supa
```
其余(`FELL_BACK`、`checkBrain`…)不动。本机模式下前端和 brain 同源(`location.origin`),开发时 vite 在 5173、brain 在 8788——所以 `npm run local` 要给 `VITE_BRAIN_URL=http://localhost:8788`。

- [ ] **Step 6: AuthGate:本机未初始化 → FirstRun**

`src/components/AuthGate.jsx` 的 `useEffect` 里 `setSession(data.session ?? null)` 改成 `setSession(data.session ?? (data.local ? 'first-run' : null))`,渲染段加一行:
```jsx
  if (session === 'first-run') return <FirstRun onDone={() => location.reload()} />
```
并 `import FirstRun from './FirstRun.jsx'`。`FirstRun` 在 Task 9 写;这一步先放一个占位组件文件让构建过:
```jsx
// src/components/FirstRun.jsx
export default function FirstRun() { return <div className="loading">首次启动…</div> }
```

- [ ] **Step 7: 脚本**

`package.json` scripts 加:
```json
"local": "FAIRWIND_DATA_DIR=${FAIRWIND_DATA_DIR:-$HOME/Library/Application Support/Fairwind} node scripts/local.mjs",
"build:local": "VITE_DB_MODE=local vite build"
```
`scripts/local.mjs`(抄 `scripts/fairwind.mjs`,两处不同):brain 用 `env: { ...process.env }`(继承 `FAIRWIND_DATA_DIR`),vite 用 `env: { ...process.env, VITE_DB_MODE: 'local', VITE_BRAIN_URL: 'http://localhost:8788' }`。

- [ ] **Step 8: 手工验收**

Run: `npm run local`(他会自己在终端起——照 memory,这里只给命令)
Expected: 浏览器开 5173,页面不弹登录,显示「首次启动…」占位;devtools 里 `/me` 返回 `ready:false`。

Run(云端不受影响): `npm run dev` → 跟改之前一样(登录页 / 种子数据)。

- [ ] **Step 9: 提交**

```bash
git add src/lib/brainClient.js src/lib/brainClient.test.js src/lib/backends.js src/components/AuthGate.jsx src/components/FirstRun.jsx scripts/local.mjs package.json && git commit -m "前端认本机模式：VITE_DB_MODE=local 时 supa 换成打到 brain 的客户端

同一个表面，21 个用 supa 的文件一个不改。AuthGate 在本机未初始化时进首次启动页。"
```

### Task 9: 首次启动页

**Files:**
- Modify: `src/components/FirstRun.jsx`(替换占位)
- Modify: `src/styles.css`(几行)

**Interfaces:**
- Consumes: `supa.setup(body)`(brainClient),`supa.whoami()`

- [ ] **Step 1: 写组件**

```jsx
// src/components/FirstRun.jsx —— 本机模式第一次打开:问三样,写进 brain 的 settings.json。
// 能不问就不问:库、Gmail 应用都出厂了;这儿只问属于这个人自己的东西。
import { useState } from 'react'
import { supa } from '../lib/backends.js'

export default function FirstRun({ onDone }) {
  const [email, setEmail] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [backupDir, setBackupDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    const r = await supa.setup({ email: email.trim(), apiKey: apiKey.trim(), backupDir: backupDir.trim() })
    setBusy(false)
    if (r.error) return setErr(r.error.message)
    if (!r.ready) return setErr('邮箱和 API key 都要填')
    onDone?.()
  }

  return (
    <div className="first-run">
      <form onSubmit={submit}>
        <h1>第一次打开</h1>
        <p>三样东西。都在你自己这台机器上,不上传。</p>
        <label>你的邮箱<small>只用来在这台机器上认出你</small>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
        <label>Anthropic API key<small>模型的钱走你自己的 key。去 console.anthropic.com 建一个(sk-ant- 开头)</small>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required /></label>
        <label>备份放哪个文件夹<small>选一个在 iCloud Drive 或 Google Drive 里的,备份就自动上了你自己的云。可以先空着</small>
          <input value={backupDir} onChange={(e) => setBackupDir(e.target.value)} placeholder="/Users/你/Library/Mobile Documents/com~apple~CloudDocs/Fairwind" /></label>
        {err && <p className="first-run-err">{err}</p>}
        <button disabled={busy}>{busy ? '写好了…' : '开始'}</button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: 样式**

`src/styles.css` 末尾加:
```css
.first-run { min-height: 100vh; display: grid; place-items: center; padding: 2rem; }
.first-run form { width: min(34rem, 100%); display: grid; gap: 1rem; }
.first-run label { display: grid; gap: .3rem; font-weight: 500; }
.first-run small { font-weight: 400; color: var(--ink-soft, #666); }
.first-run input { font: inherit; padding: .5rem .6rem; }
.first-run-err { color: var(--seal, #a83a2e); }
```

- [ ] **Step 3: 手工验收**

`npm run local` → 填三样 → 页面刷新进主界面(种子数据不该出现——`DB_CONFIGURED` 为真;库里空,档案页空着)→ 「我的档案」填名字 → 刷新还在。`~/Library/Application Support/Fairwind/settings.json` 里有邮箱和 key;`db/` 目录有文件。

Run: `npm test 2>&1 | tail -3 && npm run build:local 2>&1 | tail -2`

- [ ] **Step 4: 提交**

```bash
git add src/components/FirstRun.jsx src/styles.css && git commit -m "首次启动页：邮箱、API key、备份目录，三样写进本机 settings.json"
```

---

## ③ 模块门控

### Task 10: `brain/modules.js`——清单、依赖闭包、开关文件

**Files:**
- Create: `brain/modules.js`、`brain/modules.test.js`

**Interfaces:**
- Produces:
  - `MODULES = ['profile', 'pursuits', 'mail']`,`DEPS = { pursuits: ['profile'], mail: ['pursuits'] }`
  - `loadModules({ dataDir, mode }) → { profile, pursuits, mail, canToggle }`(云端模式:全 true、`canToggle:false`;本机:读 `modules.json`,缺省 `{profile:true, pursuits:false, mail:false}`)
  - `setModules({ dataDir, mode }, patch) → 同上`(开 X 自动开依赖;关 X 自动关依赖它的;`profile` 不能关;云端模式抛)
  - `moduleOf(url) → 'core' | 'profile' | 'pursuits' | 'mail'`(按路由前缀表)
  - `isEnabled(state, name) → boolean`

- [ ] **Step 1: 测试**

```js
// brain/modules.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadModules, setModules, moduleOf, isEnabled } from './modules.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'fw-modules-'))

test('云端模式:全开、不可切', () => {
  assert.deepEqual(loadModules({ dataDir: null, mode: 'service' }), { profile: true, pursuits: true, mail: true, canToggle: false })
  assert.throws(() => setModules({ dataDir: null, mode: 'user' }, { mail: false }), /云端/)
})

test('本机缺省只开档案层;写盘后能读回', () => {
  const dir = tmp()
  assert.deepEqual(loadModules({ dataDir: dir, mode: 'local' }), { profile: true, pursuits: false, mail: false, canToggle: true })
  setModules({ dataDir: dir, mode: 'local' }, { pursuits: true })
  assert.equal(loadModules({ dataDir: dir, mode: 'local' }).pursuits, true)
  rmSync(dir, { recursive: true, force: true })
})

test('开 mail 自动开 pursuits;关 pursuits 自动关 mail;profile 关不掉', () => {
  const dir = tmp()
  let s = setModules({ dataDir: dir, mode: 'local' }, { mail: true })
  assert.deepEqual([s.profile, s.pursuits, s.mail], [true, true, true])
  s = setModules({ dataDir: dir, mode: 'local' }, { pursuits: false })
  assert.deepEqual([s.profile, s.pursuits, s.mail], [true, false, false])
  s = setModules({ dataDir: dir, mode: 'local' }, { profile: false })
  assert.equal(s.profile, true)
  rmSync(dir, { recursive: true, force: true })
})

test('路由归属', () => {
  for (const [u, m] of [['/health', 'core'], ['/me', 'core'], ['/db/rpc/x', 'core'], ['/files/a', 'core'], ['/modules', 'core'], ['/setup', 'core'], ['/', 'core'],
    ['/chat', 'pursuits'], ['/chat/stream', 'pursuits'], ['/stage', 'pursuits'], ['/ball', 'pursuits'], ['/brief', 'pursuits'], ['/scout', 'pursuits'], ['/subjects/rejudge', 'pursuits'],
    ['/mail/sync', 'mail'], ['/mail/adopt', 'mail'], ['/mail/send', 'mail'], ['/gmail-draft', 'mail'], ['/sync', 'mail'], ['/refresh', 'mail'], ['/identify', 'mail'], ['/mailbox/carry', 'mail'], ['/letters/triage', 'mail'],
    ['/studio', 'profile'], ['/studio/stream', 'profile']]) assert.equal(moduleOf(u), m, u)
  assert.equal(isEnabled({ profile: true, pursuits: false, mail: false }, 'core'), true)
  assert.equal(isEnabled({ profile: true, pursuits: false, mail: false }, 'pursuits'), false)
})
```
路由清单以合并后 `grep -oE "req\.url === '[^']+'" brain/server.js | sort -u` 为准——上面 `/studio*` 是主线书桌的路由名,**按实际改**;有没列进来的路由,补进测试和 `moduleOf`。

- [ ] **Step 2: 跑,确认失败** — Run: `node --test brain/modules.test.js 2>&1 | tail -3`

- [ ] **Step 3: 实现**

```js
// brain/modules.js —— 模块是能力开关,不是 schema 分区(设计稿 D5):表全建,路由/定时器/工具/界面按开关门控。
//
//   profile   档案、作品、语气、书桌
//   pursuits  机会线、人、时间线、状态机、写信稿、scout      ← 要 profile
//   mail      Gmail、归线归人、分诊、陌生人                    ← 要 pursuits
//
// 云端模式(作者)永远全开——功能只增不减。本机模式读 <数据目录>/modules.json,缺省只开档案层。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const MODULES = ['profile', 'pursuits', 'mail']
export const DEPS = { profile: [], pursuits: ['profile'], mail: ['pursuits'] }
const DEFAULT = { profile: true, pursuits: false, mail: false }
const FILE = (dir) => join(dir, 'modules.json')

export function loadModules({ dataDir, mode }) {
  if (mode !== 'local') return { profile: true, pursuits: true, mail: true, canToggle: false }
  const s = existsSync(FILE(dataDir)) ? { ...DEFAULT, ...JSON.parse(readFileSync(FILE(dataDir), 'utf8')) } : { ...DEFAULT }
  return { ...s, profile: true, canToggle: true }
}

export function setModules({ dataDir, mode }, patch) {
  if (mode !== 'local') throw new Error('云端模式下模块永远全开,改不了')
  const s = loadModules({ dataDir, mode })
  for (const [name, on] of Object.entries(patch)) {
    if (!MODULES.includes(name)) continue
    if (on) { s[name] = true; for (const d of DEPS[name]) s[d] = true }                 // 开 X 先开它要的
    else { s[name] = true; for (const m of MODULES) if (DEPS[m].includes(name)) s[m] = false; s[name] = false }  // 关 X 先关要它的
  }
  s.profile = true
  const { canToggle, ...disk } = s
  writeFileSync(FILE(dataDir), JSON.stringify(disk, null, 2))
  return s
}

// 路由归属。前缀匹配,长的先;没列的一律算 pursuits(主区的活)——宁可多关,不可漏开。
const ROUTE_MODULE = [
  ['/health', 'core'], ['/me', 'core'], ['/setup', 'core'], ['/modules', 'core'], ['/db/', 'core'], ['/files/', 'core'],
  ['/studio', 'profile'],
  ['/mail/', 'mail'], ['/gmail-draft', 'mail'], ['/sync', 'mail'], ['/refresh', 'mail'], ['/identify', 'mail'], ['/mailbox/', 'mail'], ['/letters/', 'mail'],
]
export function moduleOf(url) {
  const p = url.split('?')[0]
  if (p === '/' || /\.[a-z0-9]+$/i.test(p)) return 'core'        // 静态文件
  for (const [prefix, m] of ROUTE_MODULE) if (p === prefix || p.startsWith(prefix) || p.startsWith(prefix + '/')) return m
  return 'pursuits'
}

export const isEnabled = (state, name) => name === 'core' || Boolean(state[name])
```

- [ ] **Step 4: 跑测试** — Expected: 4 pass(路由那条按实际路由名调整)

- [ ] **Step 5: 提交**

```bash
git add brain/modules.js brain/modules.test.js && git commit -m "模块清单：三个能力开关、依赖闭包、路由归属；云端永远全开"
```

### Task 11: brain 按模块门控——路由、定时器、工具;`/modules` 读写

**Files:**
- Modify: `brain/server.js`

**Interfaces:**
- Consumes: `loadModules` `setModules` `moduleOf` `isEnabled`
- Produces: `GET /modules → { profile, pursuits, mail, canToggle }`;`POST /modules { name: bool } → 同上`;关着的模块的路由 → `404 { error: 'module off', module }`

- [ ] **Step 1: 状态与路由门**

`server.js` 顶部 import `{ loadModules, setModules, moduleOf, isEnabled } from './modules.js'`。`connect()` 末尾:
```js
  MODS = loadModules({ dataDir: LOCAL?.dataDir, mode: DB_MODE })
```
(`let MODS` 与 `db` 同处声明。)请求分发里,紧接 `handleLocalRoute` 那行之后:
```js
  if (req.method === 'GET' && req.url === '/modules') return send(res, 200, MODS)
  if (req.method === 'POST' && req.url === '/modules') {
    try { MODS = setModules({ dataDir: LOCAL?.dataDir, mode: DB_MODE }, await readJson(req)); applyTimers(); return send(res, 200, MODS) }
    catch (e) { return send(res, 400, { error: e.message }) }
  }
  const mod = moduleOf(req.url)
  if (!isEnabled(MODS, mod)) return send(res, 404, { error: 'module off', module: mod })
```
`readJson` 用 server.js 里已有的读 body 辅助(找 `/chat` 那条怎么读 body,用同一个)。

- [ ] **Step 2: 定时器门**

listen 回调里三处 `setInterval`(`sweepBriefs`、`mailLoop`、`scoutPass`)改成由一个 `applyTimers()` 管:
```js
const timers = {}
function applyTimers() {
  const want = { sweepBriefs: isEnabled(MODS, 'pursuits'), scoutPass: isEnabled(MODS, 'pursuits'), mailLoop: isEnabled(MODS, 'mail') }
  const every = { sweepBriefs: SWEEP_MS, scoutPass: SCOUT_MS, mailLoop: MAIL_MS }
  const fns = { sweepBriefs, scoutPass, mailLoop }
  for (const k of Object.keys(want)) {
    if (want[k] && !timers[k]) { fns[k](); timers[k] = setInterval(fns[k], every[k]); console.log(`   ⏱ ${k} 开`) }
    if (!want[k] && timers[k]) { clearInterval(timers[k]); delete timers[k]; console.log(`   ⏱ ${k} 关`) }
  }
}
```
`mailLoop` 原来是 listen 回调里的 `const`——提到模块作用域。listen 回调里只留 `applyTimers()`。

- [ ] **Step 3: 工具门**

找 `GMAIL_TOOLS` 被传进 `think()` 的几处(`grep -n GMAIL_TOOLS brain/server.js`),每处改成 `isEnabled(MODS, 'mail') ? GMAIL_TOOLS : []`。这些路由本来就在 mail 模块下会被 404,加这一道是为了聊天(`/chat`,pursuits)里的 Gmail 工具在 mail 关着时不出现。

- [ ] **Step 4: 验证**

Run(本机,缺省只开 profile): `FAIRWIND_DATA_DIR=/tmp/fw-test npm --prefix brain start & sleep 6; curl -s localhost:8788/modules; curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8788/chat -d '{}' ; curl -s -X POST localhost:8788/modules -H 'content-type: application/json' -d '{"mail":true}'; curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8788/chat -d '{}'; kill %1`
Expected: `{"profile":true,"pursuits":false,"mail":false,"canToggle":true}`;`404`;`{"profile":true,"pursuits":true,"mail":true,…}`;不再 404(`400`/`200` 都行);日志里出现 `⏱ sweepBriefs 开` `⏱ mailLoop 开`。

Run(云端): `cd brain && npm start & sleep 4; curl -s localhost:8788/modules; kill %1; cd ..`
Expected: 全 true、`canToggle:false`;三个定时器日志都「开」。

- [ ] **Step 5: 提交**

```bash
git add brain/server.js && git commit -m "brain 按模块门控：关着的模块路由 404、定时器不起、Gmail 工具不进白名单

/modules 读写；开关改了定时器当场跟着变，不用重启。云端模式全开不变。"
```

### Task 12: 前端按模块门控 + 设置里的开关

**Files:**
- Create: `src/lib/modules.js`、`src/lib/ModulesContext.jsx`、`src/components/ModulesPanel.jsx`
- Modify: `src/App.jsx`(AREAS 过滤、profile 区挂 ModulesPanel)、`src/components/PersonFocus.jsx` `People.jsx` `Dossier.jsx` `Deliverables.jsx`(邮件界面门控)、`src/lib/route.js`(缺省区)

**Interfaces:**
- Produces: `useModules() → { profile, pursuits, mail, canToggle, set(patch) }`;`ModulesProvider`

- [ ] **Step 1: 读 /modules 的小库(可测)**

```js
// src/lib/modules.js
import { BRAIN } from './backends.js'
export async function fetchModules(fetchImpl = fetch) {
  try { const r = await fetchImpl(`${BRAIN}/modules`); return await r.json() }
  catch { return { profile: true, pursuits: true, mail: true, canToggle: false } }   // brain 没醒:按全开画,跟今天一样
}
export async function postModules(patch, fetchImpl = fetch) {
  const r = await fetchImpl(`${BRAIN}/modules`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
  return r.json()
}
/** 给定开关,哪些主区能进 */
export function allowedAreas(mods) {
  return ['desk', 'pursue', 'people', 'ledger'].filter(() => mods.pursuits).concat(['profile'])
}
```
测试 `src/lib/modules.test.js`:`allowedAreas({pursuits:false})` 只剩 `['profile']`;`{pursuits:true}` 五个都在;`fetchModules` 炸了回全开。

- [ ] **Step 2: Context**

```jsx
// src/lib/ModulesContext.jsx
import { createContext, useContext, useEffect, useState } from 'react'
import { fetchModules, postModules } from './modules.js'
const Ctx = createContext({ profile: true, pursuits: true, mail: true, canToggle: false, set: async () => {} })
export function ModulesProvider({ children }) {
  const [mods, setMods] = useState(null)
  useEffect(() => { fetchModules().then(setMods) }, [])
  if (!mods) return <div className="loading">…</div>
  const set = async (patch) => setMods(await postModules(patch))
  return <Ctx.Provider value={{ ...mods, set }}>{children}</Ctx.Provider>
}
export const useModules = () => useContext(Ctx)
```
`src/main.jsx` 里 `<AuthGate><ModulesProvider><App/></ModulesProvider></AuthGate>`。

- [ ] **Step 3: App.jsx**

- `const mods = useModules()`;渲染主区按钮处 `AREAS.filter(([k]) => allowedAreas(mods).includes(k))`。
- 初始 `area` 若不在允许里 → `'profile'`(`useEffect` 里纠正一次)。
- `area === 'profile'` 那个分支里,在档案内容下面加 `{mods.canToggle && <ModulesPanel />}`。
- 通知栏(`Notifications`)、`QueueRest` 等只有 pursuits 才有意义的顶栏元素,包在 `mods.pursuits &&` 里。

- [ ] **Step 4: 邮件界面门控**

四个文件里渲染 `<Mail …>` `<Strangers …>` `<Recipients …>` `<Greetable …>` 的地方,以及「连 Gmail」「放进草稿箱」按钮,各包一层 `useModules().mail &&`。改之前 `grep -n "Mail\b\|Strangers\|Recipients\|Greetable\|gmail" src/components/{PersonFocus,People,Dossier,Deliverables}.jsx` 列全。

- [ ] **Step 5: ModulesPanel**

```jsx
// src/components/ModulesPanel.jsx —— 设置里的三行开关。只在本机模式出现(canToggle)。
import { useModules } from '../lib/ModulesContext.jsx'
const ROWS = [
  ['profile', '我的档案', '你是谁、作品与履历、语气。关不掉。'],
  ['pursuits', '机会线', '看板、人、时间线、写信稿、找机会。'],
  ['mail', '邮件', '连 Gmail,信自动归线归人。要先开机会线。'],
]
export default function ModulesPanel() {
  const m = useModules()
  return (
    <section className="modules-panel">
      <h3>装了哪些</h3>
      {ROWS.map(([k, name, why]) => (
        <label key={k}>
          <input type="checkbox" checked={!!m[k]} disabled={k === 'profile'} onChange={(e) => m.set({ [k]: e.target.checked })} />
          <b>{name}</b><small>{why}</small>
        </label>
      ))}
    </section>
  )
}
```
样式三行:`.modules-panel label { display:grid; grid-template-columns:auto 1fr; gap:.25rem .6rem; align-items:baseline }`,`.modules-panel small { grid-column:2; color:var(--ink-soft) }`。

- [ ] **Step 6: 验收**

`npm run local`:只看到「我的档案」一个主区,没有通知铃、没有队列;设置里勾「机会线」→ 主区多出四个、通知栏出现;勾「邮件」→ 名片里出现「连 Gmail」;取消「机会线」→ 邮件跟着灭。
`npm run dev`(云端):跟改之前一模一样,设置里没有开关。

Run: `npm test 2>&1 | tail -3 && npm run build 2>&1 | tail -1 && npm run build:local 2>&1 | tail -1`

- [ ] **Step 7: 提交**

```bash
git add src && git commit -m "前端按模块门控：主区、通知栏、邮件界面跟着开关走；设置里三行开关

缺省只开我的档案——这就是第一个安装包给学员看到的样子。云端模式一切照旧。"
```

---

## 完成标准(这份计划)

- `npm test` 全绿(含 `brain/local/*.test.js`、`brain/modules.test.js`、`src/lib/*.test.js` 新增的)
- `node scripts/db-reset.mjs --wipe` 在 dev 库全绿;`scripts/isolation-test.mjs` 全绿
- PGlite 从零建出的表/函数/视图数 == dev 库的数
- `npm run local`:首次启动页 → 填三样 → 只有「我的档案」→ 能填档案、传作品 → 刷新还在 → 设置里开关能开出机会线和邮件
- `npm run dev` + 作者的 `brain/.env`:行为与合并前一致
- `packaging/SPIKE.md` 记着①的结论

下一份计划(④判据文档接口、⑤打包/装机/更新/备份、⑥干净机器验收)在这份全部打勾之后写。
