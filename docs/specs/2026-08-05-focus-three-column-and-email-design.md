# 设计稿：机会线整页三栏 + 把邮件接进来

> 日期：2026-08-05。状态：**已实现**（2026-08-06；文末「缓办」和下面这张表里打 ⬜ 的除外）。
>
> | | |
> |---|---|
> | ✅ 数据层 | [0027](../../supabase/migrations/0027_deliverables_and_threads.sql)：deliverables / pursuit_threads / attachments、`gmail_message_id` 唯一索引 + 回填 23 行、全套 RPC 和权限 |
> | ✅ 三栏 | [PursuitFocus.jsx](../../src/components/PursuitFocus.jsx) + [Dossier.jsx](../../src/components/Dossier.jsx) + [Deliverables.jsx](../../src/components/Deliverables.jsx)；抽屉保持单栏 |
> | ✅ 定稿闭环 | 右→左、左→右都通；规则层是闸；空正文定不了稿 |
> | ✅ 邮件落位 | 信进左栏卷宗，中栏留锚点，两个方向都能跳 |
> | ✅ 三个「在骗人」的显示 | `role='org'` 挂 Fairwind 名字、`role='note'` 挂 Fairwind 名字、倒计时多算一天 |
> | ✅ 抓取器 | 实测 brain 能用 claude.ai 的 Gmail 连接器（见第九节），不用自建 OAuth |
> | ✅ brain 两个新口 | `POST /gmail-draft`（放草稿箱，**不定稿**）、`POST /sync`（按线收信） |
> | ⬜ 从对话里长出产出 | Fairwind 还不会在你说「起一版」时自己建产出——口子（`pa_upsert_deliverable`）开好了，`/chat` 那条路没接 |
> | ⬜ 自动立项 | 读完一封信自动建空产出，还没接 |
> | ⬜ 附件落地 | `attachments` 表建好了，收信还没往里写 |
> | ⬜ 判断层批注 | 定稿时跑一遍、贴一条批注，还没做 |
| ⬜ **收信之后的清理** | 见 6.2 末尾——第一次收信就撞上了 |
> 上游：[2026-08-04 看板七列 + 页面分区](2026-08-04-board-and-layout-design.md)、[2026-08-03 brain sidecar](2026-08-03-brain-sidecar-design.md)
> 样稿（可点）：https://claude.ai/code/artifact/02f95e18-b3c8-49d0-bb68-82a10db4e89e

---

## 这一刀解决什么

两件事，它们其实是一件：

1. **邮件没接**。库里有 20 行 `kind='email'`，全是人手搬进去的；`email_watch` 任务 `enabled=false`、`last_result='未接'`；brain 里的 Fairwind 只有 WebSearch / WebFetch，碰不到 Gmail 也碰不到库。信箱里来一封信，看板上不会有任何反应。
2. **整页只是一条对话流**。真正要交出去的东西（申请材料、回信、表单答案）没有地方待着，它们现在混在聊天记录里，或者根本不在库里。

合起来是同一个病：**这个系统能记事，但不能干活。**

---

## 零、先说清楚现在是怎样

这一节不设计任何东西，只是把事实写下来，因为它是后面所有判断的地基。

**今天真正干活的不是 Fairwind，是终端里的 Claude Code。**

| | 住在哪 | 手上有什么 |
|---|---|---|
| 终端里的 Claude Code | 你的终端 | Gmail MCP、Supabase MCP、读写文件、联网 |
| Fairwind | `brain/server.js` 里的 `query()` | **只有 WebSearch / WebFetch** |

库里那 20 封邮件、CultureHub 那些 note 和 decision、那份 88 词的草稿——一行都不是页面产生的，全是终端里写进去的。**页面到今天为止是一个账本，不是一个操作台。**

所谓「后台自动跑」也没有在跑：scout 是一个 prompt 文件（[scout-prompt.md](../../scout-prompt.md)），要人手动开会话；`email_watch` 未接；同步邮件是手工的。今天的「后台」全是「你找我，我跑一趟」。

