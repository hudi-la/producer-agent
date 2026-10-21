# Fairwind 正式站点与发布

用户确认的正式站点是 https://fairwind.hudiworks.com/ 。时间线入口为 https://fairwind.hudiworks.com/?a=ledger 。
在本项目中，用户说“上线 / 发布”，默认指这个正式站点，不是 localhost，也不需要再次询问地址。

## 已核实的部署（2026-10-08）

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

2026-10-08：MCP 用户内容读写与独立 card stack。
发布目录：`/home/fairwind/releases/mcp-workspace-20261009/`（目录按 UTC 命名），含测试构建、文件哈希清单及 `rollback/`。
MCP 从 15 个扩展到 51 个工具，完整说明见 [MCP 用户内容](mcp-workspace.md)。
数据库增量迁移 `0167_mcp_workspace.sql` 已应用；真实 PostgreSQL 事务预演成功并回滚测试数据。
38 项 MCP、权限、存储隔离、看板分组测试通过，hosted 构建成功。
正式 MCP 工具清单及 7 个只读接口验收通过；站点 HTTP 200，未登录 MCP HTTP 401，正式 HTML 和入口资源与构建一致。
仅本次 11 个文件更新，发布前已逐个比对线上基线；服务已重启。
回滚：`python3 /home/fairwind/releases/mcp-workspace-20261009/deploy/release.py rollback` 后 `sudo systemctl restart fairwind.service`。保留增量数据库结构和用户新写入数据；旧服务不会使用新接口。旧静态 assets 保留。
本地改动和基线在 `fixes/2026-10-09-mcp/`，未用旧 checkout 覆盖线上其他功能。

2026-10-08：ChatGPT 设备码权限开启后的重新连接引导。
发布目录：`/home/fairwind/releases/chatgpt-retry-20261008-35siB9/`，含 baseline.json 和 rollback。
新增「已开启权限，重新连接 ChatGPT」按钮，等待授权期间也可使用；结束该账号旧等待会话并生成新验证码，忽略旧轮询结果，保留其他账号会话。
17 项引擎、账号隔离、客户端到托管路由及翻译测试通过；模拟界面验证旧码换新码；hosted 构建及正式域名资源、health 验证通过。真实用户重新授权需本人完成。
仅更新本次六个文件，基线哈希检查通过，后端已重启。入口资源：`index-DywT3r3G.js`。
回滚：在 `/home/fairwind/producer-agent` 解包发布目录的 `rollback/source.tar`，恢复 `rollback/index.html` 到 `dist/index.html`，再重启 `fairwind`。旧静态 assets 保留。
本地补丁与测试：`fixes/2026-10-08-chatgpt-retry/`。


2026-10-13（洛杉矶）：修复机构邮件归档事务回滚。
正式数据库由 `/Users/dihu/.fairwind-hosted.env` 对应配置定位，并核对正式网页数据库地址一致；不要使用旧 `brain/.env` 判断线上状态。
根因：线上 `pa_add_mail` 创建 `arrival` 告知时未写 `counterpart_email`，机构邮件没有 contact_id、调用未传 pursuit_id 时违反 `pm_owner_chk`，导致整笔邮件事务回滚。
仅给 arrival 插入添加 counterpart_email=cp，保留线上函数其余内容、权限与租户隔离。无需后端重启。
回滚事务验证首次插入成功、重复插入不重复、email/arrival 均带机构邮箱；随后比对线上定义未变化再提交函数修复。
已从 Gmail 原文恢复 Descanso 两封：1a13111bee58933d、1a136ffe1eab4f23；均验证 `v_pa_pursuit_mail.on_this_line=true`，卡片 8af3707a-7096-442e-8eca-0060fb510239。
补丁：`fixes/2026-10-13-mail-archive/fix.sql`；原函数备份（回滚用）：同目录 `pa_add_mail-0.sql`。回滚函数不删除已恢复邮件。
未改提示状态或起草收件人逻辑；服务器 SSH 仍超时，实际日志尚不可读。另一封无关邮件的人工补录被自动审批拒绝，未执行；没有扩大补录范围。


