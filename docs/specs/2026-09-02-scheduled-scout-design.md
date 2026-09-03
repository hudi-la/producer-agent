# 周更找机会搬进 Fairwind（定时造卡任务）

> 日期：2026-09-02。状态：**设计稿**。
> 承接 [2026-08-01 总稿](2026-08-01-artist-producer-agent-design.md)「入口：scout」那一节，和
> [2026-08-13 骨架/血肉](2026-08-13-skeleton-and-flesh-design.md)（提示词是血肉）。
>
> **指代，全文一律**：**你** = Di Hu；**Fairwind** = agent；**脑子** = `brain/`，跑在你 Mac 上的那个进程。

---

## 〇、现在是怎么跑的，哪儿不对

你在 claude.ai 里挂着两条每周定时任务：「每周找聚合源」「每周找 Open Call」。它们扫聚合站、按画像筛，
把结果写进一个 Excel（那个 Excel 现在已经不在盘上了），再给你一条消息。然后**你**每周把消息里的东西
贴到这儿来，让我手动造卡。

三处不对：

1. **中间有一段人肉搬运。** 找到的机会要经你的手才能变成卡，你不搬就没有。
2. **提示词改不了。** 画像、来源、筛选规则全写死在 claude.ai 那条任务里，Fairwind 这边看不见、改不到。
3. **「造卡任务」面板是假的。** 开关拨不动，「每周」只是个字，上次跑出什么靠我手填。

## 一、一句话

脑子按点跑造卡任务：读库里那条任务的提示词，联网找，把通过的写成卡落进「新机会」；
卡一进来，后台「讲懂」照旧接手；封面上挂一个「新」，你第一次点开就灭。
提示词、每周几点、开不开，都在「造卡任务」面板里改。

## 二、不变量

- **写卡只在脑子里发生，且只走一个新口 `pa_create_pursuit`。** Fairwind（模型）拿到的工具还是 WebSearch / WebFetch，
  没有写库的工具。它把找到的机会按格式**报**出来（`[[CARDS]]` 信封，同 `[[LETTER]]` 那套），脑子解析、去重、落库。
  「Fairwind 碰不到数据库」这条护栏一个字不动。
- **提示词是血肉，跑法是骨架。** 画像、来源、筛选规则存在 `producer.tasks.prompt`，你在面板里改；
  「今天几号、库里已有哪些、按什么格式报」由脑子每次跑的时候补在后面，你看不到也改不到。
- **不丢信息。** 查了但没建卡的，连同原因，写进那条任务的 `last_result`（负面结果也是信息，跟树皮书那批一样）。
  建卡上限（默认 5）截掉的候选也记在里面。
- **不许静默失败。** 脑子没开 = 定时不会跑，面板上必须说这句；跑挂了 `last_result` 写「这轮没跑成：原因」。
- **「新」不是新状态。** 库里早有 `pursuit_seen`（你第一次点开一张卡就落一行）。「新」= 那张卡从来没被点开过
  （`seen_at is null`）。不加表、不加列、不用你按任何东西。

## 三、边界，说在前面

- **脑子得开着。** claude.ai 的定时任务在云上跑，你合上电脑也跑；搬进脑子之后，到点时脑子没开就不跑，
  等它下次开了立刻补跑（`next_run_at` 已过就算到点）。这跟收信是同一条边界，不新增。
- **截止提醒那半截不搬。** 老提示词第二部分「14 天 / 30 天内截止」的提醒，看板本来就在做
  （封面截止行会变红、🔔 通知栏）。再让一条周任务复述一遍是两个「现在」。
- **只搬这两条。** 「盯梢机构」「邮箱进来的机会」「关系降温提醒」照旧「未接」。
  「+ 加一个造卡任务」那个占位这次不做，留着。

## 四、库

迁移 `0119_a_task_runs_on_a_schedule.sql`。

### tasks 表加列

| 列 | 意思 |
|---|---|
| `prompt text` | 你能改的那段提示词（画像 / 来源 / 筛选规则） |
| `run_every text` | `'week'` / `'day'` / null（null = 手动或事件触发，不排期） |
| `run_weekday int` | 0–6，0 = 周日。只在 `week` 时用 |
| `run_hour int` | 0–23，按你住的地方的时间（`producer.app_tz()`，已有） |
| `next_run_at timestamptz` | 下次到点。由 `producer.task_next_run()` 算，改排期就重算 |
| `running_since timestamptz` | 正在跑（脑子认领时写，跑完清空）。超过 2 小时算卡死，可以再认领 |

原来的 `schedule` 文本列留着不删（`'weekly'` / `'手动'`），只当兼容读法；新代码看 `run_every`。
`config.max_new`：一轮最多建几张，默认 5。

### 口子