这不是设计失误，是还没做。写在这儿是为了别再以为它已经在转。

---

## 一、分工：后台进货，页面加工

| | 在哪儿干 | 干什么 |
|---|---|---|
| **进货** | 后台（终端 / 将来的定时任务） | 扫聚合源、扫信箱找陌生来信、判断值不值得进来、去重、**造卡** |
| **加工** | 页面（brain 里的 Fairwind） | 一条线里面的事：讲懂它、长构想、起草、写信、定稿 |

判据很简单：**要不要你在场。**

进货要跨很多数据、跑很久，结果是「多了几张卡」，你不用在场。加工的每一件事都通向一个你要拍的决定，你必须在场。

这条线切下去，一个原来含糊的东西被分成了两半：

- **按线收信**（这条线登记过的 thread 拉新信）→ **加工**。打开卡时顺手做。
- **扫信箱找陌生来信**（`email_watch`）→ **进货**。它要遍历、要判断、要造卡。

---

## 二、Fairwind 站在哪儿

不按动作列白名单，按**它能碰到谁**划边界：

> **Fairwind 永远只在一条机会线里面干活。**

给它的每个口子第一个参数都是 `p_pursuit_id`。它没有「列出所有机会线」的口，没有 `insert into pursuits` 的口，没有跨线写的口。它被关在你正打开的那条线里——就像今天它够不着数据库一样，是结构上够不着。

三个口子：

| | 函数 | 状态 |
|---|---|---|
| 读这条线的上下文 | `pa_brain_context` | 已有（[0009](../../supabase/migrations/0009_brain_rpc.sql)、[0025](../../supabase/migrations/0025_brain_context_meta.sql)） |
| 在这条线上说一句 | `pa_add_message` | 已有 |
| 在这条线上建 / 改一份 `status='draft'` 的产出 | `pa_upsert_deliverable` | **这一刀新开** |

**定稿、发信、删除、改 stage、改 work_id——都不在里面。那是你的手。**

### 一个不对称：读可以跨线，写不可以

Fairwind 的价值在「记得」，不在「动」。要当共同规划者，它得知道某件作品在别的线上被怎么提过、你以前拒过什么理由、哪个说法已经用在别处了——这些都是**读**。

所以往后扩它的能力，答案基本都在读的那一侧。**它动得越少越好，只要它记得越多。**

（跨线读的范围这一刀不定，先只做单线。记在文末「缓办」。）

---

## 三、三栏

整页（`?p=<id>`）从一条对话流改成三栏。抽屉（drawer）保持单栏不动。

```
┌─ 卡头：标题 ······ 截止 · 球权 · 阶段 ─────────────────┐
├──────────┬───────────────────────┬────────────────────┤
│  卷宗    │       商量            │      交付          │
│  302px   │   minmax(0,1fr)       │      400px         │
│          │                       │                    │
│  事实    │   你和 Fairwind       │  产出清单          │
│  往来    │   的对话              │  （可编辑）        │
│  人      │                       │                    │
│  文件    │                       │                    │
└──────────┴───────────────────────┴────────────────────┘
```

三栏三种性质：**素材 / 商量 / 交付**。

### 卡头：截止和球权并在一起

原来球权的开关在卡头，截止在左栏的提要盒子里。同一条线的两个要害分在两处，而且球权还出现了两次（左栏那份是只读副本）——人会以为是两件事。

现在卡头上是这条线**唯一的死线**和**唯一的开关**，并排。左栏从「事实」直接开始，池子折不折都影响不到它们。

不是每条线都有的提醒（「8/7 没回就催 LOA」「禁言到 9 月」）留在左栏最上面——它们是这条线特有的约束，挤进每张卡都有的卡头会让卡头长短不一。

### 左栏：卷宗

四格，每格是一个**点击开合**的池子（不用 hover：一列全是池子，鼠标滑过去会一路闪。开着的池子标题变琥珀色）。

