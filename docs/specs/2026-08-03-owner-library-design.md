# 设计稿：作品库 → 主人信息库（关于 Hu Di）

> 状态：brainstorming 产出，待评审。日期：2026-08-03。
> 承接 `2026-08-01-artist-producer-agent-design.md` 的「地基 · ③ 懂你的作品网 / 画像」。
> 本刀只做**库本体**（数据模型 + 抽屉 UI），不接 Claude、不接写。

---

## 一句话

把右上角的「作品库」抽屉，从**只装作品**升级成**装关于主人的各类信息**——作品、工作/职业经历、教育/背景、展览/驻地/获奖（战绩）、身份/创作自述——每样都是独立的**一条**，统一收在这里。

## 为什么

渡要真懂这个人，才能替 ta 判断机会、写「为什么是我」、在投递时填出 bio / statement / CV 条目、乃至**针对不同机会生成定制简历**。作品只是其中一类事实；主人的履历、背景、战绩、自述同样是外联弹药。所以这个库的定位是**一个灵活、开放的事实库**：

- 用途：**既是主人的档案，也是渡的知识库**，设计上以 agent 能整库读为主。
- 本刀范围：**只做库本体**。渡「读库匹配 / 生成简历 / 填申请」留到接 Claude API 时。
- 编辑：本刀**只读**（种子 + Supabase 只读视图，沿用现状）。UI 里点着改并写回 Supabase 需要 auth + 写 RLS，是**下一刀**。

## 选定方案：一张统一的「条目」表，作品并进来（方案 A）

把现在的 `producer.works` 升级成统一的「条目」表。每条多一个 `kind` 和一个 `meta`。作品即 `kind='work'`，concern / site_path / medium / box 全保留。

> **实现取舍（落地时定）**：物理表名**保留 `producer.works`**——因为 `producer.pursuits.work_id` 外键指向它、且已有触发器/视图依赖它，改名代价大且无收益。对外用 `public.v_pa_entries` 视图给一个好名字，前端只认这个视图。作品专属字段（`medium/year/concern/site_path`）**仍作列保留**（已在用、渲染不动），`meta` 只装**新 kind** 的专属字段。`blurb` 列更名为 `body`。

> 放弃的备选（方案 B）：作品表原封不动、另加 `producer.about`。零风险但一个概念两套模型，以后渡读库 / 生成简历要缝合两处——与「都放这里、一条一条」相悖。

---

## ① 数据模型

### `producer.entries`（由 `producer.works` 升级）

| 字段 | 类型 | 作用 |
|---|---|---|
| `id` | uuid pk | |
| `kind` | text not null | `work` / `job` / `education` / `credit` / `statement`…**自由文本，可随时加新类**（呼应「所有的可以有可能」） |
| `title` | text not null | 短标签：作品名、职位、学位、奖/展名 |
| `body` | text | 内容：blurb / 描述 / 自述正文（原 `works.blurb`） |
| `meta` | jsonb not null default `{}` | 各类专属字段，给「填申请 / 生成 CV」用（见下） |
| `images` | text[] not null default `{}` | 图片 **URL** 列表（本刀不做上传/托管，指向 hudiworks.com 或现有图床） |
| `box` | jsonb not null default `{}` | 私密外联层（沿用作品「盒子」，推广到所有条目） |
| `tags` | text[] not null default `{}` | 匹配用（主题 / 技能），可空 |
| `source` | text not null default `manual` | `website` / `manual`（原字段保留） |
| `sort` | int not null default 0 | 排序 |
| `created_at` / `updated_at` | timestamptz | 沿用现有 touch 触发器 |

**`meta` 各 kind 的约定形状**（灵活，不强制、不建约束）：

- `work`：作品专属字段仍作列（`medium/year/site_path/concern`），`meta` 留空；`concern` 仍是作品内的分组键
- `job`：`{ org, role, start, end, location }`
- `education`：`{ school, degree, field, year }`
- `credit`（展览/驻地/获奖）：`{ org, year, type: '展览'|'驻地'|'grant'|'奖', location }`
- `statement`：`{ scope: 'artist'|'bio-long'|'bio-short'|… }`（正文在 `body`）

