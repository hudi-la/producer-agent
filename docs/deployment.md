# Fairwind 正式站点与发布

用户确认的正式站点是 https://fairwind.hudiworks.com/ 。时间线入口为 https://fairwind.hudiworks.com/?a=ledger 。
在本项目中，用户说“上线 / 发布”，默认指这个正式站点，不是 localhost，也不需要再次询问地址。

## 当前正式部署：Render（2026-10-23）

正式地址仍为 https://fairwind.hudiworks.com/，现已切到 Render `fairwind-migration`（parallight，Oregon，服务 `srv-dbcpchavcj2c73fe55dg`）。下方 DigitalOcean 发布流程仅作历史参考，不可再直接用于正式发布。

- 实际生产提交：`e79a51cb8bf569687340d50eb86056919ed86160`，已推送 GitHub `codex/quiet-drafts-20261023`。2026-10-23 20:46 PDT 发布聊天意图、上下文来源与判断水位基础修复；保留前版通知及草稿样式。
- 实际生产部署：`dep-dbe2k8hsrm7s73degoj0`；2026-10-23 20:46 PDT 发起并成功 live。自动部署关闭，后续通过 Render 手动部署经核实的提交；不可从旧本地 checkout 整库覆盖。
- 运行：Docker Node 24.9.0，1 CPU / 2 GB，持久磁盘 1 GB；`FAIRWIND_DATA_DIR=/var/data/fairwind`，`FAIRWIND_DEPLOYMENT_STATE=live`，`FAIRWIND_CUTOVER_CONFIRMED=true`。Supabase 仍为原项目；凭据只留服务配置。
- Cloudflare：`fairwind` 为 DNS only 的 CNAME，指向 `fairwind-migration.onrender.com`，TTL Auto。Render 域名 Verified、Certificate Issued；正式 HTTPS 验证通过。
- 旧 DO `fairwind.service` 已停止且 disabled，不能与 Render 同时开启。DO 主机、ERP、Caddy、LLM Lab 及其他服务保留。
- 最终一致性快照：DO `/home/fairwind/releases/render-cutover-20261023b/`；Render `/var/data/fairwind/cutover-20261023b/`。归档 SHA-256 `a3dbd03b6428ad23c9fb6c713b0c67aa6daabd891cb6eeadf938f6056dcffe24`；345 文件，185,712,226 字节，25 个 SQLite 完整性检查通过。旧残缺状态隔离在 `/var/data/fairwind/quarantine-pre-cutover-20261023b/`。
- 2026-10-23 20:30 PDT 发布已完成正式 Chrome 页面收发通知验收。未用真实发信或计费模型探针验证本次基础修复。
- 回滚必须先把 Render 改回 standby/false 并确认业务后台已停；核对并回迁切换后的新本地状态，再恢复旧 DNS A `64.23.225.65`，恢复 DO 发布目录的 `Caddyfile.before`（或执行该目录 `cutover.py restore-proxy`），最后 `sudo systemctl enable --now fairwind.service`。不能恢复过期 Supabase 备份。
- 临时 SSH 授权和详细验收记录见 [Render 接管记录](render-takeover-20261023.md)。SSH 直连曾反复重置，经原 DO 的 ProxyJump + SFTP 完成传输；不要把私钥放进服务器或 Git。




## 已核实的部署（2026-10-08，历史参考）

- SSH：`ssh fairwind@64.23.225.65`，使用本机 SSH 身份认证；不把密钥或 token 写进项目。
- 服务器源码：`/home/fairwind/producer-agent`。服务器版本比此本地 checkout 新；必须先读取线上文件再合入改动，不能整库覆盖。
- Node：`/home/fairwind/node/bin`。
- 前端构建：`VITE_HOSTED=1 npm run build`，使用服务器现有 `.env.production`，不输出其中内容。
- 静态产物：源码目录下 `dist/`；服务由 `fairwind.service` 管理，后端监听本机 8788。
- 历史发布和回滚：`/home/fairwind/releases/`。

