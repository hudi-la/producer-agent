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

没配 `.env.local` 时，前端用 `src/data/worksSeed.js` 的**种子数据**（你真实的 11 件作品）渲染作品库——`npm run dev` 立刻能看到。

## 数据库

作品库已经在共用 Supabase 里（`producer` schema）：

- `supabase/migrations/0001_producer_init.sql` — 建 `producer.profile` + `producer.works`
- `supabase/seed/0002_seed_hudi.sql` — 灌 Hu Di 的真实作品 + 画像

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
