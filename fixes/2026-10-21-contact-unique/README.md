联系人重复添加修复。基于实时正式函数定义，仅新增时按当前 owner + 不区分大小写的邮箱复用已有联系人，不覆盖原资料；编辑路径保持不变。函数仍为 security invoker，保留原权限及 RLS。

安装 pg 并设置 FAIRWIND_DATABASE_URL；node deploy.mjs 执行事务预演，所有测试数据回滚；node deploy.mjs apply 比对基线后发布。测试需要两个已有 auth.users 账号及数据库管理连接，不输出凭据。修复无需服务重启。

回滚前核对线上函数仍等于 fix.sql，再执行 baseline.sql；回滚不删除任何联系人。
