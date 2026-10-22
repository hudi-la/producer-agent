# Fairwind 迁移交接给 Hudi 与 Codex

交接日期：2026-10-21（美西）。目标：把 Fairwind 从 DigitalOcean 迁到 Render，保留原 Supabase 和正式域名。**目前没有切正式站：旧站正常运行，新站仍是 standby。不要直接改 DNS 或开启新站后台任务。**

## 给 Hudi 的简短说明

Render 候选环境已经建好，原有私有状态已复制并验证重启后仍在；使用你已授权的 Di Hu 账号，资料读取、Gmail 和 Calendar 的只读访问，以及一次真实模型调用都通过了。还剩两件关键工作：合并迁移期间旧站新增的用量统计功能；使用你管理 hudiworks.com 的 Cloudflare 账号完成域名验证和最终切换。切换前还需暂停旧 Fairwind、复制最新状态，避免新旧后台同时收信和执行任务。DigitalOcean 不要删，它还承载 ERP、LLM Lab 和其他服务。

你可以把本文件交给自己的 Codex，从下面的接手步骤继续。Render 服务在 Marvin 的 parallight 工作区；若你的账号看不到，请先由 Marvin 在正式权限流程中授予必要访问，不要交换个人密码、API Token 或私钥。

## 资源与代码位置

| 项目 | 位置或状态 |
| --- | --- |
| 私有代码仓库 | https://github.com/hudi-la/producer-agent |
| 迁移分支 | `codex/render-migration`；不要直接拿旧 main 覆盖候选环境 |
| 交接前已推送提交 | `fab41e2`；本文件及账户验收脚本随后追加在同一分支 |
| Render 当前部署 | `7bf8769a857472fcc4b0de94fc6621790e76aa4c`，不是分支最新提交 |
| Render 服务 | `fairwind-migration`，ID `srv-dbcpchavcj2c73fe55dg` |
| 控制台 | https://dashboard.render.com/web/srv-dbcpchavcj2c73fe55dg |
| 候选网址 | https://fairwind-migration.onrender.com |
| 正式网址 | https://fairwind.hudiworks.com （仍在 DigitalOcean） |
| 旧主机 | `agentist-erp`，`64.23.225.65`，Droplet `601827582` |
| 旧程序 / 状态 | `/home/fairwind/producer-agent` / `/var/lib/fairwind` |
| 旧服务 / 私密配置 | `fairwind.service` / `/etc/fairwind/env` |
| Render 持久磁盘 | 1 GB，挂载 `/var/data/fairwind` |
| 运行规格 | Oregon，Docker Node 24.9.0，1 CPU / 2 GB；自动部署关闭 |

当前计算与磁盘基础费用约 $25.25/月，授权总上限 $26/月。不要另建重复付费服务或扩大规格；域名附加计费及税费以账单为准。模型调用单独计费。

Render 已导入所需 Supabase 服务端及 Google OAuth 配置，不需要把这些值放进 Git。当前关键非秘密配置：

```text
FAIRWIND_DEPLOYMENT_STATE=standby
FAIRWIND_CUTOVER_CONFIRMED=false
FAIRWIND_MODE=hosted
FAIRWIND_DATA_DIR=/var/data/fairwind
BRAIN_ORIGIN=https://fairwind.hudiworks.com
```

候选 `/health` 返回 200、`businessReady:false`；首页返回 503 是故意隔离，**不是迁移失败，也不代表已经可以使用**。

## 已实际完成的验收

| 验收 | 结果与范围 |
| --- | --- |
| Node 24.9.0 完整自动测试 | 825/825，通过版本为迁移候选代码，不含后来发现的用量统计改动 |
| Render Linux 重点回归 | 77/77，包含上下文、Gmail、Calendar、隔离与启动配置；使用 fixtures |
| 真实后端隔离检查 | 11/11，未登录拒绝、业务写入拒绝、后台定时任务不启动 |
| Di Hu 账号只读业务验收 | 13 项通过；真实 Supabase 账户、5 个受保护 GET、Google 授权读取 |
| 加入真实模型探针 | 共 14 项通过；Claude SDK 独立子进程返回 MIGRATION_OK，用量报告 $0.001539 |
| 持久化 | 已验证 310 个文件、185,256,131 字节；Render 实际重启后摘要不变 |

账号下读取到 profile 1、pursuits 137、contacts 262、entries 61。这些是对应数据库视图数量，不要与 UI 的“机会池”数直接比较。验收未发送邮件、未新增或修改 Calendar 事件。模型探针禁用工具，不等于整个网页交互或长任务已经验收。新域名浏览器登录、完整模型流式交互及生产后台运行仍需最终检查。

