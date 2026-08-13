# 前端的回落数据

连不上 Supabase 时,界面回落到这里渲染——所以 `npm run dev` 零配置就有东西看。
连得上的时候前端**根本不读这里**(见 `src/lib/load*.js`)。

装的是内容,不是系统。库里那一份对应的是 `supabase/demo/`——改这边记得改那边。

骨架(有哪几类条目、怎么分组、折叠行上显示什么)在 [`src/data/schema.js`](../data/schema.js),
那里不含任何一个艺术家的内容。

分家的原委见 [`demo/README.md`](../../demo/README.md)。