| 格 | 装什么 |
|---|---|
| 事实 | 原来卡头那排 facts，加上核过的资格 |
| 往来 | **邮件**。一封一行，点开看原文 + 信头。空的时候说人话（「暂时没有」而不是「不适用」） |
| 人 | 联系人 + 关系记忆 |
| 文件 | **定稿**。只放定了的东西 |

**邮件放左栏，不混进中间的对话。** 理由：你和 Fairwind 商量是**可撤销**的，你和机构的信是**不可撤销**的。两种东西混在一条流里人会看错——现在的界面已经在犯这个错（见文末「顺手要修的」）。中间流里需要引用某封信时，插一条极轻的锚点，点它跳到左边。

### 中栏：商量

对话。比现在**稍窄稍小**（`max-width: 600px`，正文 13.5–14px）。

### 右栏：交付

产出清单。详见下一节。

### 断点

`max-width: 1180px` 时三栏叠成一栏（左 → 中 → 右），app 外框不再固定高度。

---

## 四、产出模型

### 「定稿」是右栏唯一的动词

> **右边全是没定的，左边全是定了的。中间只有一个动作：定稿。**

所以右栏底下不放「复制」「从档案重新取」「打开表单」这类按钮——它们是工具，不是状态，混在一起人不知道按哪个才算数。次要动作（打开表单）降级成 meta 行里的一个链接。

左栏每一行 hover 出现**取消定稿**，退回右边继续改。**改的还是同一份东西，不产生第二个版本。**

去处写在每份产出上：文字类「定稿后去 左栏 · 文件」，邮件类「发出后去 左栏 · 往来」。**信不进文件格**，它本来就是往来的一部分。

### 产出的三条来路

| | 谁发起 | 例子 |
|---|---|---|
| **从对话里长出来**（主路） | 你在中栏说「起一版」 | Fairwind 不回你一段聊天，它**建一份产出**，对话里只留「起好了，在右边」+ 一条锚点 |
| **从规则里自动立项** | Fairwind 读完一封信 / 一份 brief | Mattie 8/3 那封写着「8/11 前交 6 样素材」→ 自动建一份空产出，带到期日和 6 条规则 |
| **你自己建** | 右栏底下的「+」 | 空白一份，你写标题和规则 |

第二条是**自动化真正该发生的地方**：自动的是**立项**，不是**写**。漏掉一件要交的东西，比写得不好严重得多。

产出要记住自己出自哪段对话（起自 8/5 那段），点得回去。**对话是动词，产出是名词。**

### 规则层是闸，判断层是批注

这是把「AI 发现硬伤要告诉我」拆开的结果——那里面其实是两种完全不同的检查：

| | 是什么 | 什么时候跑 | 拦不拦 |
|---|---|---|---|
| **规则层** | 字数、词数、页数、附件大小、必填项、截止时区 | **实时**，你打字的时候就在动 | **拦**。规则没过，「定稿」是灰的，旁边写着差在哪 |
| **判断层** | 「你把 liminal 换成 threshold 了，而面谈里他追问过这段」 | 你按定稿时 | **不拦**。东西已经进去了，批注贴在旁边 |

规则层**不该由 AI 猜**。Solitude 要 1000–1500 字符、bio 400 字符、PDF ≤10 页 / 10MB；CultureHub 要 50–100 词、6 样素材——这些是死规则，写进产出的 `rules` 字段，前端自己算。

判断层不拦的理由：草稿箱本来就不会自己发出去，拦住你只是烦人。

### 挡住了，就明说挡在哪

不让 Fairwind 硬写一版占位——它写了你也得推翻重来。产出栏直接说**挡在哪一句话上**，而且那句话**可以点回中栏对话里的原处**。

挡住的东西之间有**次序**：作品构想没定稿，概念文本和呈现形式说明都在等它。所以构想那份上标着「另外 3 份在等它」，你一眼知道该先动哪个。

### 邮件是唯一的例外

文字类产出，定稿就到左边了。邮件不行，它的定稿分两步：

