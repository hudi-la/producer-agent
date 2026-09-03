# 机会池：那张 Excel 进 Fairwind，每周先查表再找新的

> 日期：2026-09-03。状态：**设计稿**。
> 接着 [2026-09-02 定时造卡](2026-09-02-scheduled-scout-design.md) 往下一刀：那一刀让任务按点跑，
> 这一刀给它一张表，并且教它判断「以我这个阶段够不够得着」。
>
> **指代，全文一律**：**你** = Di Hu；**Fairwind** = agent；**脑子** = `brain/`。

---

## 〇、他说的三件事

1. 表里可以多，不讲「宁缺毋滥」。
2. 每周先看表里有没有开的，再去表外找新的。
3. 每周开着的机会里挑**最准、最容易申请上**的自动造卡；其余的记一笔，他想捡再捡。
   判断要比现在细：现在只判方向和身份，要加上**他所处的阶段**。

外加两条修正：

4. **不设固定张数**。很合适的多，就多造几张。门槛是判据，不是名额。
5. **两条 scout 合成一条**（后台本来就是同一段代码，只有提示词里「去哪找」不同；
   而「挑最准的」必须一次看见全部开着的行）。手动那几条不再显示开关和「开着」。

## 一、那张 Excel 是什么

`/Users/dihu/Desktop/applicaitons/opportunity/HuDi_Opportunities.xlsx`
（旧提示词里写的 `Desktop/opportunity/` 少了一层，所以 9/2 那轮我说它不在盘上，那句是错的。）

| 页签 | 内容 |
|---|---|
| Opportunities | 77 行机会。34 行 🟡 关注、22 行 🟢 开放、7 行 ⭐重点投递、其余已投/已录取 |
| 待身份变化 Eligibility Hold | 5 行 |
| 艺术家画像 Profile | 筛选标准。库里 `producer.profile` 已有同一批事实 |
| IG机会·辨别清单 | 防 vanity 的判据 |
| 图例与策略建议 | 他自己写的图例、最紧迫行动、**申请材料清单** |

**这张表就是他的持续关注列表。** Fairwind 看板上「持续关注」那一列的 11 张卡是它的一个零头。

## 二、一句话

新建一张 `producer.opportunities`（机会池）。Excel 那 82 行导进去。
每周一轮做三件事：**复查池子 → 出去找新的 → 把开着的挑一遍**。
挑中的自动造卡进「新机会」，其余开着的留在池子里标上本轮，他想捡就捡。

## 三、不变量

- **池子不是卡。** 池子里的行不进看板、不算通知、不走状态机、不收信。
  一行就是「世上有这么个机会」这一个事实。上百行也不该让界面变吵。
- **存量一个不动。** 看板上现有 11 张 watch 卡、14 张 paused 卡原地不动，我不搬不删不改形状。
  变的只是**新的未开放机会往哪去**（往池子，不往看板）。
- **Excel 原文件不动。** 导入一次，之后库是唯一真相。原文件留档，不写不改。
- **建卡仍然只有一个口**（`pa_create_pursuit`，0119 建的）。池子多一个「捡出来」的动作，走同一个口。
- **查不到就说查不到。** 往届名单查不到 → `reach='unknown'`，绝不编一份名单出来。
  编出来的名单比不判坏得多：他会照着一个假参照去决定投不投。

## 四、够得着（reach）—— 这一刀真正新的东西

现在的判断只有两维：**方向**（`fit_stars` ★★★/★★）和**身份**（`eligible`）。
加第三维 **`reach`**：以他现在的阶段，这个机会够不够得着。

### 判据（他 9/3 确认过，特别点名了往届名单那条）

**往上够（多半白投）**
- 提名制、或需要机构推荐 / 共同申请人 / fiscal sponsor / 501(c)(3)
- 明写 mid-career / established / 要求十年以上专业实践
- 要求已有美术馆级个展、画廊代理、作品被机构收藏
- **往届名单清一色是大馆、双年展、名校 MFA 履历**
- 金额巨大且全球开放（池子极大）

**够得着**
- 明写 emerging / early-career / 首次申请者欢迎 / 不要求学位
- **往届名单里有履历跟他相当的人** ← 最硬的一条
- 地域正好卡在 Los Angeles 或 SF Bay Area（池子小）
- 主题窄且正好是他的：AI、参与式、微缩装置、亚裔身份、技术批评
- 申请材料是他现成的那几样（作品集 / 三档陈述 / CV），不要新制作预算、不要推荐信
- 免费或低报名费；新办的头几届，竞争还没固化

