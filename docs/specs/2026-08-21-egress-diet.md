# 省流量：轮询改成「先问一句有没有动静」

2026-08-21。起因：Supabase 免费档 5 GB/月的下行流量（egress）被打爆，
库被锁（exceed_egress_quota），页面全线退回种子数据。

## 账是怎么烧掉的

库本体只有 13 MB。53 天烧了约 240 GB，全在「反复重拉没变的东西」：

| 元凶 | 频率 | 单次 | 估算 |
|---|---|---|---|
| PursuitFocus 3 秒轮询 `v_pa_pursuit_thread`，`select('*')` 连 `body_raw` 一起 | 1200 次/时/标签页 | 50–130 KB | 最大头。`body_raw` 占视图体积 73% |
| App 8 秒轮询 `v_pa_pursuits` 全表 | 450 次/时 | ~110 KB | ~21 GB |
| loadContacts 全库带正文消息（喂 `msgsByContact`，**没人读这个 prop**） | 每次加载/认人 | 4.2 MB | 次大头，且 1275 行早被 PostgREST 1000 行上限静默截断 |
| PursuitFocus 5 秒轮询产出+附件 | 720×2 次/时 | 中 | — |

后台标签页没有任何守卫（`document.hidden` 全仓 0 处），并排开三四张全在跑。
brain 那边 5 分钟一轮的收信循环反而全是窄查询，不是问题——**定时收信保留**。

## 方案：脉搏

不改「轮询」这个形状——它简单、可靠、离线恢复自然。改的是**每一跳的价钱**：

1. 库里加一张单行表 `producer.pulse (n bigint)`。producer 下每张表挂一个
   statement 级触发器，任何写入 n+1。**任何改动都拨得动它，不存在漏更新**——
   这是「绝不丢信息」在这套方案里的落点。
2. 前端一个单例（`src/lib/pulse.js`）每 4 秒读 `v_pa_pulse`（一行两列，几十字节）。
   n 变了才叫订阅方去真拉。三个 setInterval 全改成订阅脉搏。
3. 标签页不可见就停跳，切回来立刻补一跳。
4. 读脉搏失败（断网、限额）时**降频但不停**（60 秒一跳照样通知订阅方），
   让各 loader 自己的「退回种子数据 + 说明原因」照常发生，库回来了自动复活。

**0112 补**：0111 挂的光杆 statement 触发器「语句跑过就算数，哪怕 0 行没改」。
brain 每 5 分钟一轮里那些 `update…where` 在信箱安静时全是 0 行，一轮白拨好几次，
而每拨一次所有开着的标签页都重拉 161 KB 看板——省下的钱从这个无声的口子漏回去。
改用过渡表问一句「这条语句到底动了行没有」，动了才拨（insert/update/delete 各一个
触发器，truncate 拿不到过渡表，保持光杆——清表是大动静，宁可多拨不可漏）。

排除两张表不挂触发器：
- `mail_accounts`——收信游标每 5 分钟必写一次，跟着它跳等于每 5 分钟白拉一轮；
  它面上可见的字段（地址、label、backfilled）几乎不变。
- `stage_backup_0015`——历史备份，死表。

## 必须一起排掉的雷

- **markSeen 自激**：App.jsx「正看着的这张随时算已看」每次 pl 刷新都写
  `pursuit_seen` → 拨脉搏 → 重拉 pl → 再写……前端加闸：**卡上没红点就不写库**。
  写库只发生在「真有没读的」那一刻，循环在第二跳就断。
- **tagPass 读不到 state 会当成 IDLE**（brain/server.js 空 catch +
  没解构 error）：网络抖一下，事实就按 IDLE 走错格子，日志一个字没有。
  改成：读不到 state 就跳过这条、留在队列、出声。
- **notifications.js 三处吞错**（verdicts / states / unclaimed 没解构 error）：
  查询失败长得跟「没事要办」一模一样。改成失败退回 QUERY_FAILED。
- **loadContacts 那条 4.2 MB 查询直接删**：`msgsByContact` 全仓只有
  构建/传参/解构三处，没有读者。

## 不动的

- 状态机判定逻辑（judge.js 转移表）一行不动。
- brain 的 5 分钟收信、60 秒 brief 扫描——本来就省。
- PersonFocus / OrgFocus 打开名片时拉带正文的往来——用户点一下拉一次，有界。
- 界面长相：一个像素不变。

## 修完的量级