1. **放进 Gmail 草稿箱**（你在页面上按的）→ 写 `kind='draft'` + `meta.gmail_draft_id`
2. **真的发出去**（你在 Gmail 里按的）→ 下次同步收回来，写 `kind='email'`

**只有第二步发生了，球权才翻。**

这条必须硬。球权是视图按 `kind='email'` 算的（[0021](../../supabase/migrations/0021_ball_two_states.sql)）——要是放进草稿箱就当你回了信，那条线立刻显示「等回复」，而信还躺在草稿箱里没人收到。**系统会替你撒一个你察觉不到的谎。**

Google OAuth 的 scope 只申请 `gmail.readonly` + `gmail.compose`。`compose` 只能建草稿，**在 Google 那边就没有发送这个能力**——不是嘱咐它别发，是它拿不到那个口。

---

## 五、「主打作品」不是一个下拉框

原来那一栏是从档案的 11 件里挑一件。但真实发生的事情不是挑，是**长**：ECR → 线上版 → 靶子朝木偶还是朝平台。最后要投出去的东西不在那 11 件里，它只存在于这条线的对话里。

所以：

- **作品构想是右栏的一份产出**，和别的产出一样有草稿、有定稿、有挡住的理由。
- `pursuits.work_id` 的语义改成 **「这份构想的源头是哪件」**（可空——全新的想法没有源头）。
- 它由**你**来定（跟 stage / 球权 / 定稿同类），走前端直连的 security definer 函数，**不经过 brain**。Fairwind 可以在对话里说「我建议用 ECR」，但它连 `work_id` 都碰不到。

留一条路（这一刀不做）：**中选了、东西真做出来了，这份构想应该回流进 `producer.works`。** 现在档案是只进不出的，机会线的成果回不去。

---

## 六、邮件同步

抓取器是可换的（MCP / Gmail API / 转发），**落库的形状不可换**。下面全在讲形状。

### 6.1 一条线怎么知道哪些信是它的

不猜。明确登记：

```sql
create table producer.pursuit_threads (
  pursuit_id      uuid references producer.pursuits(id) on delete cascade,
  gmail_thread_id text not null,
  last_history_id text,          -- 上次同步到哪
  last_synced_at  timestamptz,
  added_by        text,          -- you | fairwind
  primary key (pursuit_id, gmail_thread_id)
);
```

一条线可以有多个 thread（CultureHub 至少两串：入围/邀请那串、LOA 那串）。

同步只做一件事：**对登记过的 thread 拉新消息。永远不遍历信箱。**

### 6.2 怎么认领

| 入口 | 谁发起 | 要不要问你 |
|---|---|---|
| 你贴一个 Gmail 链接，或点卡上的「从信箱找找这条线」 | 你 | 列 3–5 个候选，你勾 |
| 来信地址 = 这条线已登记的联系人邮箱 | 系统 | **不问**，直接挂 |
| 陌生来信 | 系统（进货侧） | 进「进来的信」收件区，Fairwind 读完给判断，**你点头才造卡** |

第三条是唯一需要遍历信箱的动作，所以它单独一个开关、单独一个收件区，跟日常同步不共用一条管子。

> **2026-08-06 补：认领可以自举，不用你去贴链接。**
> 库里每条邮件都存了 `gmail_message_id`，而 Gmail 的 `get_message` 能从 message id 反查出 threadId。
> 所以只要这条线有过一封信，`ensureThreads()` 就能自己把那几串认领上。
> 这堵住了一个当场就露出来的矛盾：**池子里明明摆着 5 封信，却说「没处可收」**。
> CultureHub 那条线实测：反查出 5 串，一次收回 4 封新的。

> **⬜ 但收完之后没人管旧的。**
> 那次收信收到了 8/5 CultureHub 的回信——LOA 日期已改好、等签字。
> 于是卡上两样东西当场过期了：`next_touch_at = 8/7`（「没回就催」，人家回了）
> 和右栏那份《催 Mattie · LOA 还没回》。
> **「自动立项」得配一个「自动过期」**，否则跑得越久，卡上假的待办越多——
> 而假的待办比没有待办更坏。这条还没做。

