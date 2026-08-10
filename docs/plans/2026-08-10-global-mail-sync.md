# 施工计划：全局邮件同步

设计稿：[2026-08-10 全局邮件同步](../specs/2026-08-10-global-mail-sync-design.md)

**Goal:** brain 自己拿 OAuth 直连 Gmail API，机械抓全部信头进库；三层漏斗把地址判一遍，只把「业务相关的真人」端到你面前点头；点头之后那个地址名下的历史往来才拉正文、才进 `pursuit_messages`。树皮书那六封发出去的信和三封回复，必须能归位。

**不做**：接 CalArts（结构装得下就行）、改「更新最新信息」按线跑的形状、动归属层三个 RPC、给任何写权限。

---

## 0. 先把仓库补齐（独立一刀，跟主线无关）

线上库跑过 0038–0043 和一条 `attachment_files`，**仓库里一份文件都没有**。没有它们谁都重建不出这个库。

从线上 `pg_get_functiondef` / `pg_get_viewdef` / `information_schema` 把定义 dump 出来，补成文件：

```
supabase/migrations/0038_attribution_by_address.sql
supabase/migrations/0039_orgs_in_the_address_book.sql
supabase/migrations/0040_expose_counterpart_email.sql
supabase/migrations/0041_unknown_sender_name_from_their_side.sql
supabase/migrations/0042_address_book_digest.sql
supabase/migrations/0043_address_alone_is_enough_ownership.sql
supabase/migrations/0044_attachment_files.sql   ← 注意线上叫 attachment_files，排在 0043 之后
```

**每个文件顶部注明「补录：线上已跑，此文件是事后补的定义」**，别让人以为它没跑过。

- [ ] 补齐文件，`git commit`
- [ ] 校验：文件里的定义和线上 `pg_get_functiondef` 逐字一致

---

## 1. 0045 迁移：三张表 + 收紧去重 + 端口

> 号顺延到 **0045**（0044 被 `attachment_files` 占了）。

### 1.1 补那个去重洞（**先做，在开闸之前**）

```sql
-- pursuit_id / contact_id 双 NULL 时，现有两个唯一索引一个都管不住。
-- 全局同步会大量产生这种行，不补的话每跑一轮重复插一份。
create unique index if not exists pm_gmail_owner_uniq
  on producer.pursuit_messages (
    gmail_message_id,
    coalesce(pursuit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(contact_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where gmail_message_id is not null;
```

库里现在没有重复行（查过），可以直接建。旧的两个索引留着，无害。

### 1.2 三张表

按设计稿第四节。要点：

- `mail_accounts.address` 建 `unique (lower(address))`
- `mail_headers` 主键 `gmail_message_id`；`(counterpart_email)`、`(gmail_thread_id)`、`(account_id, sent_at)` 各一个索引
- `address_verdicts.email` 主键小写；`decided_by='you'` 的行受保护（在 RPC 里挡，不靠嘱咐）

### 1.3 端口（全部 `service_role`，照 0035 的锁法）

| RPC | 干什么 |
|---|---|
| `pa_mail_account_upsert(address, label)` | 播种/更新我的信箱 |
| `pa_mail_headers_upsert(rows jsonb)` | **批量**塞信头，`on conflict do nothing`，返回真插了几条 |
| `pa_mail_cursor(account_id, history_id)` | 记「同步到哪了」 |
| `pa_mail_rule_pass()` | 第一、二层纯 SQL 判定，写 `decided_by='rule'`，返回各类计数 |
| `pa_address_candidates(limit)` | 第三层要判的地址卡（已在通讯录 / 已判过的不出现） |
| `pa_verdict_upsert(...)` | 写判定；**`decided_by='you'` 的行只有 `'you'` 能覆盖** |
| `pa_mail_promote(email)` | 认领后：取该地址名下所有 `mail_headers`，交给 brain 拉正文 |

读面（`anon`，浏览器直连）：

- `v_pa_greetable` —— 等你点头的：`verdict='person' and business and greeted_at is null and 不在 contact_emails`
- `v_pa_verdict_archive` —— 档案柜，可搜：地址、判定、理由、封数、首末日期

- [ ] 写 `supabase/migrations/0045_global_mail_sync.sql`
- [ ] `apply_migration` 跑上去
- [ ] 校验：`select * from producer.mail_accounts` 有一行 hudi.creates@gmail.com；两个视图查得动

---

## 2. brain/mail/：OAuth + Gmail 客户端（纯代码，不过模型）

```
brain/mail/auth.js     OAuth2 客户端、token 落盘、刷新、失效识别
brain/mail/gmail.js    listIds / getMetadata / getFull / history / profile
brain/mail/addr.js     信头 → {counterpart, direction, bulk} 的纯函数
```

- 装 `googleapis`
- token 存 `brain/.mail-tokens.json`，**加进 `.gitignore`**
- `npm run mail:auth` —— 起本地回调、开浏览器、拿 refresh token 落盘、打印「授权好了，账号是 X」
- scope **只有** `https://www.googleapis.com/auth/gmail.readonly`
- README 里写清 Google Cloud 那几步，**特别是发布状态必须设成 In production**（停在 Testing 的话 refresh token 7 天就死）
- token 失效要抛一个**认得出来的**错（`MailAuthError`），别混在普通 HTTP 错误里

`addr.js` 是纯函数，**先给它写测试**（照 `src/lib/*.test.js` 的形状）：

