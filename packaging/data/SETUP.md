# Fairwind 上手 · Getting started

从装机到让你自己的 AI 工具替你填档案，全部步骤、命令和要说的话都在这里。中文在前，English below.

**前提**：一台 Apple 芯片的 Mac（M1 以后）；一个模型来源（四选一，见第 2 步）；想用 AI 工具帮你填东西的话，装好 Claude 桌面版（免费版即可）。你的数据只在你这台机器上，不经过任何人的服务器。

---

## 1 · 装机（2 分钟）

打开「终端」（聚焦搜索里输 Terminal），粘这一行，回车：

```
curl -fsSL https://github.com/hudi-la/fairwind-releases/releases/latest/download/install.sh | sh
```

它做四件事：下载最新版、放到 `~/Applications/Fairwind/`、生成 `~/Applications/Fairwind.app`、给它一个图标。装完在**你用户目录下的「应用程序」**（不是系统那个）里双击 **Fairwind**。浏览器会开一页 `http://localhost:8788`（端口被占会自动换一个，不用管）。

以后有新版本，程序里自己提示，点一下就更新；更新前自动备份。

## 2 · 第一次打开

页面会依次问三样，都只存在你这台机器上：

1. **语言**：中文 / English。以后在「设置 → 语言」里能换。
2. **你的邮箱**：只用来在这台机器上认出你，不发信、不上传。
3. **模型来源**（四选一，钱走你自己的账号）：

| 选项 | 要填什么 | 去哪拿 |
|---|---|---|
| Claude API key | `sk-ant-…` | console.anthropic.com → API Keys |
| Claude 订阅（Pro / Max） | 登录令牌 `sk-ant-oat01-…` | 终端里跑 `claude setup-token`，把打出来的那串粘进来（要先装 Claude Code：`npm install -g @anthropic-ai/claude-code`） |
| GPT | `sk-…` | platform.openai.com → API keys |
| Gemini | `AIza…` | aistudio.google.com/apikey |

4. **备份放哪个文件夹**（可先空着）：选一个在 iCloud Drive 或 Google Drive 里的文件夹，备份就自动上了你自己的云。每天一份、更新前一份、留 14 份。

按「开始」。

## 3 · 装哪些模块

右上角 **设置 → 装了哪些**。三层，一层套一层：

- **我的档案**（默认开，关不掉）：你是谁、作品与履历、语气。
- **机会线**：项目争取的看板、写信稿、每周自动找机会。想投东西就开它。
- **邮件**：连 Gmail，来信自动归到线和人，人际管理 / 时间线 / 展开的卡片跟它一起开。**暂不开放**，等通知。

## 4 · 填档案

两种方式，可以混着用。

**A. 页面上手填**：「我的档案」→ 「关于你」填名字、作品站、身份、常住、阶段、资助偏好。左栏「+ 加一栏」挑一类（作品、自述、工作、教育、展览、驻地、策展、技能、工作坊），或者自己起个名（比如「驻地日志」）——点了就建第一条并展开；之后每栏顶上有「+ 加一条」。

**B. 让你的 AI 工具替你填**（推荐，尤其是有作品集网站的人）：

1. Fairwind → 设置 → 「接给你的 AI 工具」→ 点 **Claude 桌面版** 那行的「接入」（用 Codex / Gemini CLI 的点对应那行；用 Claude Code 的在终端粘 `claude mcp add --transport http fairwind http://localhost:8788/mcp`）。
2. 把 Claude 桌面版**完全退出再打开**（Cmd-Q，不是关窗口）。
3. 新开对话，先确认接上了：

> 你现在有哪些 Fairwind 的工具？各是干什么的？

它应该念出十来个 `fairwind_…` 开头的工具。然后：

> 读 https://你的网站.com，把作品、展览、驻地、教育、自述填进 Fairwind。先 list 一遍别重复；每件作品把图片链接一起带上；日期和机构拿不准的标成 draft。填完告诉我加了几条、哪几条不确定。

回到 Fairwind 刷新页面，逐条看；不对的直接在页面上改，或者再跟它说：

> 「XX」那条的年份错了，是 2023；「YY」是群展不是个展。

**结构是你的**：档案的类目和字段不定死。比如：

> 我不维护职业经历，只维护作品和它们背后的概念。给每件作品加一个 meta.概念，两三句。
> 加一个类目叫「合作过的人」，把网站上提到的策展人和机构各做一条。

ChatGPT 聊天 app 接不上（它只认公网地址）；用 ChatGPT 的人装 **Codex**（OpenAI 自己的 agent，ChatGPT 账号能登）。