2026-10-14 06:39 UTC：产出卡、Gmail 工具、搜索分批和归档失败提醒整合发布。
- 基于本次实时服务器源码逐文件合入，保留 App.jsx 的线上新改动；实际整合提交 6e1a1d07838d5d7164a7710e8e4c9954d4bcb901（独立 verified-release 仓库，未 push）。原产出/Gmail 选择性提交88bd750，历史候选8994ce2均不是直接整库覆盖来源。
- 正式迁移0168_scout_search_checkpoints已提交，仅新增security invoker函数及权限/迁移记录；不修改既有业务数据。先经真实数据库事务预演回滚，用户在明确得知影响后授权执行及一次服务重启。
- 发布目录 /home/fairwind/releases/integration-20261014/：manifest.json记录44个目标文件前后哈希，test/为服务器构建，rollback/保存旧目标源码和HTML，publish.py提供回滚。旧静态assets保留。回滚运行python3该目录publish.py rollback，会恢复旧运行代码/HTML并重启，保留新增数据库函数及用户新数据；须在适当授权和活动检查后执行。
- 构建标识2026-10-14-release-candidate；入口index-kjIoyS7L.js，App-BlOirj69.js，CSS index-A4W5qbvA.css。正式域名HTML/资源200且哈希一致，health ok=true及新build；匿名/artifact、/gmail-draft返回401。
- 70项目标测试通过；改为正式0168编号后checkpoint隔离测试再次通过；服务器hosted构建和语法检查通过。发布前任务运行数0、8788已建立连接0、活动子进程0；fairwind.service重启一次，启动时间06:39:54UTC，发布后active/running、NRestarts=0；44文件及HTML哈希均匹配。
- 用户已登录页面验收：新标签页实际加载新入口；10张产出内联卡显示，已有产出“修改”打开右栏、卡片操作禁用，“取消修改”关闭右栏并恢复操作。未保存变更、未创建真实测试草稿、未发送邮件、未触发真实模型搜索。真实Gmail搜索/读取和创建更新草稿的端到端调用仍待用户实际使用验收，不能声称已做过生产写入验收。归档失败恢复路径以3项离线测试验证，未人为制造线上故障。
- Descanso pa_add_mail函数摘要仍f7157c268bffe7c703caeadc49b07b7e，未重复修复；两封指定邮件在用户卡片仍可见。会后提醒过期、收件人抄送策略、邮件上下文优先级不在此次实施范围。

2026-10-14（洛杉矶）：内联产出卡宽度与配色。
- 基于实时线上 src/styles.css，仅追加产出卡样式；取消继承的640px上限，与对话同宽。淡青绿卡面、左侧色条、浅色正文区，包含深色模式与窄屏内边距。
- 发布目录：/home/fairwind/releases/artifact-style-20261014/；rollback/styles.css和rollback/index.html保留原版本；纯前端，无服务重启或数据库修改。
- hosted构建通过；服务器HTML与构建一致，正式CSS与构建SHA256均为c0f3ee50c30c5f901edb198a5fad3158cd7dbdd2546d01ca23dda43481a48a4e。入口index-BgujD5Dc.js，CSS index-Bkc-0XSa.css。
- 已登录正式页验收：最新产出卡及对应对话宽度均1028.5px，新背景rgb(229,239,235)，截图确认正文和操作按钮清楚显示。未发送邮件或保存草稿。
- 回滚：恢复rollback/styles.css到源码src/styles.css，原子恢复rollback/index.html到dist/index.html；旧assets保留。
- 本地补丁、线上样式基线和发布脚本：fixes/2026-10-14-artifact-style/。