### 怎么实现「跟往届名单对比」

这是一次**独立的、带联网的判断**，不跟找机会那一轮混在一起：

1. 只对**本轮开着的**行做（不是全表）。表大不影响成本。
2. 判完存在行上（`reach` / `reach_why` / `reach_evidence` / `reach_url` / `reach_at`）。
   **一个机会判一次就够** —— 往届名单不是每周会变的东西。`reach_at` 超过 300 天才重判。
3. 判的时候给它三样：这个机会的事实、**他真实的履历**（库里 30 条 credit / 3 条 education /
   12 件作品，`entriesBlock` 已经在拼 prompt 的静态块里）、上面那张判据表。
4. 让它**真的去找**往届名单页（past fellows / recipients / alumni / 历届获奖者），
   `reach_evidence` 里要**指名道姓**写出查到了谁、那个人当年什么履历。
   找不到就 `reach='unknown'` 并说明找过哪里没找到。
5. 一轮判几个有上限（`config.reach_per_round`，默认 8），排不上的下一轮再判。

> 为什么不把 reach 塞进找机会那一轮顺手判：那一轮已经要开六七个站，再让它对每个候选去翻往届名单，
> 会把一次调用撑爆，而且找到的大多数根本不开放，判了也白判。分开之后成本跟着「本周真开着的」走。

## 五、造卡的门槛（不是名额）

一轮结束时，池子里满足下面全部条件的行，**全部**造卡：

- `status = 'open'`（这一轮确认开着）
- `eligible`（身份没问题）
- 还没捡过（`pursuit_id is null`）、没被标过「别再提」
- 且 **`fit_stars = 3` 且 `reach <> 'longshot'`**，或 **`fit_stars = 2` 且 `reach = 'realistic'`**

`reach = 'unknown'` 当作「不是 longshot」——存疑不降级。卡上和池子里都写明「往届名单没查到」。

**没有固定张数。** 安全阀 `config.card_cap`（默认 12）只防跑飞，触发了必须在战报里说清
「还有 N 张够格但这轮没造，下轮继续」——它是一句实话，不是一个静默的截断。

其余开着的（★★ 且不够得着、或 longshot）留在池子里，标 `noted_round = 本轮`。
这就是他说的「小笔记」：不是另开一个地方，是池子上的一个筛选。

## 六、每周那一轮（三步）

一条任务：**每周找机会**（由 `scout_aggregators` 那行改名而来，名下 11 张卡跟着走）。

### 第一步 · 复查池子

挑一批去官网看开没开。**不是全表每周查一遍**——表会长到几百行，那样又慢又贵。
优先级（`pa_opp_to_check`）：

1. `opens_at` 落在过去或未来 14 天内（该开门了）
2. `status='open'` 但 `deadline_at` 已过（该关门了）
3. 从来没查过（`checked_at is null`）—— Excel 导进来的全是这种
4. `checked_at` 最老的

一轮上限 `config.check_per_round`（默认 20）。查完更新
`status` / `opens_at` / `deadline_at` / `deadline` / `checked_at` / `check_note`。

### 第二步 · 出去找新的

聚合源 + WebSearch，跟 0119 那套一样，但**落点从「造卡」改成「进池子」**。
去重对池子和 pursuits 两头都做。这一步不设「最多 5 个」——池子里多几行不花钱。

### 第三步 · 挑

本轮所有 `status='open'` 且没捡过的行 → 没判过 reach 的判一遍 → 按第五节的门槛造卡。

### 战报

写进 `tasks.last_result`，一句一行：

```
2026-09-07
复查 20 行：3 个开了（Headlands / Pioneer Works / Transmediale），2 个关了，15 个没变；还有 47 行没轮到。
找到 6 个新的进池子：…
判了 5 个够不够得着：Headlands 够得着（往届 2024 有 Lauren Lee McCarthy 之外也有刚出校门的…）…
造了 4 张卡：…
开着但没造卡的 2 个（想捡自己捡）：…
```

## 七、界面

### 池子那张表

看板工具条上多一个入口：**机会池 · 82**。点开是一张宽表（不是看板列）。

- 顶上一行说清这一轮：查了几行、开着几个、造了几张、还有几行没轮到。
- 排序：本轮开着且没捡的排最前 → 按 `fit_stars` → 按 `reach`（够得着的在前）→ 按截止近的。
- 每行：名称 · 机构 · 类型 · 状态 · ★ · 够得着 · 截止或预计开放 · 上次查 · 链接。
- 两个动作：**捡出来**（造卡，走 `pa_create_pursuit`，回填 `pursuit_id`）、
  **别再提**（`dropped_at`，不再复查也不再推）。
