# Fairwind · Producer Agent（工作名）

一个替艺术家跑外联的 producer agent。名字、视觉都是工作值，随时可改。

- 设计稿：`docs/specs/2026-08-01-artist-producer-agent-design.md`
- 视觉稿：`design/home-mockup.html`（浏览器直接打开）
- 栈：Vite + React 前端 · 共用 Supabase 项目（`reading assistant`，所有新表在独立 `producer` schema，不碰 `public`）· Claude API（起草/读网站，后续接）

## 跑起来

```bash
npm install
npm run dev
```

没配 `.env.local` 时，前端用 `src/demo/` 里的**示范数据**（Hu Di 真实的 11 件作品）渲染作品库——`npm run dev` 立刻能看到。

> 仓库分**骨架**和**内容**两半：内容（作品、履历、画像、筛选标准）集中在
> `demo/` · `src/demo/` · `supabase/demo/` 三处，其余都是骨架。
> 原委见 [`demo/README.md`](demo/README.md)。

## 数据库

作品库已经在共用 Supabase 里（`producer` schema）：

- `supabase/migrations/` — **结构**。45 支，纯建表建视图，不含任何人的内容。
- `supabase/demo/` — **示范内容**。6 支，灌 Hu Di 的真实作品 + 画像。
  含 `truncate`，但每支头上有护栏（`0059`），对着真人的库跑会当场中止。
  见 [`supabase/demo/README.md`](supabase/demo/README.md)。

（这两支已通过 MCP 应用到项目 `jjgvvtrsnoqnoigukobi`，`producer.works` 现有 11 行。）

## 上线连库（可选，之后做）

前端默认读种子。要它真读 Supabase：

1. 复制 `.env.example` → `.env.local`，填 `VITE_SUPABASE_ANON_KEY`
2. Supabase → Settings → API → **Exposed schemas** 加上 `producer`
3. 给 `producer.works` / `producer.profile` 加只读 RLS 策略

配好后 app 自动切成"已连 Supabase"（右上角徽标会变），读不到时自动回落种子。

## 下一步（未做）

- **从网站自动读**：无头浏览器渲染 hudiworks.com → Claude structured output 抽成 works → upsert `producer.works`
- **机会线 / 找机会**：`producer.opportunities` + `producer.pursuits`，scout（移植现有 cron）落成提案卡
- **主界面**：把 `design/home-mockup.html` 的 pipeline 主页 + 点开专注做成真页面
