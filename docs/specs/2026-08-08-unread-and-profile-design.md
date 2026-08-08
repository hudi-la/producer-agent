# 设计稿：红点说人话 + 档案能改

> 日期：2026-08-08。状态：**待实施**。
> 上游：[2026-08-06 更新最新信息 + 批量操作 + 过卡队列](2026-08-06-batch-and-queue-design.md)

---

## 这一刀解决什么

一句话：**卡上那个红点在撒谎，而且它撒的谎正好盖住了唯一值得响的那件事。**

### 病是怎么发现的

「找 workshop 机构 · 媒体艺术/AI」那一叠上挂着红点。人明明点开看过了，收起来它又在。

判据在 [App.jsx:225-233](../../src/App.jsx#L225-L233)：

```js
const seenAt = seen[p.id] ? new Date(seen[p.id]).getTime() : 0
return last && last.role === 'producer' && new Date(last.created_at).getTime() > seenAt
```

`seen` 来自 `localStorage['pa_seen']`。查库对过账，这叠 9 张（`task_id=724382fe…`、`stage='writing'`）里 8 张的最后一条消息是 **08-05 建卡时自动写的那份 brief**（`kind='brief'`）。

于是三个缺陷叠在一起：

1. **没记录就当 1970 年。** `: 0` 那个默认值让「从没点开过」和「有新消息」变成同一件事。
2. **brief 也算「Fairwind 说话」。** 一批新卡造出来，每张的最后一句都是它自带的 brief → 整批从出生起全亮，跟有没有新消息无关。
3. **已读只活在一个浏览器里。** `pa_seen` 是 per-origin per-profile 的 localStorage。

第 3 条是当场证死的：两个窗口同时开着同一个 `localhost:5173`，一个主题亮一个暗（主题唯一的输入是系统外观设置，同一浏览器不可能不同），顶栏「过卡」一个 `1/2` 一个 `1/1`（`pa_queue` 跟 `pa_seen` 在同一份 localStorage 里）。**两份存储各记各的，刷新不会收敛。**

### 而它盖住的那件事

判据只认 `role='producer'`。**对方机构真回信了（`role='org'`）——不亮点。**

收信那段（[server.js:471-490](../../brain/server.js#L471-L490)）本来就分得清自己发的和对方来的：

> `addedIn` = 对方来的那几封。你自己发的信收录进档案不该惊动你——你知道你发过。

分是分了，但收完信只更新 `next_action`，**一条消息都不写**。所以真有人回你信，卡面上一点动静没有。

红点最该响的那一下，恰恰是它唯一不响的那一下。

---

## 红点的新定义

> **最后一条消息是 Fairwind 说的，且不是建卡的 brief，且晚于你上次读这条线。**

只有一条规则，因为收信改成让 Fairwind 出面说话：

**对方来了新信 → 收信那段顺手落一条 Fairwind 的告知消息。**

这不是「靠 Fairwind 记得写」——是收信入库的同一个操作顺手写的，结构上做不到「信到了但没告知」。

好处不只是规则少一条。红点从「有封信」变成「Fairwind 告诉你有封信」——你看到的是一句人话（谁回的、要什么），不是一个得自己点开翻的哑点。

**自己发出去的信（`role='artist'`）不触发告知。** 你知道你发过。

---

## 一、已读进库

### 表

```sql
create table producer.pursuit_seen (
  pursuit_id uuid primary key references producer.pursuits(id) on delete cascade,
  profile_id uuid not null references producer.profile(id),
  seen_at    timestamptz not null default now()
);
```

`profile_id` 现在恒等于那唯一一行 profile。**带上它不是为了今天**——是为了以后真有第二个人时不用拆表。主键届时改成 `(pursuit_id, profile_id)` 即可，其余不动。

「我看没看过」是**我和这张卡的关系**，不是卡的属性，所以是独立的表，不是 `pursuits` 上加一列。

### 写入口

```sql
create or replace function public.pa_mark_seen(p_pursuit_id uuid) returns void
  security definer set search_path to 'public','producer'
```

照 [`pa_set_jot`](../../supabase/migrations/0023_jot.sql#L81) 的模子：`revoke all from public` + `grant execute to anon, authenticated, service_role`。前端直连，不经过 brain——跟 `pa_set_ball` / `pa_set_stage` 同一条路。

### 判据搬进视图

`v_pa_pursuits` 增加一列 `unread boolean`，在 SQL 里算：

```
该条线最后一条 role='producer' and kind <> 'brief' 的消息，
其 created_at > coalesce(seen.seen_at, pursuits.created_at)
```

兜底用 `pursuits.created_at` 而不是 `1970`：**新卡不该一出生就欠你一次点击。**

前端只读 `p.unread` 这个布尔，删掉整段 `unseen` 计算和 `pa_seen` 的读写。

### 顺带堵掉一个还没发作的隐患

现在为了找「每张卡的最后一条消息」，[loadPursuits.js:27](../../src/lib/loadPursuits.js#L27) 把**全库消息**拉下来（每 8 秒一次）。当前 182 条没事，但 PostgREST 默认封顶 **1000 行**——超过之后它只返回**最老的 1000 条**，新消息静悄悄不在里面，红点开始漏报且不报错。

判据搬进视图后，首页不再需要全量消息，这个隐患一并消失。

---

## 二、收信告知

收信入库时（`p_role='org'` 且确实是新插入的，不是重复的 gmail id），在同一操作里补一条：

```
role='producer', kind='inbox'
content = 「<对方名> 回信了：<summary>」
```

`summary` 收信时已经算好了（[server.js:479](../../brain/server.js#L479) 的 `p_content`）。

**告知的 `created_at` = 那封信的 `created_at` + 1 毫秒。** 理由：告知是**关于**那封信的，必须紧跟它排序；而且回填一封两个月前的旧信时，不该冒充成今天的新消息。

`role='artist'`（自己发的）不写告知。

---

## 三、档案能改

### 现状

`producer.profile` 里存着真正会变的东西：

`visa: "O-1"`、`location`、`career_stage`、`funding_pref`、`exclude_rule`、`watch_rule`、`directions`、`concerns`、`motifs`

但**同一批事实被存了两遍**——库里一份，[server.js:67](../../brain/server.js#L67) 和 [server.js:188](../../brain/server.js#L188) 的 prompt 里又抄了一份写死的字符串（"你服务的艺术家是 Hu Di"、"美国 O-1，常住 LA / 湾区"）。两份会飘。

而「我的档案」页（[Library.jsx](../../src/components/Library.jsx)）只读作品和三条关切——这些字段**看不见也改不了**，只能开 SQL。

### 改

1. **写死的改成读库。** brain 开工前读 `profile`，把 name / website / visa / location 拼进 prompt。三处 UI 里写死的 `O-1 · 资格搁置` 文案（[Pipeline:74](../../src/components/Pipeline.jsx#L74)、[PursuitFocus:51](../../src/components/PursuitFocus.jsx#L51)、[Dossier:77](../../src/components/Dossier.jsx#L77)）改成读 `profile.data.visa`。
2. **「我的档案」页上做成可编辑：** 名字、作品站、签证、常住地、职业阶段、资助偏好、排除规则、关注规则。
3. **写入口** `pa_set_profile(p_name text, p_website text, p_data jsonb)`，同样 grant 给 anon。

改完 Fairwind 立刻用新的。O-1 变绿卡那天自己在这页改，不用改代码、不用开 SQL。

---

## 四、已有阅读记录要搬上去

那个亮色窗口的 `localStorage['pa_seen']` 里存着真实的阅读历史。改完直接弃用 = 那份记录消失 = 每张卡重新亮一次。

**首次加载时做一次性搬迁：** 读到本地 `pa_seen` 且库里该卡没有 `pursuit_seen` 行 → 用本地那个时间戳补进库，然后把 `pa_seen` 标记为已迁移（不删，留着以防搬错）。

只跑一次，之后不再读本地。

---

## 不动的

**过卡队列（`pa_queue`）保持在 localStorage。** [queue.js:7](../../src/lib/queue.js#L7) 那条注释仍然成立：

> 它是「你这台机器上手头的活」，不是事实。

在家排的队没过完，到工作室未必想接着那一队。而「你读没读过这条线」是事实，该跨机器一致。这两样躺在同一个抽屉里是巧合，不是同一类东西。

---

## 多人使用

**这一刀不做认证、不做 RLS、不动 `profile` 上的 `unique (singleton)` 约束。**

现在的定位是「单人 + 单机 + 无认证」，而且是被结构钉死的（全库没有 `user_id`/`owner_id`/RLS；`v_pa_*` 视图 `grant select to anon`）。真要做成给别人用的产品，那是单独一轮设计——singleton 约束、anon 授权、brain 跑在本机这三件事都得重想。

这一刀只做一件事：**新表带上 `profile_id`，把形状留对。** 代价接近零。

---

## 验收

- [ ] 换一个浏览器 / 无痕窗口打开，红点跟原窗口一致
- [ ] 新造一批卡，卡上**没有**红点（brief 不算新消息）
- [ ] 对方机构回一封信 → 卡上出现红点，点开看到 Fairwind 的一句告知
- [ ] 自己发一封信出去 → **不**出现红点
- [ ] 「我的档案」改签证 → 卡上「资格搁置」文案跟着变，Fairwind 下一次开口用新的
- [ ] 原有阅读记录搬迁后，之前读过的卡不重新亮
- [ ] 首页不再全量拉消息