| 函数 | 谁调 | 干什么 |
|---|---|---|
| `producer.task_next_run(every, weekday, hour, after)` | 库内 | 算 `after` 之后下一个到点，按当地时区 |
| `pa_set_task(id, enabled, prompt, run_every, run_weekday, run_hour)` | 浏览器 | 改一条任务；排期变了就重算 `next_run_at`；只改传了值的 |
| `pa_run_task_now(id)` | 浏览器 | 把 `next_run_at` 拨到现在。脑子每 30 秒看一眼，接手 |
| `pa_tasks_due()` | 脑子 | 到点、开着、有提示词、没在跑的任务 |
| `pa_task_start(id)` | 脑子 | 认领（写 `running_since`），已经有人在跑就返回 false |
| `pa_task_finish(id, result, ok)` | 脑子 | 写 `last_run_at` / `last_result`，清 `running_since`，算下一次 |
| `pa_pursuit_titles()` | 脑子 | 库里已有的 标题 / 机构 / 链接，给去重用 |
| `pa_create_pursuit(...)` | 脑子 | 建一张卡。标题（忽略大小写和首尾空白）或链接已存在就不建，返回 `{created:false, id}` |

浏览器那三个 grant 给 anon（跟 `pa_set_profile` 同级）；脑子那五个只 grant `service_role`，
跟 0009 一个写法。

### 读面

`v_pa_tasks` 加上 `prompt / run_every / run_weekday / run_hour / next_run_at / running_since / config`。
登记脉搏区 `('tasks', 'public.v_pa_tasks')`，重跑 `pulse_wire()`——面板开着的时候能看见「正在跑」变成「新增 3 张」。

## 五、脑子

新文件 `brain/scout.js`，**只有纯函数**（跟 timer.js / judge.js 同一分工），调模型和写库在 server.js。

### 每一轮（`scoutPass`，每 30 秒）

1. `pa_tasks_due()` → 没有就回。
2. 逐条：`pa_task_start` 认领不到就跳过。
3. 拼提示词：`task.prompt` + 脑子补的尾巴（见下）。`think()` 给 `READ_TOOLS`，`maxTurns` 放到 80
   （要开六七个站、搜几轮，20 轮不够）。
4. 从回复末尾解析 `[[CARDS]]`。解析不出 → `pa_task_finish(id, '这轮没跑成：它没按格式报', false)`，
   回复原文进日志。
5. 去重（标题 / 链接对 `pa_pursuit_titles()`，忽略大小写）→ 按星级排、截到 `max_new` →
   逐张 `pa_create_pursuit`。
6. `pa_task_finish(id, 战报)`。战报格式：
   `2026-09-07 新增 3 张：A · B · C。库里已有跳过 2 张：D · E。查了没建卡 4 个：F（vanity，报名费 $80 奖项含糊）· G（限美国公民）…`

卡落进 `stage = 'pending'`，`source = task.type`，`task_id = task.id`。60 秒内 `sweepBriefs` 会读它——
「查一查这个机会」这一步已经有了，不另写。

### 脑子补的尾巴（骨架）

```
== 今天是 2026-09-07（America/Los_Angeles）==
== 库里已经有这些（标题 · 机构），已有的不要再报 ==
…（pa_pursuit_titles）
== 报法 ==
写完给人看的几句话之后，最后一行单独输出：
[[CARDS]] {"cards":[{"title":…,"kind":…,"org":…,"location":…,"funding":…,"deadline":"官方原话或null","deadline_at":"YYYY-MM-DD或null","opens_at":"YYYY-MM-DD或null","url":…,"match_stars":3|2,"why":"中文一句话理由","notes":"英文 notes；当前未开放就以 🟡 关注 · 下轮预计… 开头","eligible":true|false}],"skipped":[{"title":…,"why":"为什么没入"}]}
一张都没有也要输出这一行（两个空数组）。
```

`eligible=false` 的（限美国公民 / 绿卡 / 需当地工作权）**照建卡**，卡上灰掉、写「资格搁置」——
这是老提示词里「待身份变化 Eligibility Hold」页在 Fairwind 里的对应物，早就有了。
「高匹配但当前未开放」也照建，`notes` 以 🟡 开头、`opens_at` 填上；进「新机会」让「讲懂」核一遍，
你再决定拖去「持续关注」。不直接落 `watch`：那一列不读卡。

### 排期怎么算

`task_next_run('week', 1, 8, now())` = 从 `now()` 往后，下一个当地时间周一 08:00。
跑完一轮算下一次时 `after = now()`，所以到点了脑子没开、隔天补跑，下一次仍是下周一，不会漂。

### /health

多带一个 `scout: { at, running, note }`（跟 `mail` 并排）。面板靠它说「脑子没开 · 定时不会跑」。