## 5 · 机会线

设置里开「机会线」，顶栏出现「项目争取」。

- **每周找机会**：「造卡任务」里有一条出厂任务，每周一早上按你的档案找机会、造卡。点开能改时间和提示词（提示词里 `{{画像}}` 会换成你的档案）。想马上试：「现在跑一次」。
- **手动加卡**：跟 AI 工具说

> 把这个链接做成一张机会卡：<url>。截止日期以官方页为准，写清为什么值得。

- **机会池**：所有看过的机会都在，包括没造卡的；「捡出来」就上看板。
- 看板从左到右是流程：新机会 → 匹配项目 → 一起写 → 发出&提交 → 进一步 → 谈成 / 暂停处理。点开一张卡，右边就是跟 Fairwind 的对话，它带着你整个档案和这张卡的全部历史。

**发信永远是你自己的手**。Fairwind 写稿、你复制到邮箱发。

## 6 · 平时

- **Fairwind 在后台跑着**：关掉浏览器页不等于关它（定时任务和 AI 工具都靠它在）。要开页面就再双击 Fairwind。要彻底退出：设置 → 「退出 Fairwind」。
- **数据在哪**：`~/Library/Application Support/Fairwind/`（`db/` 库、`files/` 图和文件、`judgments/` 判据、`settings.json` 设置、`fairwind.log` 日志）。删掉这个文件夹 = 从零开始。
- **备份 / 恢复**：设置 → 备份 → 「现在备份」；恢复是贴一份 `.tar.gz` 的路径，关掉再开生效，旧库改名留着不删。
- **更新**：设置 → 版本 → 「检查更新」。
- **换模型 / 换 key**：设置 → 模型来源。key 只显示头尾几位，从不回显。

## 7 · 出问题

| 现象 | 多半是 | 怎么办 |
|---|---|---|
| 双击没反应 / 页面打不开 | 上次没退干净 | 再双击一次；还不行看 `fairwind.log` 最后几行 |
| Claude 对话里没有 Fairwind 的工具 | 没完全退出 Claude | Cmd-Q 退出再开；Fairwind 得开着 |
| 「接入」按钮说没成 | Claude 桌面版没装或配置文件写不进 | 装 Claude 桌面版；把「没成」后面那句发给胡地 |
| 模型不回话 / 报错 | key 不对或没额度 | 设置 → 模型来源换一个 |
| 更新失败 | 网络 | 稍后再点；旧版本还在，不影响用 |
| 换语言没生效 | — | 选完页面会自己重开；没有就手动刷新 |

问题发给胡地时带上：版本号（设置 → 版本）、`fairwind.log` 最后 30 行。

---

# English

**You need**: an Apple-silicon Mac (M1 or later); one model source (pick one in step 2); and, if you want an AI tool to fill things in for you, the Claude desktop app (free tier is fine). Your data stays on your machine; nothing goes through anyone's server.

## 1 · Install (2 minutes)

Open Terminal (Spotlight → "Terminal"), paste this line, press Enter:

```
curl -fsSL https://github.com/hudi-la/fairwind-releases/releases/latest/download/install.sh | sh
```