## 仅前端发布流程

1. 从当前线上源码创建独立构建目录，复用 node_modules；在服务器内部复制 `.env.production`。排除后端凭据文件。
2. 仅应用本次所需文件差异，保留线上认证、语言切换及其他功能。运行相关测试和 hosted 构建。
3. 备份将更新的源码和 `dist/index.html`；发布前检查线上源码未被其他任务修改。
4. 先复制新 assets，保留旧 assets，然后原子替换 `dist/index.html`。纯前端修改无需重启后端。
5. 校验本机 8788 提供的 HTML 与新构建相同，检查正式域名和资源；失败时还原源码和 HTML。

正式域名若返回 401，应调查认证/路由状态并如实报告，不应绕过认证或把 localhost 验证称为公网验证成功。

## 最近一次发布

2026-10-08：日历月/周视图与 Fairwind 动态热力图。
回滚备份：`/home/fairwind/releases/calendar-20261008-jos2Lm/`。
11 项热力图及中英文检查通过；正式站点 `/?a=ledger` 和新 JS 资源返回 HTTP 200。

2026-10-08：Google 日历独立授权及读写接入，详见 [Google 日历](google-calendar.md)。
发布目录：`/home/fairwind/releases/google-calendar-20261008-nXNz6X/`，包含基线、构建及 rollback。
此版本有后端变更，已重启 fairwind 服务；39 项相关测试通过。

2026-10-23 20:46 PDT：全系统架构审计及基础修复。857项回归、hosted构建通过；移除两处聊天转笔记降级，派生记录独立标源，判断依赖写失败不推进水位。提交 e79a51c 已推送，Render dep-dbe2k8hsrm7s73degoj0 成功 live；正式 health/首页/新bundle及登录页面验证通过。无数据库迁移或历史数据写入；提醒投影、发送账本与定时任务迁移尚未完成。详见 [审计报告](architecture-audit-20261023.md)。

2026-10-24：决策核心修复（分支 `fix/decision-core-20261024`，提交 538f459，基于 e79a51c；866 项测试通过）。**代码尚未发布**：Chrome 扩展未连接、本机无 Render 凭据。
数据库迁移 0169 已在线上执行（Supabase MCP）：上下文函数带回 state、信头写入带回 names、新增只给 service_role 的 pa_member_secrets_for、7 个函数固定 search_path。执行前逐字核对了线上旧定义；执行后以 Di Hu 会话验证上下文 state 与 v_pa_state 一致，原有权限不变。0169 对新旧后端都安全。
**待办，顺序不可颠倒**：① Render 手动部署 538f459（或更新）；② 部署验证通过后再执行 0170（收回 authenticated 对 pa_member_secrets 的执行权）。先跑 0170 会让旧后端读不到任何人的设置。

## 2026-10-29 无障碍发布

- 正式基线：Render 上实际运行的 `9f1202f70db55bda238164ecbbdc10f3222f1d7d`，不是旧默认分支。
- 发布源码：`e905e19b52bb59b754a0463a40b84aab4777def0`，已推送 GitHub `codex/accessibility-20261028`。
- Render：`dep-dbhtmjnb9u1s73avgpsg`，2026-10-29 16:49 PDT 显示 Deploy succeeded / Live。
- 范围：跳转主要内容、导航状态、可见焦点、减少动画、对比度、聊天标签、语言标记、四类弹窗的焦点循环与退出恢复。无后端或数据库变更。
- 验证：hosted 构建、3 项 i18n 检查、弹窗初始焦点 / 正反 Tab 循环 / Escape / 触发按钮焦点恢复检查通过；正式首页返回新版 CSS `index-fmm5iBZ2.css`。
- 回滚：在同一 Render 服务回滚到 `dep-dbeomagm7kps73eikgi0`（9f1202f）；不启动旧 DO 服务，不回滚数据库。