原 12 项测试失败主要是旧测试预期和 mock 与现有实现不一致，已修复并补回归；不是声称修了 12 个生产业务故障。详情见 [验收记录](render-verification.md)。

## 必须先处理的代码差异

迁移期间，旧站代码继续更新。最近对 328 个基线源码文件的检查发现以下 4 个文件不同，**尚未合并到迁移分支**：

| 文件 | 旧站新增内容 |
| --- | --- |
| `brain/hosted/routes.js` | `/settings/usage?days=7\|30\|90`，依赖 `brain/usage.js` |
| `brain/server.js` | 包装模型调用并记录用量，依赖 `brain/usage.js` |
| `src/components/SettingsPage.jsx` | 渲染 `UsageCard` |
| `src/lib/brainClient.js` | `settings.usage(days)` 客户端调用 |

必须另取新增的 `brain/usage.js`、`src/components/UsageCard.jsx`，并检查其他新增文件、测试和依赖；只比较基线文件会漏掉新增文件。先比对 GitHub 最新版本及旧机实际代码，确认权威版本。**不能用旧机的 server.js/routes.js 整文件覆盖候选版本**，否则会丢失只读验收、显式账号限制和禁用后台任务的迁移保护。

Marvin 本机取回的四个文件临时副本在 `/tmp/fairwind-live-reconcile.Jg3vjf/`，不是可靠交接存储。Hudi 的 Codex 应从旧站重新只读获取最新源码，而不是依赖这个本机临时目录。

## 持久状态与最重要的风险

Render 上已验证的初次快照：

```text
归档：/var/data/fairwind/verified-state-f6fa35d491c97773.tar.gz
大小：26,812,155 bytes
归档 SHA-256：f6fa35d491c97773db3a39c8553e36d026571be2b152d939a8e948e8522e2b2a
隔离解压：/var/data/fairwind/acceptance-initial-20261021
解压状态摘要：fb017ce488c7449f8997efe9fde44bb0b9d88dc8a8f7ec0e048d18bd6fcd8209
```

**磁盘根目录 `/var/data/fairwind/users` 是早期中断传输留下的不完整副本，不可直接开启 live 使用它。** 磁盘上还可能有部分归档及分块文件。切换时应先盘点并隔离不完整副本，保留恢复材料，再把最终完整快照安装到已验证的正式目录，不能把新文件盲目覆盖合并到残缺状态中。生产启动脚本要求 `FAIRWIND_DATA_DIR` 本身就是磁盘挂载点，不可只改成验收子目录绕过问题。

初次快照是在旧站在线时取得，**不是最终一致性备份**。最终复制必须在旧 Fairwind 停止写入后进行，包含 SQLite 及其 WAL/SHM、用户模型状态、Calendar 授权等；按实际数据格式做一致性检查。Supabase 继续使用原项目，不能把旧数据库备份恢复覆盖新写入。

Marvin 本机另有私密备份 `/Users/mgao/.config/fairwind-migration/snapshots/state-initial-20261021.tar.gz`。它不在 Git 中，也不应作为邮件附件或公开下载文件。

## 给接手 Codex 的执行顺序

### 1. 准备访问并取代码

使用 Hudi 自己获准的 GitHub、Render、旧主机和 Cloudflare 访问。Cloudflare 必须能看到 `hudiworks.com`，Marvin 当前账号没有这个域名。旧 Cloudflare API 凭证失效；不要反复使用它或扩大其他域名权限。

```bash
git clone --branch codex/render-migration https://github.com/hudi-la/producer-agent.git
cd producer-agent
git status --short
git log -5 --oneline
```

若已有工作区，先保护未提交改动，再 fetch 并检查差异，不要 reset 覆盖。阅读本文件、`docs/render-migration.md`、`docs/render-verification.md` 及 `AGENTS.md`。Marvin 本次临时 Render SSH 公钥 `fairwind-migration-temporary-20261021` 已撤销，旧连接已关闭；需要 SSH 时申请接手者自己的授权，不要索取旧私钥。

### 2. 合并线上增量并重新测试

先完成上节用量统计差异及新增文件核对。使用 Node 24.9.0：

```bash
npm ci
npm ci --prefix brain
FAIRWIND_LANG=zh npm test
VITE_HOSTED=1 npm run build
```

保持 Render standby、自动部署关闭，手动部署已检查的新提交。构建时需要现有公开前端环境变量，秘密仍留在服务端；无环境变量的本地 build 只证明编译通过。部署后核对实际 commit，再运行：