It downloads the latest version into `~/Applications/Fairwind/`, creates `~/Applications/Fairwind.app` and gives it an icon. Then double-click **Fairwind** in the Applications folder **inside your home folder** (not the system one). A browser page opens at `http://localhost:8788` (if that port is taken it picks another; you don't need to care).

New versions are announced inside the app; one click updates, with an automatic backup first.

## 2 · First run

The page asks for three things, all stored only on this machine:

1. **Language**: 中文 / English. Change later under Settings → Language.
2. **Your email**: only to recognize you on this machine. Nothing is sent or uploaded.
3. **Model source** (pick one; costs go to your own account):

| Option | What to paste | Where to get it |
|---|---|---|
| Claude API key | `sk-ant-…` | console.anthropic.com → API Keys |
| Claude subscription (Pro / Max) | login token `sk-ant-oat01-…` | run `claude setup-token` in Terminal and paste the output (install Claude Code first: `npm install -g @anthropic-ai/claude-code`) |
| GPT | `sk-…` | platform.openai.com → API keys |
| Gemini | `AIza…` | aistudio.google.com/apikey |

4. **Backup folder** (optional): pick one inside iCloud Drive or Google Drive and backups go to your own cloud. Daily, plus one before every update; 14 are kept.

Press "Start".

## 3 · Modules

Top right: **Settings → Installed**. Three layers, each on top of the previous:

- **My profile** (always on): who you are, works and history, voice.
- **Pursuits**: the board, drafting, weekly opportunity scouting. Turn it on when you want to apply for things.
- **Mail**: connects Gmail; letters file themselves to lines and people; People / Timeline / Open cards come with it. **Not open yet**; you'll be told.

## 4 · Fill your profile

Two ways; mix freely.

**A. By hand**: My profile → About you (name, website, visa, location, stage, funding preference). In the left column, "+ Add a section": pick a built-in kind (works, statement, jobs, education, exhibitions, residencies, curating, skills, workshops) or name your own (e.g. "residency log"); that creates the first entry and opens it. After that each section has "+ Add one" at the top.

**B. Let your AI tool do it** (recommended, especially if you have a portfolio site):

1. Fairwind → Settings → Connect your AI tool → press **Connect** on the Claude desktop row (Codex / Gemini CLI users: their row; Claude Code users: paste `claude mcp add --transport http fairwind http://localhost:8788/mcp` in Terminal).
2. **Quit Claude desktop completely and reopen** (Cmd-Q, not just closing the window).
3. New chat. First check the connection:

> What Fairwind tools do you have, and what does each do?

It should list a dozen tools starting with `fairwind_…`. Then:

> Read https://my-site.com and fill my works, exhibitions, residencies, education and statement into Fairwind. List first so nothing is duplicated; attach image links to each work; mark uncertain dates or organizations as draft. When done, tell me how many you added and which are uncertain.

Back in Fairwind, refresh and check each entry; fix on the page or tell it:

> The year on "XX" is wrong, it's 2023; "YY" is a group show, not a solo.

**The structure is yours**: categories and fields aren't fixed. For example:

> I don't keep a job history, only works and the ideas behind them. Add a `meta.concept` to each work, two or three sentences.
> Add a kind called "people I've worked with" and make one entry per curator and institution mentioned on the site.

The ChatGPT chat app can't connect (it only accepts public URLs); ChatGPT users install **Codex**, OpenAI's own agent, which signs in with a ChatGPT account.

## 5 · Pursuits

Turn on Pursuits in Settings; "Pursuits" appears in the top bar.

- **Weekly scout**: under Card tasks there is a built-in task that searches for opportunities every Monday morning based on your profile and makes cards. Open it to change the schedule and prompt (`{{画像}}` in the prompt is replaced by your profile). To try now: "Run once now".
- **Add a card by hand**: tell your AI tool

> Turn this link into a pursuit card: <url>. Take the deadline from the official page and say why it's worth it.

- **Opportunity pool**: everything ever seen, including what didn't become a card; "Pick up" puts it on the board.
- The board reads left to right: New → Matching → Writing together → Sent & submitted → In conversation → Won / Paused. Open a card and the chat on the right is with Fairwind, which carries your whole profile and the card's full history.

**Sending is always your own hand.** Fairwind drafts; you copy it into your mail client and send.

## 6 · Day to day

- **Fairwind keeps running in the background**: closing the browser tab doesn't stop it (scheduled tasks and AI tools depend on it). Double-click Fairwind again to reopen the page. To quit for real: Settings → "Quit Fairwind".
- **Where the data is**: `~/Library/Application Support/Fairwind/` (`db/` database, `files/` images and files, `judgments/` rules, `settings.json`, `fairwind.log`). Deleting the folder = starting over.
- **Backup / restore**: Settings → Backup → "Back up now"; to restore, paste the path of a `.tar.gz`; takes effect after quitting and reopening; the old database is renamed, not deleted.
- **Update**: Settings → Version → "Check for updates".
- **Change model / key**: Settings → Model source. Keys are shown only as first and last characters, never in full.

## 7 · Trouble

| Symptom | Usually | Do |
|---|---|---|
| Double-click does nothing / page won't open | previous instance didn't exit cleanly | double-click again; if still stuck, read the last lines of `fairwind.log` |
| No Fairwind tools in the Claude chat | Claude wasn't fully quit | Cmd-Q and reopen; Fairwind must be running |
| "Connect" says it failed | Claude desktop not installed, or config file not writable | install Claude desktop; send the error text to Hu Di |
| Model doesn't answer / errors | wrong key or no credit | Settings → Model source, switch |
| Update failed | network | try later; the old version still works |
| Language change didn't apply | — | the page reopens by itself; if not, refresh |

When you write to Hu Di, include the version (Settings → Version) and the last 30 lines of `fairwind.log`.