> 设计取舍：kind 专属字段进 `meta` jsonb 而非加列——保持「一条」通用、加新类别零迁移。真正结构化到列，等某类字段被「填申请」反复用到再说（YAGNI）。

### `producer.profile`（不动）

画像单行表保留原样（location / visa / directions / concerns…）。它是渡的**筛选/匹配画像**，与「一条条事实」职责不同，本刀不合并。抽屉里 `concerns` 仍用来给作品分子组。

### 迁移（已落地）

- `0007_entries.sql`：`ALTER TABLE producer.works` 加 `kind`(default 'work') / `meta` / `images` / `tags`，`blurb`→`body`，加 `works_kind_idx`；`drop view v_pa_works` → `create view public.v_pa_entries`（含 kind/meta/images/tags），grant select 给 anon/authenticated。
- `0008_seed_entries.sql`：补 statement×2 / education×1 / credit×1（示例）/ job×1（示例）。作品行沿用 `0002`，靠 `kind` 默认值成为 `work`。
- 前端种子 `src/data/entriesSeed.js` 与上面两支 SQL 同步。`v_pa_meta` 不变。

## ② 抽屉 UI

- 标题：「作品库」→「**战绩信息库**」（用「战绩」当整库框架名——作品/履历/背景/奖项都算主人的战绩；`credit` 分区仍单独叫「展览 / 驻地 / 获奖」，不跟整库名撞）。
- **按 kind 分区**：作品 / 自述·Bio / 工作·职业经历 / 教育·背景 / 展览·驻地·获奖·策展 / 技能。作品区**内部按 concern 分子组**（保留现状观感）；credit 区**按 `meta.type` 分子组**（个展 / 群展·演出 / 驻地 / 资助·奖学金 / 策展项目）。空的 kind 区不渲染。
- kind 列表落地为 6 类（较初稿多了 `skill`／技能）；`kind` 仍是自由文本，可继续加。
- 每条 = 可折叠行，沿用现有 `.work` / `.box` 样式：
  - 收起态：`title` + `body` + meta 小 chip（如作品的 medium、工作的 org·年限）+ `盒子` chip + 有图时一张缩略图。
  - 展开态：露出「盒子」私密层；有图则显示图区（`images` 直接 `<img>`）。
- kind 专属的收起态副信息由一个小映射决定（如 `job` 显示 `org · start–end`），保持组件通用。
- `+ 补一条` 仍是**占位**（本刀只读，不接写）。

## ③ 前端读取路径（沿用现有回落机制）

- `src/lib/loadWorks.js` → `loadLibrary()` 改读 `v_pa_entries`，返回 `{ entries, concerns, source }`。
- `src/data/worksSeed.js` → 升级成 `entriesSeed.js`：作品条目 + 新增的工作/教育/战绩/自述种子（与 SQL seed 保持同步，`npm run dev` 零配置即见）。
- `WorksDrawer.jsx` → 泛化为 `LibraryDrawer.jsx`：按 kind 分区渲染，作品区保留 concern 子分组；`Work` 组件泛化为 `Entry`，副信息 + 图区按 kind 适配。
- `App.jsx`：把 `lib.works` 换成 `lib.entries`，抽屉入口文案微调；其余不动。

## 不做（本刀之外，记着）

- 接 Claude：读库匹配机会、生成定制简历 / bio / statement、填申请字段。
- 写路径：UI 内新增/编辑条目 → 需 auth + `producer.*` 写 RLS。
- 图片上传/托管到 Supabase Storage（本刀只用 URL 引用）。
- `credit` / `job` 等字段真正结构化到列（等被反复使用再抽）。

## 验收（本刀）

- `npm run dev` 零配置：抽屉标题变「战绩信息库」，按 kind 分区，作品区仍按 concern 分组、盒子照常展开、有图作品显示缩略图。
- 已灌 Hu Di 真实简历：作品 11 · 自述 2 · 工作 7 · 教育 3 · 战绩 30（个展/群展/驻地/资助/策展）· 技能 4 = **57 条**（live DB 与前端种子一致）。
- 配上 Supabase env 后：`v_pa_entries` 读通则切「已连 Supabase」，读不到回落种子——与现状一致。