- 已经捡过的行灰掉并显示「已在看板上」，不消失——消失了他会以为丢了。

### 造卡任务面板分四组（他 9/3 提的）

| 组 | 有什么 | 长什么样 |
|---|---|---|
| **定时跑的** | 每周找机会 | 真开关、排期、提示词、现在跑一次、战报 |
| **跑过的专项** | 树皮书（25 张卡）· 媒体艺术/AI（23 张）· 模特经纪（7 张） | **没有开关、不写「开着」**。只有名字、跑的日子、当时那份战报 |
| **卡的出处** | 你自己丢的 | 一行字。它不是任务，是卡的来源标记 |
| **还没接** | 盯梢机构 · 邮箱进来的机会 | 一行字，列名字就行 |

「开关拨得动」这件事只属于第一组。第二组那三条后台不连任何东西，
给它们一个开关就是**假着**——跟当初撤掉四个死 tab 是同一条规矩：空着可以，假着不行。

## 八、库

迁移 `0120_a_pool_of_opportunities.sql`。

```sql
create table producer.opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  org text, kind text, location text, funding text, url text,
  deadline text,               -- 原话（"spring 2027" / "rolling" 照抄）
  deadline_at date, opens_at date,
  status text not null default 'unknown',    -- open | closed | unknown
  fit_stars int,                             -- 3 | 2，方向契合
  eligible boolean not null default true,    -- 身份
  reach text,                                -- realistic | stretch | longshot | unknown
  reach_why text, reach_evidence text, reach_url text, reach_at timestamptz,
  why text, notes text,
  source text not null default 'scout',      -- excel | scout_aggregators | scout_search | manual
  task_id uuid references producer.tasks(id) on delete set null,
  pursuit_id uuid references producer.pursuits(id) on delete set null,
  picked_at timestamptz,
  dropped_at timestamptz, dropped_why text,
  checked_at timestamptz, check_note text,
  noted_round date,                          -- 最近一次「本轮开着的」
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index opportunities_title_key on producer.opportunities (lower(btrim(title)));
```

| 口子 | 谁调 | 干什么 |
|---|---|---|
| `pa_upsert_opportunity(...)` | 脑子 | 进池子。标题或链接撞了就更新空字段，不覆盖已有的判断 |
| `pa_opp_to_check(limit)` | 脑子 | 该复查哪几行，按第六节的优先级 |
| `pa_opp_checked(id, status, …)` | 脑子 | 写复查结果 |
| `pa_opp_reach(id, reach, why, evidence, url)` | 脑子 | 写够得着的判断 |
| `pa_opp_open_unpicked()` | 脑子 | 本轮开着、没捡过的行（挑的时候用） |
| `pa_opp_note_round(ids, round)` | 脑子 | 标「这一轮开着的」 |
| `pa_pick_opportunity(id)` | 两边 | 捡出来：建卡 + 回填 `pursuit_id`/`picked_at` |
| `pa_drop_opportunity(id, why)` | 浏览器 | 别再提 |
| `v_pa_opportunities` | 浏览器 | 读面 |

脉搏加一区 `pool`。

## 九、这些名字是什么意思

| 名字 | 是什么 | 界面上对应 |
|---|---|---|
| `producer.opportunities` | 机会池 = 那张 Excel 搬进来的表 | 「机会池」那张宽表 |
| `status` | 上次查的时候开着没有：open / closed / unknown | 行首那个状态字 |
| `fit_stars` | 方向契不契合（老的匹配度 ★★★/★★） | 那几颗星 |
| `eligible` | 身份能不能申（O-1 撞上「限美国公民」就是 false） | 「资格搁置」 |
| **`reach`** | **以他现在的阶段够不够得着**：realistic / stretch / longshot / unknown | 「够得着 / 有点悬 / 多半白投 / 没查到」 |
| `reach_evidence` | 往届名单里查到了谁、那人当年什么履历 | 鼠标停上去看到的那段话 |
| `pursuit_id` | 这一行捡出来之后是哪张卡 | 「已在看板上」 |
| `noted_round` | 最近一次被标成「这一轮开着的」 | 「本周还找到这些」那个筛选 |
| `pa_pick_opportunity` | 把池子里一行变成一张卡 | 「捡出来」那颗按钮 |

## 十、这次不做

- 池子行不收信、不判 state、不进 🔔。它是事实，不是线。
- 「本周还找到这些」不另做通知。他打开池子就看见。
- Excel 不做双向同步。导入一次，之后原文件只是留档。