变化驱动的重拉（估 100–300 次/天）× ~250 KB ≈ 每月 1–2 GB，
脉搏本身 ~50 字节/4 秒（只在页面可见时）。充值后离 Pro 档 250 GB 两个数量级。

---

# 第二轮（同日，量准之后）：估错了，真账在这儿

上面那句「估 100–300 次/天」是拍的，没查写入量。查完（54 天统计）：

| 表 | 每天写入 | 占全库 |
|---|---|---|
| `address_verdicts`（地址是不是真人的判决） | 12,229 | **82.5%** |
| `pursuit_seen`（读到哪儿了） | 2,207 | 14.9% |
| 其余全部（信、线、人、稿…） | ~390 | 2.6% |

`pursuit_seen` 那份就是上面记的 markSeen 自激，已堵。
`address_verdicts` 那份没人碰过，源头是 `pa_mail_rule_pass`：它挂在 brain
每 5 分钟一轮的收信里，**每轮把所有符合规则的地址整批重写一遍，不比较判决有没有变**
（只有 `decided_at` 变成 now()）。一轮 2 条写语句 = 2 次拨动，一天约 576 次；
每次让所有开着的标签页重下 161 KB 看板。

而 `v_pa_pursuits` 的依赖链（递归追出来）是 contacts / mail_headers /
org_mailboxes / pursuit_messages / pursuit_parties / pursuit_seen /
pursuit_threads / pursuits / works——**`address_verdicts` 不在里面**。
也就是说这些重下载在数学上不可能改变屏幕上任何一个字。

## 这一轮做三件事（他拍的，一次做完）

**① `pa_mail_rule_pass` 只在判决真的变了时才写**（0113）。
upsert 加 `is distinct from` 比较。它本身就是 bug：一个判断程序不该每 5 分钟
宣称自己有了新结论。副作用是返回的 machine/bulk 计数从「碰过几行」变成
「真判了几个」——语义更对，brain 那边只用来打日志。

**② 看板不再拉 `why` + `notes`**（前端）。实测 161,277 → 78,254 字节，砍一半。
这两段长文**看板一个字都不显示**，全前端只有 PursuitFocus 那一处用
（已 grep 全仓核实：其他文件里的 why/notes 是别的对象的同名字段）。
改成打开卡片时单独拉这一张的这两个字段，拉不到就退回 `p.why`（种子数据那条路照走）。

**③ 计数器按区拆开**（0114）。他提的：一行多列，HTTP 响应头 912 字节一个字节不变，
body 从 10 字节变成约 45 字节，但网页能知道**是哪一块变了**，只重下那一块。

区的划分**从数据库的视图依赖关系自动推导**，不手写清单——手写的迟早跟视图分叉。
`producer.pulse_areas` 存「区 → 视图」的注册表，`producer.pulse_wire()` 读它、
递归算出「表 → 区」、重建全部触发器。以后视图改了，重跑一次 `pulse_wire()` 就对上。

| 区 | 对应视图 | 谁在订阅 |
|---|---|---|
| `board` | `v_pa_pursuits` | App.jsx 的看板 |
| `thread` | `v_pa_pursuit_thread` | PursuitFocus 的对话 |
| `deliv` | `v_pa_deliverables` + `v_pa_attachments` | PursuitFocus 的产出/附件 |
| `misc` | 推导不出归属的表落这儿 | 没人订阅（留着好查账） |

### 归属漏配这件事，怎么保证不会静默

拆区最大的风险是「某张表该刷新却没刷新，而且不报错」。两道闸：

- **归属由 SQL 从真实视图定义推导**，不是我手打的名单。
- **前端用了没注册过的区名，`onPulse` 立刻抛错**——漏配在你第一次打开那个页面时
  就炸出来，不会变成几周后才发现的「这一栏怎么不更新」。

落进 `misc` 的表（address_verdicts、mail_label_audit、contact_emails、
letter_verdicts、message_tags、cue_*、tasks、profile、contact_orgs）逐张核过：
它们对应的页面**现在本来就不轮询**（打开加载一次、操作后重载），所以不倒退。

## 修完的量级（这次有实测支撑）

`rule_pass` 那 576 次/天 → 约 0（新地址才写，实测约 9 个/天）；
且 `address_verdicts` 归 misc，连那 9 次也不再惊动看板。
剩下的拨动主要来自真新邮件/新消息，每次 78 KB 而不是 161 KB。
