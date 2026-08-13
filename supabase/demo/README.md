# 库里的内容(原 supabase/seed/)

六支种子。**跑之前先跑完 `../migrations/`**——护栏函数 `producer.demo_guard()` 在 `0059` 里建。

| | |
|---|---|
| `0002_seed_hudi.sql` | 作品 + 画像(**这支把 `is_demo` 设成 `true`**) |
| `0008_seed_entries.sql` | 自述 / 工作 / 教育 / 展览 / 技能 |
| `0009_works_content.sql` | 作品正文 |
| `0004_seed_pursuits.sql` | 示范机会线 |
| `0006_seed_tasks.sql` | 造卡任务清单 |
| `0028_seed_deliverables.sql` | 两份示范产出 |

按文件名的数字顺序跑。

## ⚠️ 这几支含 truncate

对着真库跑一遍,机会线连同全部往来历史当场清零。`0006` 那支的
`truncate producer.tasks cascade` 还会顺 `task_id` 外键连机会线一起铲。

所以每支的第一条语句都是 `select producer.demo_guard();`——查
`producer.profile.is_demo`,发现是真人的库就抛错中止,一行都不删。
`is_demo` 默认 false,现有的库自动受保护。

**必须整支跑在一个事务里**,抛错才能把后面的 `truncate` 一起回滚。
Supabase SQL editor、MCP `apply_migration`、`psql -1` 都是这样跑的;
`psql -f` 不加 `-1` 不是。

前端那一份对应的是 `src/demo/`——改这边记得改那边。
