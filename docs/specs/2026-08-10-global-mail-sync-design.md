# 全局邮件同步：换掉水管，让信自己进来

> 上游事故：手动发出去的六封树皮书邮件、三封回复，「更新最新信息」一封都收不到。
> 相关：[2026-08-05 三栏与邮件](2026-08-05-focus-three-column-and-email-design.md)、[2026-08-08 人际管理](2026-08-08-people-layer-design.md)

## 一、这一刀在修什么

按下「更新最新信息」什么都没发生，不是按钮坏了。是**那六封信从来没被系统看见过**。

一条机会线要拿到 Gmail thread，只有两条路（`brain/server.js` 的 `ensureThreads`）：

1. 你在系统里起草过那封信 —— `handleGmailDraft` 把 `thread_id` 落进 `pursuit_threads`
2. 库里已经有带 `gmail_message_id` 的信 —— 拿 message id 反查 thread

这是个**死结**：反查需要库里先有信，而信要进库先得有 thread。你在 Gmail 里手动发的信两条都不占，于是 `ensureThreads` 返回空，`handleSync` 直接 `added: 0` 走人。

数字比故事更清楚：

| | |
|---|---|
| 机会线总数 | **65** |
| 其中登记过 thread 的 | **3** |
| 库里的邮件 | 34 封 |
| 「还不认识的地址」 | **0** |

「0」不是干净，是**从来没有信进来过**。62 条线在邮件这一层是瞎的。树皮书那六封只是你恰好注意到的那几封。

### 归属层其实早就准备好了

`pa_add_mail` 判断一封信是谁的，**完全按 `counterpart_email` 查 `contact_emails` / `org_mailboxes`**，跟 thread 没有半点关系。`pursuit_id` 是调用方另外传进来的参数，函数自己根本不关心。

也就是说 0037/0038 那一刀立的「归属由地址决定」已经是全局的了。**缺的只是进货口。**

`pursuit_threads.last_history_id` 这一列 2026-08-05 就建好了，注释写着「上次同步到哪，下次只拉之后的」——至今一行没写过，因为 claude.ai 的 Gmail 连接器给不出 historyId。**当初的设计是对的，是水管配不上。**

## 二、换水管：抓取和理解分开

现在 Gmail 只有一条路——claude.ai 的连接器，而那套工具只有模型能调（`GMAIL_TOOLS` 白名单全在 `think()` 里）。所以每取一批信都要花一次模型往返，抓取和理解焊死在一起。

**这不是技术限制，是接线方式。** brain 是跑在本机的 Node 进程，它可以自己拿 OAuth 凭证直连 Gmail API。接上之后账是反的：

| 干什么 | 谁干 | 代价 |
|---|---|---|
| 列出所有信 | `messages.list` | 一次请求 500 条 id |
| 拿信头 | `messages.get?format=metadata` | 机械，不过模型 |
| 只拉变化的 | `history.list?startHistoryId=…` | 首次全量之后每轮只拉增量 |
| 判断这个地址是谁 | 模型 | **只在剩下的那一小撮地址上** |
| 拉正文 + 摘要 | 模型 | **只在你认领之后** |

全量回填一次几万封，是几分钟的 HTTP，模型一次都不出场。

### 认证：OAuth，而且必须发布到 production

用 `googleapis` + OAuth2 desktop 流程，scope 只要 `gmail.readonly`（**只读**——这个系统本来就发不出信，草稿走的是另一条路，不给写权限就是结构上做不到）。

**一条必须踩对的坑**：OAuth 同意屏幕的发布状态如果停在 **Testing**，Google 发的 refresh token **7 天就过期**。停在那儿意味着这个天天在用的系统每周挂一次。发布状态必须设成 **In production**（未经验证也可以，自己用会看到一个警告页，点过去就行），token 才是长期的。

Token 仍然会在这几种情况下失效，代码必须认得出来并说人话：

- 你改了 Google 密码（**含 Gmail scope 的 token 必失效**，这条最容易撞上）
- 6 个月没用过
- 你主动撤销了授权

失效时的表现必须是「Trouble 上一条明确的『Gmail 授权掉了，跑一次 `npm run mail:auth`』」，**不是静默的 0 封新信**——那正是这次事故里最伤人的部分。

### 多邮箱：结构现在做，线以后接

现在整个系统假设你只有一个地址（`mailboxOf(profile)` 返回单个 `profile.data.email`），而「对面是谁」的判据是**「不是我自己那个地址的那一方」**。

