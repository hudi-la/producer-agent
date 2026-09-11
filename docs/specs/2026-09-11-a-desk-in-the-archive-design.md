# 档案里的一张书桌

> 日期：2026-09-11。状态：**设计稿**。
> 在「我的档案」每一栏右边支一张桌子：一个只会陪你想、一个字都写不进库的 chat。
>
> **指代**：**你** = Di Hu；**Fairwind** = agent；**栏** = 档案页左栏那一格。

---

## 〇、起因

他 9/11 说：「我现在认为我的档案里面有一些，例如说关于作品的描述什么的不精准的。
我也希望有一个 AI 和我一起商量、一起写。包括我可以 produce 的东西，或者是我的未来的
一些 proposal，比如说我的一些课程的 proposal。」

查了一圈，发现三件事：

1. **弹药早就上膛了。** [`prompt.js`](../../brain/prompt.js) 的固定块里，Fairwind
   永远带着「你的档案 + 全部 57 条作品履历 + 每条下面的盒子」。缺的不是知识，
   是一个「对象是档案本身」的入口——现在对话只能挂机会线或挂人。
2. **条目在脑子那边没有身份证。** `pa_brain_context` 取条目时一个字段一个字段
   点名要（[0009](../../supabase/migrations/0009_brain_rpc.sql#L19)、
   [0025](../../supabase/migrations/0025_brain_context_meta.sql)），**唯独没要 `id`**。
   它看得见那段描述，但指不出「就这一条」。
3. **它从没见过你的画。** `images` 这一列在
   [`v_pa_entries`](../../supabase/migrations/0007_entries.sql#L31) 里有，
   `pa_brain_context` 没取。让一个没看过画的人改画的描述，这是整件事里最大的洞。

## 一、原则

- **它不写库。一个字都不写。** 所有进档案的字，是你自己复制过去、在那一格里自己改的。
  9/4 那条「默认落地、按了能撤回」管的是**卡片状态**（球在谁那边、到哪一阶段）；
  **内容**这件事跟外发信是同一条线——只认你自己的手。
  所以它手里连一台写库的工具都没有：不是靠提示词劝住，是结构上不存在。
- **一栏一条对话，永久累积。** 不分 session，不清空。关掉页面明天回来还在。
- **全给，不切。** 57 条一条不少地摆在它眼前，不按栏裁。变的只有一行「你现在在写哪个」。
- **没写完的东西不许被当成战绩发出去。** 这是 `draft` 标存在的全部理由。
- **不新造动作。** 焦点靠你本来就在做的事（展开一条）来定，不是新按一下。

## 二、为什么是新表

对话本来该挂进 `pursuit_messages`——所有对话都住那儿。查完之后不挂：

[0043](../../supabase/migrations/0043_address_alone_is_enough_ownership.sql#L16) 立着
`pm_owner_chk`：进那张表的每一行，**要么挂着机会线、要么挂着人、要么至少记下了
对面的邮箱地址**，三样占一样。它挡的是「一封谁也不知道干嘛的信悄悄进库然后
再也没人看见」。

档案里的闲聊三样一样都没有。挂进去就得放宽这条约束，**而一放宽，那道护栏
对真的邮件也就不再成立了**。为了省一张表拆掉一条正在管事的护栏，不划算。

（一条查错了的：本来担心它会被「第几次 follow up」「连发三封没回」「未读红点」
数进去。不会——[0117](../../supabase/migrations/0117_the_nth_follow_up.sql#L121)/
[0118](../../supabase/migrations/0118_three_letters_then_change_tack.sql)/
[0124](../../supabase/migrations/0124_a_person_can_have_unread_too.sql) 数的全是
`kind = 'email'`，而且都要求挂着线或挂着人。机会线上的聊天早就跟它们同住一张表、
从来没被数进去过。这条理由作废，留着记账。）

软的一条：那张表叫「往来」，记的是你跟外面的人之间**发生过什么**。
档案里跟 AI 商量怎么写，不是往来，是草稿间。放一起以后每次读那张表
都得先分辨「这行是真事还是想法」。

## 三、库

### 3.1 新表 `producer.studio_messages`

（稿子原来叫 `desk_messages`。改了：`desk` 这个词仓库里已经被「展开的卡片」
那个工作区占着（[`App.jsx:47`](../../src/App.jsx#L47)、[`lib/desk.js`](../../src/lib/desk.js)），
再用一次会撞。）

```sql
create table producer.studio_messages (
  id          uuid primary key default gen_random_uuid(),
  section     text not null,                       -- 左栏那一格的 key
  role        text not null,                       -- artist | producer | system
  kind        text not null default 'message',
  content     text not null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz                          -- 「重说」打标，绝不真删
);
create index studio_messages_sec_idx
  on producer.studio_messages (section, created_at) where deleted_at is null;
```

`section` 取值跟 [`schema.js`](../../src/data/schema.js) 里 `buildSections()`
生成的 key 一字不差：`about` / `work` / `statement` / `job` / `education` /
`skill` / `offer` / `credit:exhibition` / `credit:residency` / `credit:curatorial` /
`credit:rest`，外加那条兜底（以后新加的 kind 自己占一格，key 就是 kind）。

**不设外键、不设枚举。** 格是前端算出来的，库里没有「格」这张表；写死一个
check 约束的话，以后加一类条目就会在这儿炸，而炸的形式是「你打的字存不进去」。

### 3.2 `works` 加一列 `draft`

```sql
alter table producer.works add column draft boolean not null default false;
```

**默认 `false` = 写完的。现有条目一条不变，一个字都不会突然从 Fairwind 眼前消失。**
只有你新加的、或你自己点成「在写」的才隐形。

隐形只对 AI：[`entriesBlock()`](../../brain/prompt.js) 过滤掉 `draft` 的，
**档案页照常显示全部**。

`v_pa_entries` 补上 `draft` 这一列。

### 3.3 几支 RPC

| 名字 | 谁调 | 干什么 |
|---|---|---|
| `pa_studio_thread(p_section)` | 浏览器 anon | 读这一栏的对话（滤掉 `deleted_at`） |
| `pa_rewind_studio(p_msg_id)` | 浏览器 anon | 「重说」：这条和它之后的全打 `deleted_at`，返回撤了几条 |
| `pa_set_entry_draft(p_id, p_draft)` | 浏览器 anon | 切「在写 / 写完」 |

写库那支（`pa_add_studio_message`）只给 `service_role`，走 brain——跟
[0009](../../supabase/migrations/0009_brain_rpc.sql) 那套一样。

`pa_rewind_studio` 照抄 [0066](../../supabase/migrations/0066_say_it_again.sql) 的写法。

### 3.4 `pa_brain_context` 补两个字段

`entries` 那段的 `jsonb_build_object` 里加 **`id`** 和 **`images`**。

**注意：`create or replace` 必须整段重写**，不能只写差异——漏掉 `security definer`
或 `set search_path` 会悄悄改掉权限模型，且不报错（[0025](../../supabase/migrations/0025_brain_context_meta.sql#L17) 那条注释就是这么写的）。

### 3.5 `pa_add_entry` —— 现在根本加不了条目

档案页上**没有任何一个「加一条」的入口**。[`entries.js`](../../src/lib/entries.js)
只有 `pa_set_entry`（改已有的那条，要 `p_id`）；`Library` 里那行
`+ 补一条 / 丢进材料` 是一段死文字，不是按钮。所以「工作坊 · 可提供」这一栏
你想放一份新 proposal 进去，今天只有开 SQL 一条路。

```sql
pa_add_entry(p_kind text, p_title text) returns uuid
```

只收这两样，**新条目一律 `draft = true`**——刚建的东西按定义没写完，
Fairwind 不该看见。其余字段建完在页面上就地改（`InlineText` / `EditRow` 已经有了）。

给 anon。这是你自己的手，跟 `pa_set_entry` 同一条路。

## 四、脑子

### 4.1 第三种主人

[`server.js`](../../brain/server.js#L102) 的 `ownerOf()` 现在认两种。加第三种：

```js
if (body?.section) return { kind: 'studio', id: body.section }
```

`/chat` 和 `/chat/stream` 两条路都过这个口，所以前端沿用
[`streamChat()`](../../src/lib/chat.js)，只是 body 从 `{pursuit_id}` 换成 `{section}`。
**边想边出字、终止、重说，一样都不用重做。**

上下文不走 `pa_brain_context`（那支要 `p_pursuit_id`），单开一支
`pa_studio_context()`：`{ entries, profile, messages }`——没有 pursuit、没有 attachments。

### 4.2 摆在眼前的

三档切法（[`prompt.js`](../../brain/prompt.js#L16) 那套）照搬：

| 档 | 放什么 | 变不变 |
|---|---|---|
| `fixed` | 人格（改写过的，见 4.4）+ 档案 + 57 条信息库（滤掉 `draft`） | 永不变 → 跨会话缓存 |
| `perLine` | 无 | —— |
| `talk` | 这一栏的往来 + **你现在在写哪个** + 你刚说的那句 | 每轮变 |

**为什么固定块不按栏裁：** 缓存认的是**从第一个字起逐字相同**。按栏给不同的档案，
就是七八个不同的开头，**每一栏各自全价读一遍**——为了省而切，结果花得更多。
而且对这件事全给是好处：你写工作坊 proposal 时，它得能张口引用你那 22 个展览。

（实测那 57 条是 19,486 字符，作品 11 条就占 12,775——三分之二。
所以"精简上下文"实际等于"砍作品描述"，而那正是你要改的东西。砍不得。）

「你现在在写哪个」长这样，放在 `talk` 里（那块本来每轮都变，不碰缓存）：

```
## 他现在在写哪个
他开着「工作坊 · 可提供」这一栏（2 条）。
展开着：
- 《给美术馆的四周工作坊》（id 3f2a…）
- 《一学期驻校课》（id 9b17…）
```

一条没展开就只说栏。展开三条就列三条——**他在比这三条**。

### 4.3 手里的工具

**`WebSearch` / `WebFetch` —— 给。**

他要 reference。关掉的好处只有两条，都不是安全上的：省（读回来的几千字这条
对话后面每轮重付）、不跑偏（读完三份别人的 proposal，下一句就带那三份的语感）。
第二条是真风险，但**他自己看得见**——它引了谁一眼就知道，不是暗地里发生的事。
所以不加闸，只在提示词里加一句：**查回来的东西要说清是从哪儿来的，
别把别人网页上的话直接当成他的话写出来。**

**`open_work_image(条目, 第几张)` —— 新造一台。**

照 [`filesServer()`](../../brain/server.js#L225) 那套写：护栏**长在闭包里，
不在提示词里**——工具是按这一次对话现造的，能开的图写死成「这一栏的条目的图」。
别的栏、别人的东西，不是「不许它碰」，是够不到。图的额度沿用现成的
`imageBudget()`，超了当场挡下。

`images` 是外站 URL（[0007](../../supabase/migrations/0007_entries.sql#L10)
那行注释：referenced, not hosted），所以这台工具自己 fetch 回字节、按
`files.js` 的 `read()` 判格式，再当 image 块交出去。取不回来／格式不对
（heic、svg）一律明说取不回来，**不返回半通不通的东西**。

**为什么图不自动带：** 一张图进来就一直占着，后面每轮重付。而「我这批作品
有共同的线索吗」这种问题根本不用看图。它要真想看，自己开——你在界面上
看得见「它开了《XXX》的图」。

**写库的工具：一台都没有。** 见原则第一条。

### 4.4 人格改一段

`systemFor()` 现在那段是外联搭档的活（找机会、写申请、跟进）。桌子这边是另一件事，
需要一个分岔——**同一个 Fairwind，换一张桌子**：

- 你的活：陪他把**他自己的东西**说准。改描述、想清楚一件作品在讲什么、
  一起搭一份 proposal 的骨架。
- **你不动他的档案。** 你写的每一个字都是给他看的稿子，进不进档案、
  怎么进，是他自己复制过去、自己改。所以别说「我帮你改好了」——你改不了。
- 出稿就出**完整能用的整段**，别只给意见。他要的是能直接拿走的字。
- **别替他找腔调。** 他的话已经在档案里了，57 条都是他写的。
  往那个方向靠，不是往「艺术家陈述该有的样子」靠。
- 一次一件。

`LETTER_RULE` / `FORM_RULE` / `STATE_RULE` 这三条**桌子这边全部不带**——
不写信、不填表、不动状态机。

## 五、界面

`Library` 从两栏变三栏。[`styles.css:470`](../../src/styles.css#L470) 的
`208px + 1fr` 变成 `208px + 1fr + 聊天`，`page-inner.wide` 从 1040px 放宽。

聊天那栏是个新组件 `StudioChat`，props 只有 `section` 和 `focus`（展开着哪几条）。
消息的渲染、气泡、流式那个三点、「重说」——从
[`PursuitFocus`](../../src/components/PursuitFocus.jsx#L157) 抽出来共用，
不复制一份。**这是这次唯一的重构，而且是必要的**：复制一份的话，
以后改气泡样式会改出两种气泡。

**「加一条」**：每一栏顶上一个按钮（`KindSection` 的标题行，挨着那个条数）。
按下去当场建一条空的、标着「在写」的，标题就地可改。
`about` 那一格没有（它是 profile，不是条目）。

`draft` 那个标：折叠行上一个 chip（挨着现在那个「盒子 · 已补 N 条」），点一下切。
左栏那一格上显示「N 条在写」——跟现在显示条数同一个位置。
**这一条不能省**：`draft` 的东西 Fairwind 看不见，而你写完忘了点标的话，
下周它写申请时不会用，你收不到任何提示。左栏那个数字就是那个提示。

窄屏（现在 [`styles.css:485`](../../src/styles.css#L485) 那个断点）聊天收起来，
留一个把手。

视觉不在这稿里定，做完截图。

## 六、故意不做的

- **AI 写库。** 见原则第一条。
- **分 session。** 一栏一条，永久累积。他说「每次进去是新的也行」，但
  「不丢」比「干净」重要——[0066](../../supabase/migrations/0066_say_it_again.sql)
  那套「重说」已经给了他撤掉说错的话的路。
- **跨栏的对话。** 写工作坊 proposal 时想翻 workshop 那条机会线上的往来——
  好处是真的，但它属于「外联」那一摊，做成一个他说了才拉的动作，
  不是每次都背着。这一稿不做。
- **按栏裁固定块。** 见 4.2。
- **`section` 的枚举约束。** 见 3.1。

## 七、名词表

| 名字 | 是什么 |
|---|---|
| `producer.works` | 存 57 条作品/履历/自述/工作坊的那张表。叫 works 是历史 |
| `section` / 栏 | 档案页左栏一格，等于「这条对话属于哪一摊」 |
| `draft` | 「在写」。打了这个标的条目 Fairwind 看不见，你照常看得见 |
| `deleted_at` | 「重说」撤掉的打这个标，库里还在，读的时候滤掉。绝不真删 |
| `pm_owner_chk` | 往来表上那条护栏：每行要么挂线、要么挂人、要么记下对面地址 |
| `固定块` | prompt 里永不变的那段，专门放着好让服务器缓存 |
| 缓存是前缀匹配 | 从第一个字起逐字相同才命中；中间断一个字，后面全部全价重读 |
| `闭包` | 工具被造出来时就把「能碰哪些东西」焊死在里面，事后改不了 |
| `imageBudget()` | 数这次对话开了几张图、超了就拦的那个闸 |

## 八、施工顺序

1. 迁移：`studio_messages` + `works.draft` + `v_pa_entries` 补列 + 五支 RPC
   （`pa_studio_thread` / `pa_rewind_studio` / `pa_set_entry_draft` / `pa_add_entry` /
   `pa_add_studio_message`）+ `pa_brain_context` 补 `id`/`images`
2. brain：`ownerOf` 第三种 + `pa_studio_context` + 桌子那版人格 +
   `open_work_image` + `entriesBlock` 滤 `draft`（**这条要测**）
3. 前端：`chat.js` 收 `{section}` + 抽出共用的消息渲染 + `StudioChat` + 三栏
4. 「加一条」按钮 + `draft` 的 chip 和左栏计数
5. 跑起来，截图
