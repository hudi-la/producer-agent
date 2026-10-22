# Fairwind MCP：用户自己的内容

MCP 使用设置页的个人令牌，所有读取和写入按当前用户隔离。新增工具不需要额外接入另一个服务。客户端若缓存工具清单，需要刷新连接。

## 可以直接说

- “把这几家机构做成一个 card stack，叫洛杉矶空间。”
- “把这个已有机会加进去，排到第一张。”
- “今天和这位策展人见了面，记到她的名下，也关联到这个项目。”
- “把这份申请陈述存回这张卡；只改申请表里 biography 那一题。”
- “把这份 PDF 放到项目材料里，把作品图片放到作品档案里。”
- “把这批履历导入我的档案，已有的不要重复。”
- “每周二上午九点帮我搜寻雕塑驻地。”

## 工具分组

| 内容 | 工具（统一以 `fairwind_` 开头） |
| --- | --- |
| 独立卡片组 | `stacks_list`, `stack_get`, `stack_create`, `stack_set`, `stack_add`, `stack_remove`, `stack_reorder` |
| 卡片完整内容 | `pursuit_get`, `pursuit_set`（扩展） |
| 档案整理 | `entries_import`, `entry_archive`, `entry_sort`, `entry_box_set` |
| 联系人 | `contacts_list`, `contact_set`, `contact_note`, `notes_list` |
| 机构与项目关系 | `mailboxes_list`, `mailbox_set`, `parties_list`, `party_attach`, `party_detach` |
| 申请材料 | `deliverables_list`, `deliverable_add`, `deliverable_set` |
| 申请表 | `form_save`, `form_answer_set` |
| 机会池维护 | `watchlist_set`, `watchlist_pick`, `watchlist_drop` |
| 搜寻任务 | `tasks_list`, `task_add`, `task_set`, `task_run` |
| 文件 | `attachments_list`, `attachment_upload`, `attachment_url` |
| 个人信息 | `profile_set` 新增 `tz`，例如 `Asia/Shanghai` |

原有档案、机会卡、机会池和判断文档工具继续保留。`entry_set` 的 `meta` 按键合并；旧工具说明中“整块换”的描述已纠正。

## 读写约定

先读取对象拿到 ID，再局部修改。未传字段不动。新增的分页列表返回 `rows`、`has_more`、`next_offset`，默认每页 50 条、最多 100 条；有下一页时用返回的 offset 继续读取。`stack_get` 也支持分页。

Stack 与自动搜寻任务独立。同名组重复创建返回原组；卡按现有标题/链接规则去重。一张卡最多属于一个显式组。加入别组前需先移出，移出不删除卡。组内卡片分布在不同阶段时，各阶段分别显示该组。显式组即使只有一张卡也会显示组名；旧的任务分组逻辑保留。排序必须提交组内每张卡恰好一次，最多 1000 个 ID。

批量档案导入最多 100 条，同类同名条目跳过；传 ID 才更新已有条目。批量导入与组内批量建卡均为一个事务，失败全部回滚。归档不删除内容，暂时隐藏并不用于申请写作；用 `entries_list` 仍能找到并恢复。

申请材料只写草稿，不覆盖已定稿内容。`form_save` 对同名草稿表保留已有非空答案；明确改某一格用 `form_answer_set`。工具写入的邮件内容仍是草稿。

附件工具接收标准 Base64 文件字节，单文件最多 8 MiB，整体 MCP 请求最多 12 MiB。目标是卡片或档案条目，二选一。先上传字节、再登记附件；登记失败时清理这次上传。文件保存在本人目录下，下载链接有效期 5 分钟。工具不读取服务器路径，也不抓取任意 URL。

新建搜寻任务默认停用、手动运行；只有明确传 `enabled: true` 并指定排期才启用自动运行。时间采用 `profile.data.tz`。

## 实现与验证

数据库迁移：`0167_mcp_workspace.sql`。新表具有 owner、RLS；所有新增写入函数为 security invoker，未登录用户没有执行权限。现有备份机制会自动收录新增表。

集成测试使用官方 MCP Client，通过 HTTP 连接临时 PGlite 数据库，验证真实读写、重复调用、批量回滚、逐题更新、附件和跨账号隔离；另跑现有权限与存储隔离回归测试、看板分组测试和 hosted 前端构建。