### 6.3 怎么保证不重复

`meta.gmail_id` 现在是 jsonb 里的一个键，插两次没人拦。改成一列 + 唯一索引：

```sql
alter table producer.pursuit_messages add column gmail_message_id text;
create unique index pm_gmail_uniq on producer.pursuit_messages (gmail_message_id)
  where gmail_message_id is not null;
```

**现有 20 行的 `meta->>'gmail_id'` 必须回填进这一列，一行都不能丢。**

这样同一封信插两次会被**数据库**挡掉，而不是靠 LLM 记得自己拉过——跟「Fairwind 改不了 stage」是同一种保证。

### 6.4 存什么，以及顺序

> **先落原文，后写摘要。顺序不能反。**

1. 第一步纯机械：信头（谁、给谁、何时、主题）、正文原文、附件，直接入库，**不经过任何 LLM**。这一步不会出错，也不会因为脑子没开就丢信。
2. 第二步才是摘要：Fairwind 读原文写一句中文摘要，写进 `content`。这一步失败、超时、没跑，行还在，界面显示原文首段。

反过来做（先让 LLM 读、它输出什么就存什么），脑子一挂那封信就永远不存在了。

**原文要存**，三个理由：Gmail 里的信你可能删；LOA 那份合同现在只存在于一封信的附件里；以及那条规矩——已有信息不许消失。

**附件落进左栏文件格。**

### 6.5 什么时候跑

| 档 | 触发 | 这一刀做不做 |
|---|---|---|
| 1 | 你在卡上点「收信」 | ✅ |
| 2 | 打开卡时，距上次同步 > N 分钟就后台悄悄拉一次 | ✅ |
| 3 | brain 每 5 分钟轮一遍活跃的线 | ⬜ 缓办 |

第 2 档很划算：不用常驻、不用 cron，但用起来已经很像自动的了。

### 6.6 出去的不回流

库是唯一真相，外面的都是镜像。方向：

- **进来的**（Gmail → 库）：邮件、附件、日历。
- **出去的**（库 → 外面）：Gmail 草稿箱、表单答案、导出的 md。**出去了就不回流**——你在 Gmail 里手改了草稿，库里那份不跟着变；只有你真按了发送，下次同步把它当成一封新信收回来。

### 6.7 同步状态必须看得见

每条线显示「上次收信 8/5 14:03」。失败要在 [Trouble](../../src/components/Trouble.jsx) 那条上说话。

**静默失败是最坏的情况**——你会以为没新信，其实是同步断了三天。这个病犯过一次（「讲懂」改成后台扫之后整整一天没有一张新卡被读过，谁也没发现），别犯第二次。

---

## 七、数据模型草案

```sql
-- 产出
create table producer.deliverables (
  id          uuid primary key default gen_random_uuid(),
  pursuit_id  uuid not null references producer.pursuits(id) on delete cascade,
  kind        text not null,            -- concept | statement | bio | email | form | file | idea
  title       text not null,
  body        text,                     -- md
  rules       jsonb not null default '{}'::jsonb,   -- {chars:[1000,1500]} / {words:[50,100]} / {mb:10,pages:10}
  status      text not null default 'draft',        -- draft | final
  blocked_by  text,                     -- 挡在哪句话上（人话）
  blocked_ref uuid,                     -- 指向 pursuit_messages.id，点它跳回对话
  depends_on  uuid references producer.deliverables(id),  -- 次序
  source      text,                     -- 料从哪来（"档案里的英文 bio，一字未改"）
  source_msg  uuid,                     -- 起自哪条消息
  due         date,
  meta        jsonb not null default '{}'::jsonb,   -- {gmail_draft_id, form_url, …}
  created_by  text not null default 'fairwind',     -- fairwind | you | rule
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index deliverables_pid_idx on producer.deliverables (pursuit_id, status);

-- 定稿归档到左栏文件（final 的 deliverable 就是文件；附件另存）
create table producer.attachments (
  id          uuid primary key default gen_random_uuid(),
  pursuit_id  uuid not null references producer.pursuits(id) on delete cascade,
  filename    text not null,
  mime        text,
  bytes       bigint,
  storage_key text,                     -- Supabase Storage
  from_msg    uuid,                     -- 来自哪封信
  created_at  timestamptz not null default now()
);
```

