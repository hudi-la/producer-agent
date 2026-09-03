# 这里装的是内容,不是系统

仓库分两半。**分清楚这两半,是为了以后要分的时候好分**——现在不做别的。

| | 是什么 | 在哪 |
|---|---|---|
| **骨架** | 结构、逻辑、判据、词汇 | 其它所有地方 |
| **血肉** | 一位艺术家的作品、履历、画像、筛选标准 | `demo/` · `src/demo/` · `supabase/demo/` |

三处都叫 `demo`,一眼认得出。

真正私密的东西——机会线、往来邮件、地址簿、联系人——**一个字都不在这个仓库里**,
只在 Supabase 库里。这次动作不改变这一点。

## 血肉在这三个地方

```
demo/                        ← 你在这儿
  scout-prompt.md            「每周找聚合源」的提示词:整篇是画像、来源和筛选标准
  opencall-prompt.md         「每周找 Open Call」的提示词:同一套画像,来源换成搜索词
                             (这两段同时存在 producer.tasks.prompt 里,界面上能改;
                              src/demo/tasks.js 和 supabase/demo/0006 各有一份,改一边记得改另一边)
src/demo/                    前端在连不上库时的回落数据
  entries.js                 57 条:11 件作品 + 自述 / 工作 / 教育 / 展览 / 技能
  concerns.js                三个母题(作品按它分组)
  pursuits.js                10 条示范机会线
  tasks.js                   造卡任务清单
supabase/demo/               库里那一份,六支种子(原 supabase/seed/)
```

`src/demo/` 和 `supabase/demo/` 是**同一批内容的两份**(前端回落 / 库里)。
改一边记得改另一边。

## 护栏:种子不会清空真人的库

这一条**跟分家无关,是现在就该有的**。

`supabase/demo/` 里那几支种子含 `truncate` / `delete`,**对着真库跑一遍,机会线连同
全部往来历史当场清零**。其中 `0006` 那支的 `truncate producer.tasks cascade` 还会
顺着 `task_id` 外键连机会线一起铲。

所以每支种子的第一条语句都是:

```sql
select producer.demo_guard();
```

它查 `producer.profile.is_demo`。发现是真人的库(`is_demo = false`)就抛错中止,
一行都不删。定义见 `supabase/migrations/0059_demo_flag_and_guard.sql`。

`is_demo` **默认 false**,所以现有的库自动受保护,什么都不用做。

⚠️ **种子必须整支跑在一个事务里**,抛错才能把后面的 `truncate` 一起回滚。
Supabase SQL editor、MCP `apply_migration`、`psql -1` 都是这样跑的;
`psql -f` 不加 `-1` 不是——别那么跑。

## 什么**不**是血肉

分家的时候最容易分错的一刀。下面这些看着像「为某个人定制的」,其实是**骨架**——
它们是卡点决定的**功能形状**,不是内容:

| 形状 | 从哪个卡点长出来的 |
|---|---|
| 有「起草」这一整层 | 怕发冷邮件——担心写不好反而断送机会 |
| 有 scout / 周更机会 | 信息收集能力弱,需要有人定期把机会端过来 |
| 「待处理 / 等回复」只有人点得动,系统改不了 | 不要系统悄悄改掉你的判断 |
| 卡上只留四样 | 判据长太多、散在四个地方算 |
| `agency_scout`(找模特经纪)这类任务 | 一条特有的收入线 |

**剥掉这些,剩下的是一个通用机会管理器。** 每一刀为什么砍在那儿,写在 `docs/specs/`
里,按日期排。
