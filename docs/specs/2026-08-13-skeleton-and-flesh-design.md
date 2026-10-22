# 骨架与血肉:把「系统」和「胡地的内容」拆开

> 上游:[2026-08-12 判据推倒重来](2026-08-12-four-signals-design.md)
> 目的:让这个仓库能被别人 fork 下来跑,而不需要先把胡地的东西一件件抠掉。
> **范围:一行现有数据都不动。** 改的是「一份全新的 clone 会长出什么」。

## 一、为什么

Fairwind 要作为模板发布,别人拿去用 AI coding 工具改成自己的工具。但现在这个
仓库里,「系统」和「胡地」是拌在一起的——同一个文件里上半截是结构,下半截是
57 条他的作品和履历。

拆开这件事有一条硬边界,**分错边就毁掉模板的全部价值**:

| | 例子 | 怎么办 |
|---|---|---|
| **骨架** | 有「起草」这一层、有 scout、球权只有你能点、卡上只留四样、`KINDS` 这套履历分类 | **留着。这就是模板。** |
| **血肉** | 11 件作品、画像、CV、三个母题、他的任务清单、scout 的筛选标准 | **剥进 `demo/`。** |

**「形状」不是血肉。** 「为什么有起草这一层」——因为胡地怕发冷邮件;「为什么有
scout」——因为他信息收集能力弱。这些卡点决定的功能形状**必须留下**,因为剥掉
它们剩下的是一个通用机会管理器,那个东西帮不了任何人。别人 fork 下来要改的
起点得是**一个有观点的东西**,不是一张白纸。

## 二、血肉留胡地的,不编假的

示范数据就用胡地的真作品集。理由:

1. **零成本**——已经在那儿了
2. **演示得出真东西**——这个工具的价值在「起草的信看得出来它知道你是谁」,
   空作品库演示不出来,新人会以为这就是个 CRM
3. **顺带是分发渠道**——每一份 fork 都带着他的 portfolio

前提是这些**本来就是公开的**(hudiworks.com 上的作品和 CV)。**真正私密的东西
——65 条机会线、往来邮件、地址簿、联系人——一个字都不在仓库里,只在那个线上
Supabase 库里。** 这次动作不改变这一点。

## 三、标记要,闸门不做

用真数据将来会有一个代价:有人 fork 下来没换,让 Fairwind 起草,它会用那个人
的名义讲胡地的作品。不只是作品——`producer.profile` 里的地点、签证、职业阶段
是 **scout 的筛选标准**,不换的话挑出来的机会全不对味。

**但那是模板的问题,今天不做模板。**

所以这一刀只做标记那一半:

```sql
producer.profile.is_demo   -- true = 库里是示范内容;false = 真人的库
```

**要这个标记不是为了模板,是为了第四节那四颗雷**——护栏得判得出「这是不是
真人的库」,靠的就是它。挡起草那一层等真要做模板的时候再说,现在做等于给一个
还不存在的用户挡一件还没发生的事。

### 为什么默认 false —— 这是本次的安全性质

```sql
alter table producer.profile
  add column if not exists is_demo boolean not null default false;
```

**加列不写值。** 胡地的线上库拿到这一列,值是 `false`,于是:

- 闸门对他不生效
- 界面横幅对他不显示
- **他现在跑着的系统,行为一个字节都不变**

只有跑了 `supabase/demo/` 里那支种子的库才是 `true`。**本次所有新增行为都挂在
这一个默认 false 的开关下面**,这是「不丢功能」最强的保证——不是靠我小心,是
结构上碰不到。

## 四、四颗雷(比原先估的多三颗)

种子里的破坏性语句不是一条,是四处:

| 文件 | 语句 | 炸掉什么 |
|---|---|---|
| `0002_seed_hudi.sql:4` | `truncate producer.works` | 11 件作品 + 全部履历条目 |
| `0004_seed_pursuits.sql:2-3` | `truncate pursuit_messages` / `truncate pursuits cascade` | **65 条线 + 全部往来历史** |
| `0006_seed_tasks.sql:3` | `truncate producer.tasks cascade` | 任务清单,**并顺 `task_id` 外键连 pursuits 一起铲** |
| `0008_seed_entries.sql:6` | `delete from producer.works where kind in (…)` | statement / job / education / credit / skill |

平时风险低,因为没人会去跑它们。**但模板化会把「新人跑一遍种子」写进安装说明**
——那一刻这四条就成了随时会被触发的指令。这直接撞「绝不丢信息」。

### 拆法:自保护,而不是删掉

不能直接删 truncate——删了重跑就变成重复插入。改成**每支种子自己检查,发现表里
已经有非示范数据就整支跳过**:

```sql
do $$
begin
  if exists (select 1 from producer.profile where coalesce(is_demo, false) = false) then
    raise notice '跳过:这个库里是真人的数据,不是示范数据。';
    return;
  end if;
  -- 原来的 truncate + insert 原样搬进来
end $$;
```

判据用 `profile.is_demo`,不用「表是不是空的」——因为空表也可能是刚建好的真人库,
而 `is_demo = false` 是一个**明确的、人写下的**声明。

新克隆的库:`profile` 一行都没有 → `exists(...)` 为假 → 种子照跑,行为不变。

## 五、目录长什么样

### 前端

现在 `src/data/entriesSeed.js` 一个文件里两样东西拌着:

```
KINDS / CREDIT_ORDER / CREDIT_LABEL / subInfo()   ← 骨架(通用履历结构)
CONCERNS_SEED                                     ← 血肉(胡地的三个母题)
ENTRIES_SEED (57 条)                              ← 血肉
```