CalArts 的机构邮箱以后要接。**结构现在就按 N 个地址做**——把单值换成一张 `mail_accounts` 表是二十来行的事；等库里躺了几万封信再加第二个地址，每一封的「对面是谁」都得重算。

现在只插一行（hudi.creates@gmail.com），但判据从第一天起就是「**不是我任何一个地址的那一方**」。

## 三、信头和消息是两张表

这是这一刀最要紧的一个结构判断。

**不要把几万条信头塞进 `pursuit_messages`。**

`pursuit_messages` 是**对话**表：界面渲染它、`pa_brain_context` 把它喂给模型、`v_pa_unknown_senders` 从它算待认地址。往里灌三万条订阅通知，上面每一样都会被毒死。

所以分两张：

- **`mail_headers`** —— 生的账本。机械抓来的信头，全量、完整、不加判断。
- **`pursuit_messages`** —— 熟的对话。只有**被认领过**的往来才会进来，一如现在。

一条信头**被提拔**进 `pursuit_messages` 的时机只有一个：**它的地址被你认领了，或者它的 thread 被挂到某条线上**。提拔的时候才去拉正文、才让模型写摘要。

这样：
- 全量进货不污染任何已有的东西
- 「按需拉正文」有了明确的边界——认领是那个边界
- 已经建好的归属层（`pa_add_mail` / `pa_claim_email` / `v_pa_unknown_senders`）一行都不用改

### 一个必须在开闸前补的洞

```
pm_gmail_uniq         unique (pursuit_id, gmail_message_id) where gmail_message_id is not null
pm_gmail_contact_uniq unique (contact_id,  gmail_message_id) where contact_id is not null
```

Postgres 里 NULL 彼此不相等。一封**既没挂线、也没认出人**的信——恰恰是全局同步会大量产生的那种——**两个唯一索引一个都管不住**。`pa_add_mail` 的 `on conflict do nothing` 形同虚设，每跑一轮就重复插一份。

补一条把 NULL 也算进去的唯一索引。库里现在没有重复行，收紧是安全的。

## 四、数据结构

```sql
-- 我的信箱。现在一行，结构装得下 N 个。
producer.mail_accounts (
  id            uuid pk,
  address       text not null,        -- lower，唯一
  label         text,                 -- '主号' / 'CalArts'
  history_id    text,                 -- 上次同步到哪
  last_synced_at  timestamptz,
  backfilled_at   timestamptz,        -- null = 还没全量回填过
  active        boolean default true
)

-- 生的账本：信头全量落地，不判断、不筛选。
producer.mail_headers (
  gmail_message_id text pk,
  account_id       uuid not null → mail_accounts,
  gmail_thread_id  text not null,
  from_email       text not null,     -- lower
  from_name        text,
  to_emails        text[],
  cc_emails        text[],
  subject          text,
  sent_at          timestamptz not null,
  counterpart_email text not null,    -- 算出来的：不是我任何一个地址的那一方
  direction        text not null,     -- 'in' | 'out'
  bulk             boolean default false,  -- List-Unsubscribe / Precedence / no-reply
  promoted_at      timestamptz        -- 已经提拔进 pursuit_messages
)

-- 每个地址的判定。你的翻案永远压过自动判定。
producer.address_verdicts (
  email        text pk,               -- lower
  verdict      text not null,         -- 'person' | 'bulk' | 'machine' | 'unsure'
  business     boolean,               -- 跟你这摊事有关吗
  why          text,                  -- 人话理由，给你看的
  name         text, org text, role text,
  decided_by   text not null,         -- 'rule' | 'fairwind' | 'you'
  decided_at   timestamptz,
  greeted_at   timestamptz            -- 已经端到你面前过了，别重复打扰
)
```

`decided_by='you'` 的行**永远不被自动判定覆盖**。这是翻案的落点。

## 五、三层漏斗

判断的单位是**地址**，不是邮件。地址比邮件少两个数量级，而且判一次永远算数（`pa_claim_email` 已经是这个语义：认领一个地址，它名下所有历史往来当场归位）。

**第一层，信头就能判掉（纯 SQL，零成本）：**

- `List-Unsubscribe` 头存在 → 群发。**这一条干掉绝大多数订阅、通知、营销。**
- `no-reply@` / `noreply@` / `donotreply@` / `notifications@` / `mailer-daemon@` / `bounce`
- `Precedence: bulk`、`Auto-Submitted: auto-generated`
- 域名归堆：一个域名下多个发件地址、你一封都没回过 → 整域判掉

