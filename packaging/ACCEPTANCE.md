# ⑥ 验收记录 · 2026-09-16

能做到的最接近"干净机器"的版本：`HOME=/tmp/fakehome`（空目录）、`PATH=/usr/bin:/bin`（没有本机的 node）、
假发布位是本地一个 http 静态服务（brain 的 fetch 不认 `file://`，真发布位是 https）。

| # | 事 | 结果 |
|---|---|---|
| 1 | `sh install.sh`：按平台看 latest.json、下载、sha256 校验、解压到 `~/Applications/Fairwind/app-0.1.0`、`current` 指过去、本机生成 `Fairwind.app` | ✓ |
| 2 | "双击"（执行 `.app` 里的脚本）：只用包里的 node 起 brain，`/health` 报 0.1.0，本机模式，模块只开档案 | ✓ |
| 3 | 首次启动页：邮箱、API key、备份目录 → 进主界面，只有「我的档案」 | ✓ |
| 4 | 写档案（`pa_set_profile`）落库 | ✓ |
| 5 | 「现在备份」→ `~/Backups/fairwind-<日期-时分秒>.tar.gz` | ✓ |
| 6 | 「检查更新」看见 0.1.1 + 说明；顶栏小点 | ✓ |
| 7 | 「更新到 0.1.1」：更新前又备一份 → 下载校验解压 → `current → app-0.1.1`，`app-0.1.0` 还在 | ✓ |
| 8 | 关掉再"双击"：`/health` 报 0.1.1，档案里的名字还在（数据目录没被动） | ✓ |
| 9 | 数据目录里有 `judgments/README.md`、`settings.json`、`db/`、`files/` | ✓ |
| 10 | 包里没有 `.js` 源码、`src/`、`demo/`、`.env`；`brain.jsc` 是字节码（字符串常量仍在，见设计稿十七） | ✓ |
| 11 | 全程页面无 console/page 报错 | ✓ |

另外验过（不在干净目录）：判据文档热重载 + lint 点名（8 条）、模块开关（12 条）、账号块 key 不回显（8 条）。

## 怎么真的发一版

1. 建一个**公开、只放发布物**的 GitHub 仓库（比如 `hudi-creates/fairwind-releases`），Release 里放 zip + `latest.json` + `install.sh`。
2. `packaging/release.json` 填 `latestUrl`（`https://github.com/<你>/fairwind-releases/releases/latest/download/latest.json`）和 `downloadBase`（同前缀）。
3. `packaging/runtime/node-darwin-arm64/bin/node packaging/build.mjs` → `packaging/out/` 里的 zip 和 latest.json 传上去。
4. 学员粘：`curl -fsSL https://github.com/<你>/fairwind-releases/releases/latest/download/install.sh | sh`
5. 以后发新版：改 `package.json` 的 version → 重打 → 传上去。学员那边「检查更新」自己看见。

## 没做的

- win / mac-x64 包（要在那个平台上编字节码；CI 矩阵）
- macOS 首次打开 `.app` 若被 Gatekeeper 拦（脚本本机生成的应该不会；真机上验一次）
- Gmail 共用 OAuth 应用（`setup/defaults.mjs` 的 client id/secret 还是空的——你的一次性动作）
- 学员出厂 scout 任务的默认提示词（机会线模块，下次）