```bash
# 在 Render 容器 /app 内运行，使用服务现有环境；不要打印环境变量。
node scripts/acceptance-smoke.mjs
node scripts/acceptance-account.mjs 'Di Hu' /var/data/fairwind/acceptance-initial-20261021
```

账户脚本只用于已授权账号，会创建测试登录会话并在结束后撤销该会话，执行只读业务检查。若账号名不唯一则中止，不可改成取第一个用户。`--model` 才会触发模型费用；本次预算 $1 中已报告 $0.001539，接手后再运行应先由 Hudi 确认费用与账号范围。不需要重复调用模型来证明 DNS 权限。

### 3. 准备域名与维护窗口

Render 已登记 `fairwind.hudiworks.com`，域名 ID `cdm-dbcq63mq1p3s73cukp90`，尚未验证。**目前 DNS 没改，正式站仍指向 `64.23.225.65`。**

由 Hudi 确认维护时段、回滚责任人并保存原 DNS 记录。参考 [Render 自定义域名文档](https://render.com/docs/custom-domains)，核对控制台对该域名的 DNS/TLS 要求；通常该子域指向 `fairwind-migration.onrender.com`。只调整 Fairwind 这一个子域，检查其冲突 A/AAAA 和代理设置，不改 hudiworks.com 根域、邮箱、ERP 或其他记录。证书验证可能需要先变更 DNS，因此按实际状态安排短维护窗口，不承诺零停机。

### 4. 最终一致性迁移与切换

1. 先排空或阻止 Fairwind 新请求，等待在途模型/收信任务完成；记录服务状态与回滚信息。
2. **只停止 `fairwind.service`**，确认进程和相关子进程不再写入。不要停止 Droplet、Caddy、ERP 或 LLM Lab。
3. 从 `/var/lib/fairwind` 获取最终一致性快照，安全传输，验证完整归档哈希、文件清单和必要数据库完整性。在 Render 备份/隔离残缺副本后安装，保证 Node 用户有正确权限，磁盘空间充足。
4. 旧后台已停止、状态已验证后，才设置 Render `FAIRWIND_CUTOVER_CONFIRMED=true` 与 `FAIRWIND_DEPLOYMENT_STATE=live`，保持 `BRAIN_ORIGIN=https://fairwind.hudiworks.com`。这两个开关不是分布式锁，必须由操作者保证只有一个生产后台。
5. 完成 DNS、Render 域名验证和 TLS。使用正式域名检查登录、原账号数据、模型流式响应、只读 Gmail/Calendar 授权状态及错误日志。记录后台实际运行情况，避免重复收信/重复处理。需要真实发送或日历写入时另行明确授权测试目标。
6. 观察内存、模型子进程和磁盘增长；确认没有 OOM、重启循环或 OAuth 回调错误。记录最终部署提交、快照摘要、切换时间与检查结果。

若任一步缺少权限、数据校验失败或测试失败，不继续切换。登录/证书验证未完成之前不能宣称迁移完成。

### 5. 回滚

先停止 Render 业务后台，避免两边同时运行。核查切换后是否有新持久状态，必要时安全回迁并验证，再恢复旧 DNS 并启动旧 `fairwind.service`。Supabase 是共享原项目，不恢复过期数据库快照。保留旧环境与备份到约定观察期结束；**删除 DigitalOcean 必须另行获得 Marvin 授权**。

## DigitalOcean 不能随 Fairwind 一起删除

同一台主机还承载 ERP 容器、正式及测试 LLM Lab worker、GPU 到期回收器 `llm-lab-reaper.service`、图书服务、共享 Caddy 和数据卷。停回收器可能留下继续计费的 GPU。完整条件清单见 [DigitalOcean 保留清单](digitalocean-retention-inventory.md)。本次没有停止或删除这些资源。

## 交接完成的判定

- 线上新改动完整保留，最新候选代码通过回归和账户只读验收。
- 最终状态在旧站停止写入后复制，验证哈希及持久性，不使用残缺根目录。
- 正式域名、TLS、登录、业务读取与模型调用验证通过。
- 只有 Render 在执行 Fairwind 生产后台；旧环境仍可回滚。
- 不泄露密钥、不向真实联系人发测试邮件、不擅自删除 DigitalOcean。

请 Hudi 的 Codex 最后输出实际执行的提交、部署 ID、验收结果、DNS 状态、回滚位置和未完成项；不要把本交接的历史测试结果当成本次新代码的测试结果。
