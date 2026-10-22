# DigitalOcean 保留与删除候选清单

盘点日期：2026 年 10 月 21 日，美西时间。范围：已通过 SSH 核查的 `agentist-erp` 主机，IP `64.23.225.65`，Droplet `601827582`。

**这台主机现在不能删除。** 除 ERP 和 Fairwind 外，它还运行正式及测试版 LLM Lab 评测调度、GPU 到期回收器和私有图书服务。本次没有删除、停用或取消续费任何 DigitalOcean 资源。

## 必须保留

| 资源 | 实测状态及用途 | 删除前必须完成 |
| --- | --- | --- |
| 整台 Droplet | 根盘约 154 GB，已用约 13 GB；承载下列服务 | 所有服务迁出并验收、域名不再指向此 IP、备份完成恢复验证 |
| `llm-lab-worker.service` | 正在运行，正式评测 provisioner/grader，程序 `/opt/llm-lab` | 单独迁移正式任务调度、凭证和队列状态，实际提交通过，确认没有在途任务 |
| `llm-lab-worker-staging.service` | 正在运行，测试版 v5 grader，程序 `/opt/llm-lab-staging` | 单独迁移测试评测环境并验证，不得只看正式 worker |
| `llm-lab-reaper.service` | 正在运行，独立 GPU 到期回收器 | 替代回收器上线且真实验证。直接关掉会失去现有的 GPU 到期回收保障 |
| `/var/lib/llm-lab` | 约 57 MB，正式及测试任务状态 | 与任务和远端 GPU 资源逐项对账，保留审计及恢复所需数据 |
| ERP 9 个容器 | backend、frontend、websocket、两类 queue、两类 Redis、MariaDB、Caddy 均运行 | 确认学生旧作业不再依赖 ERP；新环境兼容验收；数据库和附件备份及恢复验证 |
| `enterprise-erp_db` | MariaDB 数据卷，约 340 MB | 做数据库一致性备份并验证可恢复，不能只复制运行中的数据库文件 |
| `enterprise-erp_sites` | 站点配置与附件卷，约 296 KB | 与数据库成套保存，核查站点密钥和文件 |
| `enterprise-erp_queue` | Redis 队列卷，约 4 MB | 排空或迁移待处理任务 |
| `enterprise-erp_apps` / `assets` / `env` | 应用约 1.4 GB、静态资源约 14 MB、Python 环境约 742 MB | ERP 下线确认前仍需保留；可重建不等于现在可删 |
| Caddy 容器、配置和 TLS 数据卷 | 同时为 ERP、Fairwind 和 `/library/` 提供入口；配置在 `/opt/enterprise-erp/Caddyfile` | 各入口分别迁出后才能移除，不能随 ERP 一起删 |
| `zlibrary-web.service` 和 Tor | 正在运行；`erp.agentist.org/library/` 转发到本机 8790，Tor 监听 9050 | 确认是否继续使用；若继续，迁移程序、私有配置及依赖后验收 |
| `/opt/zlibrary` / `/var/lib/zlibrary` | 约 52 MB / 16 KB | 保留私有配置和状态，不放到公开仓库 |
| `fairwind.service` 和 `/var/lib/fairwind` | 正式站仍在旧机运行；私有状态约 178 MiB | Render 登录、模型、持久化和业务验收通过，停旧进程后做最终一致性迁移，再切域名 |

## 条件性删除候选

以下不是现在执行删除的指令。它们主要释放主机磁盘，不会自动降低 Droplet 月费。

| 候选 | 大小或范围 | 条件 |
| --- | --- | --- |
| `/home/fairwind/releases` 内旧发布备份 | 合计约 135 MB | 正式迁移完成、确定回滚保留期，近期回滚版本仍保留；先归档到另一处并验证 |
| `/opt/llm-lab-v5-calibration-20261018a` 至 `20261018e` | 各约 1.3–1.8 MB | 确认实验记录已归档、无人手动使用；系统服务和 cron 未发现指向这些目录的引用，尚不等于无其他依赖 |
| `/opt/llm-lab-v5-confirmation-20261018f` | 约 708 KB | 同上，保留需要的验收证据 |
| `/opt/llm-lab-backup-20261018T223802Z` | 约 404 KB | 确认不再作为 LLM Lab 当前版本的回滚备份 |
| Fairwind 旧程序与 Node 环境 | 程序目录约 1.1 GB，包含依赖 | 正式迁移和观察期结束后，保留恢复包再删除；不包含 ERP 或 LLM Lab |

Docker 实测：9 个容器均运行；14 个卷均被引用；4 个镜像均在使用；没有发现可直接清理的 dangling 卷或镜像。不要照搬 `docker system df` 的 reclaimable 列执行 prune。

## 账号级资源仍需核对

现有 DigitalOcean API 凭证返回 HTTP 401，网页停在登录页。因此本清单不覆盖账号内其他 Droplet、独立块存储、快照、备份计划、负载均衡器、托管数据库或 Reserved IP。不能据此断言这些资源不存在。

两个域名 `fairwind.hudiworks.com` 和 `erp.agentist.org` 当前均解析到 `64.23.225.65`。Fairwind 的 DNS 在 Cloudflare；本次没有修改 DNS。

## 最终删除顺序

1. 先完成 Fairwind 的最终迁移和验收，保留回滚副本。
2. 分别决定 ERP、LLM Lab 正式／测试调度及 GPU 回收器、图书服务的去向。
3. 逐项验证新入口、队列、定时任务和数据恢复，确认没有旧机依赖。
4. 补齐账号级资源盘点，核实需要保留和仍计费的磁盘、快照等。
5. 再由用户确认最终删除清单；本次不执行删除。
