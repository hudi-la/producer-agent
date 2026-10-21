# 项目工作约定

## 当前版本基准

用户已确认：个人 localhost 版与 workshop localhost 版均已停用，现在统一使用线上 Fairwind。后续开发和排查以正式站当前源码及正式数据库为基准；旧本地分支仅作历史参考，不再作为两个独立产品维护。

根目录当前 checkout 和 `.claude/worktrees/workshop-edition` 都可能落后于线上，也有未提交改动；不得直接覆盖或清理。`remote-source/` 是 2026-10-13 拉取的 GitHub `workshop-edition` 副本（提交 `796f27d`，提交日期 2026-10-04），尚未与服务器核对，不是线上完整快照。

## 正式发布

Fairwind 的正式地址是 **https://fairwind.hudiworks.com/**。
用户在本项目说“上线 / 发布”时默认使用这个站点，不要再次询问已确认的地址，也不要把本地预览当成正式发布。
发布前读取 [docs/deployment.md](docs/deployment.md)，其中记录服务器、构建、验证及回滚方式。
线上源码可能领先本地 checkout，先检查线上文件，仅合入当前任务改动，保留其他已上线功能。

## 发布代码同步

用户要求：以后每次上线，自动将本次实际发布代码提交并推送到 GitHub，记录提交与发布对应关系。使用隔离 checkout，保留无关未提交改动；不得将凭据或用户数据备份提交。若推送失败，必须明确报告，不得把本地 commit 说成已同步。