**第二层，最强的正面信号（纯 SQL）：你有没有发过信给他。**
`direction='out'` 到那个地址。你主动写过信 = 真关系，几乎不会错。

**第三层，剩下的残渣才交给 Fairwind。** 主要是「他写给你、你没回」的那些——冷邮件、策展人来信、机构邀约。**这一层最不能漏，因为漏掉的都是曾经找过你而你错过的人。**

送过去的不是邮件，是一张地址卡：地址、署名、域名、最近五个主题行、来往封数、首末日期。约 150 token，五十张一批。

成本（假设第三层剩 1500 个地址，一次性）：

| 模型 | 总成本 |
|---|---|
| Opus 5（brain 现在的默认） | **约 $2.3** |
| Sonnet 5 | 约 $0.9 |
| Haiku 4.5 | 约 $0.45 |

最贵的档也就两块多。之后走 `history.list`，每周新增几个地址，判一次是一次调用。而 brain 挂的是订阅，真实代价是**大约三十次模型调用的额度**——比你按一次「更新最新信息」跑 65 条线还小。

## 六、你看到的是什么

**「还不认识的地址」那一页不再是你要处理的列表。** 它退回后台，变成管道。

你只看一样东西：**它判定是业务相关真人、且还没进通讯录的那几个**，每个带一句为什么——

> **Zoe Chen** ｜ zoe@bampfa.berkeley.edu
> Berkeley Art Museum 的策展人。2025-03 写信约你聊驻地的事，你没回。之后没再来往。

点头 → `pa_upsert_contact` + `pa_claim_email` → 那个地址名下**所有历史往来当场归位**，然后去拉这些信的正文、让模型写摘要、走 `pa_add_mail` 进 `pursuit_messages`。

**首次回填和日常分两种节奏**（首次可能一口气一百多个，一个个点是另一种苦差事）：

- **首次**：列成一屏，默认全勾，你扫一眼取消掉不要的，一次点完
- **日常**：一个一个来，跟现在的「加人」一个形状

### 判掉的一个都不删

一个搜索框，加一句：

> 它判掉了 2847 个地址，多半是订阅和通知。搜一下，看看有没有冤枉的。

搜到了可以直接翻案，翻案写 `decided_by='you'`，此后自动判定再也不碰它。

**这一条是硬要求。** [never-lose-data](../../MEMORY.md) 说的是「看不见等于丢了」——AI 静默判掉一个真人，跟丢了没有区别。区别只在于：现在那一页是个**待办清单**，改完之后是个**档案柜**。你不需要清空它。

## 七、必须说话

这次事故里真正让你以为「坏了」的那一半，是 `handleSync` 其实返回了一句实话（「这条线还没有任何邮件往来」），而 `runRefresh` 把 `note` 整个丢掉了——进度条走完，屏幕上一点动静没有。

所以不管哪一步，**每一轮都要报「跑了什么、拿到几封、判了几个」，包括 0**：

- 回填：`回填中 3200/18000`
- 增量：`收到 4 封新信，2 个新地址待认` / `没有新信`（**这句也要出现**）
- 授权掉了：Trouble 上一条明确的话 + 怎么修

## 八、这一刀不做的

- **不接 CalArts。** 结构装得下，线以后再接。
- **不改「更新最新信息」按线跑的形状。** 它仍然按线收，只是现在线能通过 thread 找到信了。
- **不动 `pa_add_mail` / `pa_claim_email` / `v_pa_unknown_senders`。** 归属层是对的，这一刀只给它接上进货口。
- **不给写权限。** scope 只有 `gmail.readonly`。发信这件事的护栏一动不动。

## 九、验收

1. `npm run mail:auth` 走一次授权，token 落地
2. 全量回填跑完，`mail_headers` 有实数，进度报得出来
3. 三层漏斗跑完，`address_verdicts` 有实数，第三层的模型调用次数和耗时报得出来
4. 「等你点头」那一屏列得出人，每个有一句人话理由
5. **树皮书那六封发出去的信和三封回复，认领之后出现在对应机会线上**
6. 再按一次「更新最新信息」：那几条线不再是 `added: 0`
7. 判掉的地址搜得到、翻得了案
8. 断网/撤销授权，Trouble 上说的是人话而不是静默 0 封
