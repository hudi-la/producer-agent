# 一封信怎么归类

> 开发文档。**判据的唯一出处**——改判据之前先改这份，别只改代码。
> 最后核对：2026-08-19，全库 3519 封逐封问过 Gmail。

## 一句话

**账本的真假认 Gmail 的 `labelIds`，不认形态。**

「没有主题就是草稿」这类形态推测**错过一次**：22 封嫌疑里 6 封是真信，
而回信的草稿会继承 `Re:` 主题，那一批一条都没被认出来。
只有 Gmail 的标签是权威。

## 三张表，各答一个问题

| 表 | 答什么 | 一行是什么 |
|---|---|---|
| `producer.mail_headers` | **这封信是什么** | 生的账本，Gmail 信头全量，机械抓来不加判断 |
| `producer.pursuit_messages` | **它属于谁、算不算往来** | 认领之后提拔进来的对话表 |
| `producer.mail_label_audit` | **Gmail 说它是什么** | 逐封核过的 `labelIds`，判真假只认它 |

## 入库前的四道闸（`brain/mail/addr.js` 的 `classify`）

按顺序，任何一道不过就**不入库**：

| 闸 | 判据 | 为什么 |
|---|---|---|
| ① 认得出发件人吗 | `From` 解得出地址 | 认不出就没法归属，而猜就是 `0033` 犯的错 |
| ② 算得出时间吗 | `internalDate` 或 `Date` 头 | `sent_at` 是 not null，宁可不进也不要假日期 |
| ③ **是不是草稿** | `labelIds` 含 `DRAFT` | 没发出去的不是往来 |
| ④ **我发的，发出去了吗** | 我发的必须有 `SENT` | 定时发送写好排着队，`sent_at` 是未来 |

③④ 治的是同一件事：**没发生的事不能当成发生了。**

> 真事一：Ana Herruzo 名下挂了 5 封，实际只发过 1 封。四封是草稿自动保存——
> 改一次存一次，各得一个新 message id，收信循环每 5 分钟一轮、一轮抓一份。
> 后果不只是数字难看：「发出去 N 天没回音」从**第一次存草稿**那刻开始算，
> 直接把 Brooke 那条线顶到「碰满三次，停了」——等于劝你放弃一条还活着的线。
>
> 真事二：一封「Zoom meeting」`sent_at` 是 8/25，8/18 就已经算作发出去了。

**方向的判据**：`From` 是我的地址 → `out`，否则 `in`。
我发给我自己的，对面就是我自己，记 `out`。

## `kind` 是什么意思

`producer.pursuit_messages.kind`：

| 值 | 是什么 |
|---|---|
| `email` | **一封真信**（收的或发的）。由头、往来计数、消化，认的都是它 |
| `message` | 你跟 Fairwind 的商量。**没有 `gmail_message_id`** |
| `gmail_draft` | 草稿 / 定时发送。留着，但不算往来 |
| `brief` | 建卡时它写的那份「讲懂这个机会」 |
| `draft` | Fairwind 起草的东西（不是 Gmail 草稿，别混） |
| `note` / `meet` / `decision` | 你手记的：一笔备注、一次见面、一个决定 |

> **踩过的坑**：真信一度被写成两个 `kind`——803 封 `message` + 29 封 `email`，
> 四项属性完全相同。而所有读 `kind='email'` 的代码（往来角标、名片上的往来
> 计数、找最后一封、三栏布局、消化）想的都是「一封信」，**没有一处**把
> `message` 当成「不是信」。`pa_add_mail` 写死 `'message'` 是从 `0038` 抄到
> `0061`、五支迁移没一行注释解释过。`0076` 统一成 `email`，一次修好六处。

## 一封信属于哪条线

**不是 `pursuit_id`。** 很多信靠班底 / 串登记**推导**挂到线上，
`pursuit_id` 是空的。判据是 `v_pa_pursuit_mail.on_this_line`
（`0052`/`0053`/`0055`）。

**这个坑踩过三次**，三处口径各不相同：