拆成:

```
src/
  data/
    schema.js      ← KINDS, CREDIT_ORDER, CREDIT_LABEL, subInfo(), TASK_DESC
  demo/
    entries.js     ← ENTRIES_SEED
    concerns.js    ← CONCERNS_SEED
    pursuits.js    ← PURSUITS_SEED, MESSAGES_SEED
    tasks.js       ← TASKS_SEED
    README.md      ← 「这里装的是胡地的公开作品集,换成你自己的」
```

**`TASK_DESC` 归骨架**——它描述的是**系统支持哪几类造卡任务**,不是胡地的清单。
其中 `agency_scout`(找模特经纪)确实是胡地特有的卡点,但那是**形状**,按第一节
的规矩留下,并在 `demo/README.md` 里注明它是从哪个卡点长出来的。

### 数据库

```
supabase/
  migrations/    ← 44 支,纯结构,不动。外加新的 0059(加 is_demo 列)
  demo/          ← 由 seed/ 用 git mv 改名而来,6 支,每支加自保护
    README.md
```

`git mv` 不用 `mv`,**保住文件的历史**。

### 根目录

```
demo/
  README.md            ← 示范内容总说明:哪些是胡地的、怎么换成你的
  scout-prompt.md      ← 从根目录 git mv 进来(整篇是胡地的筛选标准)
  scout-sync-prompt.md ←
```

三个地方都叫 `demo`,一眼认得出。

## 六、跟着改的引用(不丢信息的关键)

搬文件会留下一堆指向旧路径的字。**每一条都要跟着改,漏一条就是丢一条信息**:

| 位置 | 现在写着 | 为什么必须改 |
|---|---|---|
| `README.md:23` | `supabase/seed/0002_seed_hudi.sql` | 装配说明,错了新人跑不起来 |
| `src/components/Trouble.jsx:27` | 「跑过 supabase/seed 里的种子了吗?」 | **界面上给人看的字**,路径错了等于骗人 |
| `src/data/entriesSeed.js:4-5` | 头部注释指向两支种子 | 文件本身要拆,注释跟着分家 |
| `brain/server.js:154` | 「界面上那份对应实现是 `src/data/entriesSeed.js` 的 `subInfo()`——改一边记得改另一边」 | `subInfo()` 要搬去 `schema.js`,不改这行,下一个人按图索骥会扑空 |

**不改 `docs/specs/` 里的旧稿。** 那几份是有日期的记录,描述的是它们那天的状态,
改了等于篡改历史。新路径以这份稿子为准。

## 七、`brain` 那边基本不用动

查过了:`brain/server.js` 里「你服务的谁」**已经全部现读 `producer.profile`**,
`artistOf` / `idOf` / `mailboxOf` / `systemFor` 一个常量都没写死。第 116 行那段
注释记着这一刀:「原来这儿写死着 "Hu Di / hudiworks.com"……现在只有库里那一份
是真的」。

所以 brain 只有一处要动:第 156 行那条指向 `entriesSeed.js` 的注释改路径
(`subInfo()` 搬去了 `src/data/schema.js`)。顺带那条注释里「import 会连 57 条
种子数据一起拖进来」的理由,分家之后不成立了,一并注明。

`brain/mail/addr.test.js` 里有 `hudi.creates@gmail.com` / `hudi@calarts.edu` ——
**测试夹具,留着。** 测试数据不是产品内容,换成 `a@b.com` 只会让测试更难读。

## 八、验收

前四条是「不丢」,后三条是「拆开了」。

1. **现有库未被触碰**:整个动作不跑任何 SQL。`git status` 之外,线上库零变更。
2. **不丢功能**:`npm run dev` 前后,作品库 / 看板 / 任务面板渲染结果**逐屏一致**
   (无 `.env.local` 走回落,有的话走真库)
3. **不丢内容**:`ENTRIES_SEED` 搬家前后**条目数和内容逐条相等**(脚本比对,不靠眼看)
4. **不丢信息**:第六节那四条引用全部指向新路径;`npm test` 全绿
5. **雷拆了**:对一个 `is_demo = false` 的库跑任意一支 demo 种子 → 整支中止,
   一行都没删
6. **拆干净了**:`src/data/` 和 `supabase/migrations/` 里 grep 不到 `Hu Di` /
   `hudi` / 胡地的作品名

## 九、这一刀不做的

**这一刀只是准备——把骨架和内容分开,让以后要分的时候好分,同时保证现在照常用。
不提前做模板的任何部件。**

- **不做起草闸门。** 见第三节。标记留着(护栏要用),挡起草那一层等真要做模板
  的时候再说。
- **不做界面横幅。** 本来该在 `is_demo` 时提示,但那条路要经过 `v_pa_meta`,
  而那个视图 **45 支 migration 里根本没有定义**(前端 `loadLibrary.js` 一直在
  静默查空)。断路上不盖房子。这个洞单独记着,是另一场讨论。
- **不做平台。** 那是另一场讨论。
- **不动 45 个 migration 的结构。** 只加一支 0059。
- **不改任何 UI 文案的措辞**(除了 `Trouble.jsx` 里那条路径)。
- **不合并 `brain` 的 `entryFacts()` 和前端的 `subInfo()`。** 拆完之后这件事
  在技术上变得可能了(挡路的正是「import 会连 57 条种子一起拖进来」),但那是
  独立的一刀,不塞进这次。
- **不碰 `scout-prompt.md` 的内容**,只搬位置。