2026-10-14（洛杉矶）：对话上下文来源区分与关联邮件补齐。
- 基于实时线上 brain/prompt.js，基线 SHA256 8f0e4458884f4de49eabff0dafbec875a83b0689ff5c4be5b8a46c6fa837e8da；只更新 prompt.js 并新增 contextHistory.js。未覆盖 server.js 或前端。
- 实时读取正式 pa_brain_context 定义，仅扩展 messages 查询：直接挂卡消息 + v_pa_pursuit_mail.on_this_line 的真实邮件，保留调用者权限、RLS 与其他返回字段；未修改业务记录。函数基线及补丁位于 fixes/2026-10-14-context/。
- 上下文分为真实邮件、线下记录/保存记忆、聊天、草稿/产出；邮件提供原文、日期、方向与可用信头。草稿/定稿/Gmail草稿均不作为发送证明；旧助手建议不是对外承诺。由回答模型在同一轮按当前问题选用，不新增分类模型或每轮强制邮箱查询。
- 本地和服务器42项回归测试通过。原线上测试冻结副本未包含已发布的read_mail规则，基线已有1项失败，本次仅校正该测试副本。数据库事务预演回滚后再提交，发布前比对函数与源码基线。第一次代码发布因活动请求退出，第二次空闲检查通过后重启一次；服务active/running，NRestarts=0，正式/health ok=true。
- 发布后真实authenticated权限只读核对：Descanso 16封邮件、Book Arts Institute 11封，左栏相关邮件及原文完整进入最终prompt；其他用户身份无权读取目标卡及消息。管理员视角最初的31/21封含其他用户记录，不是本账号数量；实际模型上下文遵循RLS。
- 未执行真实模型回答评测，未发送邮件、创建草稿或修改聊天记录。尚未引入摘要/截断，因此完整原文增加上下文长度；这两张卡的动态prompt分别约186223/92039字符。
- 发布目录 /home/fairwind/releases/context-20261014，manifest.json记录两个运行文件前后哈希，rollback/brain/prompt.js备份原源码，pa_brain_context.sql备份原数据库函数。
- 回滚：先检查当前函数仍为本次版本，运行本地 node fixes/2026-10-14-context/database.mjs rollback；然后 ssh 执行 python3 /home/fairwind/releases/context-20261014/publish.py rollback。脚本校验源码哈希并要求无活动子进程/请求，再恢复原prompt、移除本次新增模块并重启；不删除业务数据。

2026-10-20（洛杉矶）：修复卡片聊天邮件工具初始化崩溃。
- 基于实时线上 brain/server.js，仅将 mailboxServer 从未导入的 createSdkMcpServer/tool 改为已有 toSdkServer/defineTool；保留只读 handler、参数及用户绑定，同时提供其他模型引擎需要的 __specs。
- 本地补丁与回归检查：fixes/2026-10-20-mailbox-init/。真实安装 SDK 下复现旧 ReferenceError；修复后工具初始化、模型工具定义、参数校验、搜索/读取转发及 reader 隔离验证通过。未调用真实模型或真实邮箱。
- 发布目录 /home/fairwind/releases/mailbox-init-20261021/，manifest.json 保存前后哈希，rollback/server.js 保存旧文件；publish.py 支持 publish/rollback。等待活动模型任务结束、无8788活动连接后发布并重启一次；正式域名 /health ok=true，服务 active/running、NRestarts=0，线上文件与测试候选一致。
- 修复后 server.js SHA256：3ce0ea6d2a2fb310936bc6d0a122843ee3602b982ef95bd4a96ac24c2db12cd1。无数据库或前端变更；真实聊天端到端验收待用户重试。
- 回滚：python3 /home/fairwind/releases/mailbox-init-20261021/publish.py rollback（核对源码哈希并检查空闲后恢复和重启）。

2026-10-20（洛杉矶）：修复邮件草稿与提醒同时输出时邮件卡片缺失。
- 根因：takeTag 对标记后整个尾部 JSON.parse，LETTER 后跟 STATE/MEMO 时失败；随后提醒被剥离，邮件裸 JSON 留在消息中。
- 只更新正式 brain/tag.js：按引号、转义及括号深度读取一个完整 JSON 值，保留后续标记及文字；损坏输入仍保留原文。
- 本地和服务器47项邮件、表单、状态及标签测试通过，新增 LETTER/STATE/MEMO 六种顺序、转义及损坏相邻标记覆盖。
- 发布目录 /home/fairwind/releases/letter-tags-20261021，manifest.json记录哈希，rollback/tag.js备份；空闲后重启，health正常。回滚：python3 /home/fairwind/releases/letter-tags-20261021/publish.py rollback。
- 精确恢复用户指出的一条既有回复：从原文提取meta.letter，保留meta.state_move与完整邮件内容；事务预演回滚后比对原值提交。原始数据仅本地备份，未纳入Git。正式页面确认卡片正文、修改/发送/存草稿箱按钮；未发送邮件。
- GitHub：基于已核对与线上基线一致的production-backup/2026-10-15，分支codex/production-chat-fixes-20261020记录本次tag修复和前一项mailbox初始化修复。线上无Git目录，使用隔离clone推送，不覆盖旧checkout。