| 哪儿 | 修在 |
|---|---|
| `pa_subjects_for_rejudge` 重判读的信 | `0080` |
| `fetchMessages` 对话里显示的信 | `0086` |
| `v_pa_cue_facts` 事实视图 | 一开始就是对的 |

> ASU 那条线按 `pursuit_id` 挂着 31 条、**其中是信的 0 条**；推导算这条线的
> 有 16 封。12 条有信的线里只有 1 条读得全，一共 49 封信在对话里看不见。

**凡是问「这条线上有哪些信」，一律走 `on_this_line`。**

## 原文和摘要不是一回事

- `body_raw` = Gmail 取回来的**原文**
- `content` = 有时候是人写的**中文摘要**

界面上读 `body_raw || content` 会让摘要冒充原文，而且它背后没有更长的可展开，
「展开原文」那个按钮也不出现——同一个框两种行为，从外面看不出为什么。

**规矩**：没有 `body_raw` 就打「摘要 · 原文没存下来」的标。
缺原文的用 `pa_letters_missing_body()` 找出来，从 Gmail 补
（`0085` 补过 21 封，全库现在每封都有原文）。

## 「这是不是一封信」只有一个判据

```
kind = 'email'          ✅
gmail_message_id != null ❌  ——草稿也有
```

`gmail_draft` 出现那天（`0075`），第二个判据**在所有用它的地方同时变错**，
而没人扫过一遍谁在用它。于是同一件事修了四次，每次只修被指出来的那一处：

| 哪儿看得见 | 修在 |
|---|---|
| 抽屉里的对话 | `0086` |
| 左栏卷宗 / 人卡的往来 | `0089` |
| 「相关的人」的封数 | `0090` |

**改判据的时候先扫，再改：**

```sql
select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where relkind='v' and n.nspname in ('public','producer')
   and pg_get_viewdef(c.oid) ~* '<旧判据>';
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','producer') and prokind='f'
   and pg_get_functiondef(p.oid) ~* '<旧判据>';
```

前端那一份收在 `src/lib/letter.js` 的 `isLetter` / `isExchange`，带测试。
**组件不许各写各的**——已经忘了四次。

## 两个同名的 `classify`（读代码的坑）

`brain/mail/` 下有两个导出叫 `classify`，干的是完全不同的事：

| 在哪 | 判什么 | 谁在用 |
|---|---|---|
| `addr.js:132` `classify(msg, mine)` | **一封信** → 一行 `mail_headers`。四道闸在这儿 | `sync.js` |
| `classify.js:106` `classify({rounds})` | **一批地址**是不是真人 | `loop.js` / `classify-run.js` |

改「信怎么归类」要改的是 **`addr.js`** 那个。

## 标签在收信时就记下来

`classify` 手里本来就有 `labelIds`，所以它一路带到 `pa_mail_headers_upsert`，
顺手写进 `mail_label_audit`。**账本从此是自审的**——不用再靠谁记得去扫全库。

（`0087` 之前不是这样，所以每来一封新信，自查的第一条就会挂。）

## 要重核的时候

```
pa_mail_ids_page(after, limit)   → 还没核过的信头，分页取
pa_record_labels(rows)           → 把 Gmail 的 labelIds 记进审计表
pa_outgoing_to_verify()          → 所有还没标过的发出信
pa_letters_missing_body()        → 缺原文的
pa_fill_body(id, body)           → 补原文（空正文不写）
```

**必须分页。** PostgREST 默认封顶 1000 行**而且不报错**——
第一次跑这个审计就中了：3519 封只核了 1000 封，差点报「全核完了」。

## 收工核对

```sql
select * from public.pa_selfcheck()       where not 通过;   -- 17 条
select * from public.pa_selfcheck_reads() where not 通过;   -- 7 条：每个读面 / 每处计数
```

**两个都得全绿才算库是干净的。** 加一条判据的时候这儿也加一条 ——
否则 SQL 那半永远是「我记得是对的」（`0088`）。

自查抓过的真事：删掉一封信**不会**自动重算派生值。
删完记得跑 `pa_recompute_touch`，或者让自查兜住。