`pursuit_messages` 加：`gmail_message_id`（见 6.3）、`body_raw`（原文）。

---

## 八、明确不做（YAGNI）

- **产出的版本历史**。取消定稿改的是同一份，不生第二个版本。你不会去翻历史。
- **自动发信**。Google scope 里就没有。
- **日常同步遍历信箱**。只拉登记过的 thread。
- **7×24**。brain 先只在这台 Mac 上。同一段拉取逻辑将来能原样搬去 Edge Function，因为它只依赖 token + service_role。
- **跨线读**。这一刀 Fairwind 只看得见单线。

---

## 九、抓取器：已验证

**2026-08-05 实测：brain 里的 `query()` 能直接用 claude.ai 的 Gmail 连接器。**

三次探针（`brain/_probe*.mjs`，已删）：

1. `system/init` 里 `mcp_servers` 含 `claude.ai Gmail`，状态 `pending`（懒连接）。
2. 让它去用 Gmail，它自己 ToolSearch 找到了 `mcp__claude_ai_Gmail__list_labels` 并发起调用——**只被权限拦住**（无头会话弹不出确认框）。
3. 把工具名显式写进 `allowedTools`，**读到了 9 个标签**。

结论：

- **不需要自建 Google OAuth**，不用 Cloud project、不用管 token 刷新。
- 护栏比原计划更硬：那个连接器的工具集里**根本没有 send**，只有 `create_draft` / `update_draft` / 一堆读的。「发不出去」不是我们关掉的，是这个能力不存在。
- brain 里的白名单从 `['WebSearch','WebFetch']` 扩成：

```js
allowedTools: [
  'WebSearch', 'WebFetch', 'ToolSearch',
  'mcp__claude_ai_Gmail__search_threads',
  'mcp__claude_ai_Gmail__get_thread',
  'mcp__claude_ai_Gmail__get_message',
  'mcp__claude_ai_Gmail__create_draft',
  'mcp__claude_ai_Gmail__update_draft',
]
```

**注意一个新出现的事实**：Agent SDK 继承了你整台机器的工具配置——不写 `allowedTools` 的话它拿得到 Bash、Write、Supabase MCP。所以那个白名单从「一个稳妥的做法」升级成**必须写死的护栏**，一天都不能省。

---

## 十、顺手要修的

[PursuitFocus.jsx:74-79](../../src/components/PursuitFocus.jsx#L74-L79) 渲染消息时只分两类：`role === 'artist'` 显示「你」，**其余一律显示「Fairwind」**。

于是库里 10 封 `role='org'` 的机构来信，在界面上全都挂着 Fairwind 的名字——Kirk 说的、Sarah 说的、CultureHub 的正式邀请，看起来都像是 Fairwind 说的。

三栏改造会把邮件挪到左栏，这个 bug 顺带就没了。但**在那之前它一直在骗人**，值得单独先修。

---

## 缓办

| | 为什么等 |
|---|---|
| 跨线读 | 单线先跑一轮，再看它到底缺哪些别处的记忆 |
| 后台真的自己跑（scout / email_watch 定时） | 这是第二刀。今天的「后台」是「你找我，我跑一趟」，先别假装它在转 |
| 构想回流进 `producer.works` | 等真有一条线中选并做出来 |
| brain 上云（7×24 / 手机可用） | 逻辑不依赖本机，什么时候搬都行 |
| 扫历史信箱找有价值的人 | 一次性动作，跑一遍就完了，不该混进日常同步，也不用等这一刀 |