- 他发给我 → counterpart = From，direction = 'in'
- 我发给他 → counterpart = 第一个不是我的 To/Cc，direction = 'out'
- 我发给我自己 → counterpart = 我，不炸
- 群发给一堆人 → 取第一个不是我的
- `List-Unsubscribe` / `Precedence: bulk` / `no-reply@` → bulk = true
- **多邮箱**：两个地址都算「我」，都不当 counterpart

- [ ] 写三个文件 + `addr.test.js`
- [ ] `node --test` 全绿
- [ ] `npm run mail:auth` 真跑一次，token 落地

---

## 3. 全量回填 + 增量

`brain/mail/sync.js`，两个函数、两个 HTTP 口。

**回填**（一个账号跑一次）：

1. 先 `users.getProfile` 拿当前 `historyId` **记在手上**（先记后拉，宁可下次多拉一点，不能漏）
2. `messages.list?q=-in:chats` 翻页，攒 id
3. `messages.get?format=metadata&metadataHeaders=From,To,Cc,Subject,Date,List-Unsubscribe,Precedence,Auto-Submitted`，并发 ~10，**指数退避**接住 429
4. 过 `addr.js` → 每 500 条一批 `pa_mail_headers_upsert`
5. 完事写 `history_id`（第 1 步记的那个）+ `backfilled_at`
6. 每批报进度：`回填中 3200/18000`

**增量**：

1. `history.list?startHistoryId=X&historyTypes=messageAdded` 翻页
2. 新 id → 同一条信头管线
3. 更新 `history_id`
4. **404（historyId 太老）→ 退回 `q=newer_than:30d` 有界重列**，不要静默失败

HTTP：`POST /mail/backfill`、`POST /mail/sync`。两个都返回真实数字，**0 也要返回**。

- [ ] 写 `sync.js` + 挂到 `server.js`
- [ ] 回填真跑：`mail_headers` 有实数，进度看得见
- [ ] 增量真跑第二次：`added: 0`，不重复插（**靠 1.1 那个索引**）

---

## 4. 三层漏斗

`brain/mail/classify.js`。

1. 调 `pa_mail_rule_pass()` —— 第一、二层纯 SQL 走完，打印各类计数
2. `pa_address_candidates(500)` 拿地址卡
3. 五十张一批喂 `think()`（`READ_TOOLS`，**不给 Gmail 工具**——卡片里信息够了，不许它去翻信）
4. 解析 `[[WHO]]` 那套格式（照 `handleIdentify` 的形状），逐条 `pa_verdict_upsert(decided_by='fairwind')`
5. 每批报：`判了 50 个，真人 7，群发 41，认不出 2`

prompt 三条护栏，照 `handleIdentify` 已经立过的：

- 认不出就 `unsure`，**不编**
- 共享信箱（`residency@` / `info@`）要认出来，它不是人
- **只写判定，不写通讯录**——进通讯录永远要你点头

HTTP：`POST /mail/classify`。

- [ ] 写 `classify.js` + 挂口
- [ ] 规则层真跑，看各类计数合不合理
- [ ] 模型层真跑一批，**人工抽查十个判定对不对**
- [ ] 记录：第三层实际剩几个地址、跑了几次调用、多久

---

## 5. 点头入库

`POST /mail/adopt`（body: `email`, `contact_id?`, `name/org/role?`）：

1. 没给 `contact_id` → `pa_upsert_contact` 建人
2. `pa_claim_email(email, contact_id)` —— **该地址名下所有历史往来当场归位**
3. `pa_mail_promote(email)` 拿到该地址的 `mail_headers`
4. 对每封：`messages.get?format=full` 拉正文（纯代码），交模型写一句中文摘要
5. `pa_add_mail(...)` 进 `pursuit_messages`，`mail_headers.promoted_at` 打戳
6. 顺手 `pa_claim_contact_thread` 把这些 thread 认领上，以后「收信」跟着走

- [ ] 写 `/mail/adopt`
- [ ] 真跑一个人：他的信出现在名片上，正文和摘要都在

---

## 6. 前端

`src/components/Strangers.jsx` 从「待办清单」改成「等你点头 + 档案柜」：

- 上半：`v_pa_greetable`，每条一句人话理由，一个「认」按钮
  - **首次**（`backfilled_at` 刚写、待认 > 20）→ 全选模式，默认全勾，你取消不要的，一次点完
  - **日常** → 一条一条，跟现在的「加人」一个形状
- 下半：搜索框 + 一句「它判掉了 N 个地址，多半是订阅和通知。搜一下，看看有没有冤枉的」，搜 `v_pa_verdict_archive`，能当场翻案（写 `decided_by='you'`）

`src/App.jsx` 的 `runRefresh`：**别再把 `note` 丢掉**。整轮跑完在 Trouble 上说清这轮发生了什么，包括「没有新信」。

- [ ] 改两个组件
- [ ] 授权掉了 → Trouble 上是人话 + 怎么修，不是静默 0 封

---

## 7. 真跑验收

按设计稿第九节九条走一遍，**逐条贴真实输出**，尤其：

- [ ] **树皮书那六封发出去的信和三封回复，认领之后出现在对应机会线上**
- [ ] 再按一次「更新最新信息」，那几条线不再是 `added: 0`
- [ ] 65 条线里，登记过 thread 的从 **3** 涨到几？

---

## 顺序上的硬依赖

```
0（补迁移，可并行）
1.1 收紧去重索引  ←── 必须在 3 之前，否则重复插
1.2/1.3 表和端口  ←── 2、3、4 全靠它
2 auth + gmail    ←── 3 靠它
3 回填            ←── 4 靠它（没信头就没地址可判）
4 判定            ←── 5、6 靠它
5 点头入库        ←── 7 验收靠它
6 前端            ←── 可跟 5 并行
```