`BRAIN_BUILD` 拨到 `2026-09-02a`，两边一起。

## 六、界面

### 造卡任务面板

每条任务一行，跟现在一样；**有 `prompt` 的那几条**多两样东西：

- 右侧那个开关是真的了：拨一下 = `pa_set_task(enabled)`。
- 行下面一句排期，人话：「每周一 08:00 · 下次 9/7 · 上次 8/16 新增 5 张」。正在跑就是「正在找……（3 分钟前开始）」。
- 点这一行展开：
  - 排期：`每周 [周几▾] [几点▾]` / `每天 [几点▾]` / `手动`——三个 `<select>`，改完直接存。
  - 提示词：整段显示，**双击进编辑、确定才存**（跟档案页那套 `EditRow long` 一模一样，不另发明）。
    下面一行灰字：「今天几号、库里已有哪些、输出格式，由系统跑的时候补在后面，不用写。」
  - 「现在跑一次」按钮：`pa_run_task_now`，按下去这行变「排上了，脑子一分钟内接手」，然后跟着脉搏变。
- 脑子没开：面板顶上一行 warn（跟 Trouble 同一种长相）：「脑子没开 · 到点不会跑；开了会立刻补跑」。

「上次」那段照旧显示 `last_result` 全文——战报里有查了没建卡的名单和原因。

### 封面上的「新」

`PCard`：`p.seen_at === null` → 标题前一个小圆标「新」。点开卡 → `markSeen` → 灭。
叠头（Stack）：折着时报「N 张新」。

`markSeen` 原来只在 `unread` 亮着时才写库（防自激）。改成 `unread || seen_at === null` 也写：
写一次之后 `seen_at` 就不是 null 了，同一张不会再触发，自激那条路还是断的。

现有库里有 12 张 `pending` 的卡从来没点开过（8/7 那批模特经纪、8/5 几张 artist talk），它们会立刻挂「新」。
这是实话——你确实没点开过。

### 卡的来源

`batchTint` 里「聚合源那批不折叠、不上色」的判据从 `source !== 'scout_aggregators'` 改成
「不是 `scout_` 开头的来源」——新那条 Open Call 任务造的卡同样各是各的机会，不该折成一叠。

## 七、两条任务的内容（血肉）

- **每周找聚合源**（现有那行 `type = scout_aggregators`）：`prompt` = 你 claude.ai 里那段的第一部分，
  去掉 Excel、去掉截止提醒、去掉「用 B 列去重」（去重归脑子）。`run_every = week, weekday = 1, hour = 8`。
- **每周找 Open Call**（新一行，`type = scout_search`）：同一套画像和筛选规则，来源换成 WebSearch 几组关键词
  （open call / residency / grant / prize + installation / new media / socially engaged + 2026/2027 deadline）。
  周一 09:00，错开一小时。

两段都写进 `supabase/demo/0006_seed_tasks.sql`（示范内容）和 `src/demo/tasks.js`（回落）；
真库那两行直接 update / insert。`demo/scout-prompt.md` 改成新的那段，`scout-sync-prompt.md` 删掉——
Excel 那条路彻底没了。

`TASK_DESC` 加 `scout_search`。

## 八、下一步（这次不做）

你问的那句——「找到的机会里，哪些真正适合现在这个阶段、哪些默认期待更资深的申请人」——
先让这套跑两三轮，拿真卡上的「讲懂」和你批 / 停的记录来答；答出来的东西改的是 `prompt` 那段文字，
面板里就能改，不用动代码。

## 九、这些名字是什么意思

| 名字 | 是什么 | 谁在用 | 界面上对应 |
|---|---|---|---|
| `producer.tasks` | 造卡任务清单，一行一条 | 面板读、脑子读写 | 「造卡任务」面板的每一行 |
| `tasks.prompt` | 那条任务的提示词，你能改的部分 | 面板改、脑子读 | 展开后那段大字 |
| `next_run_at` | 下次到点的时刻 | 脑子每 30 秒查 | 「下次 9/7」 |
| `running_since` | 正在跑，从几点开始 | 脑子写 | 「正在找……」 |
| `[[CARDS]]` | Fairwind 报机会用的信封，同 `[[LETTER]]` | 脑子解析 | 看不见 |
| `pa_create_pursuit` | 建一张卡的唯一入口 | 只有脑子 | 「新机会」列多一张 |
| `pursuit_seen` | 你第一次点开某张卡的时刻 | 已有 | 封面「新」的依据 |
| `sweepBriefs` | 脑子后台读「新机会」列没读过的卡 | 已有 | 卡里那段「讲懂」 |
| `scout_aggregators` / `scout_search` | 两条任务的类型，也是卡的 `source` | 看板判折不折叠 | 卡底那个来源点 |
