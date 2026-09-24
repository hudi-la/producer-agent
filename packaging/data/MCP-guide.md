# 让你自己的 AI 工具读写 Fairwind · Let your own AI tool read and write Fairwind

Fairwind 开了一扇门（MCP）。Claude Code、Claude 桌面版，或任何认 MCP 的工具，连上之后就能替你：读你的作品集网站往档案里填、把一个 open call 做成机会卡、按你的口味改判据。
**结构是你的**：档案的类目和字段不定死——你维护什么、多细，你和你的 AI 商量。

Fairwind exposes an MCP server. Claude Code, the Claude desktop app, or any MCP-capable tool can connect and, on your behalf, fill your profile from your website, turn an open call into a pursuit card, or rewrite your judgment rules in your own words.
**The structure is yours**: categories and fields are not fixed — what you maintain, and how detailed, is between you and your AI.

## 接上 · Connect

地址在「设置 → 接给你的 AI 工具」里，长这样（端口按你机器的来）：
The URL is under Settings → Connect Claude Code. It looks like this (the port depends on your machine):

```
http://localhost:8788/mcp
```

- **Claude 桌面版**（推荐，不用终端）：Fairwind 的「设置 → 接给你的 AI 工具」里点一下「接入 Claude 桌面版」，然后把 Claude 桌面版完全退出再打开。对话里就有 Fairwind 的工具了（它靠 Fairwind 自带的一座小桥连本机，那一下替你写好了配置）。
- **Claude Code**（终端）：粘 `claude mcp add --transport http fairwind http://localhost:8788/mcp`，之后每次打开都带着。
- **ChatGPT 桌面版**：它的连接器只认公网地址，连不到本机——现在走不通。
- **别的工具**：凡是支持 Streamable HTTP 的 MCP 客户端都行，填同一个地址；只认 stdio 的用上面那个 `mcp-remote` 桥。

- **Claude desktop app** (recommended, no terminal): in Fairwind, Settings → Connect your AI tool → "Connect Claude desktop", then quit and reopen the Claude app. Its chats now have Fairwind's tools.
- **Claude Code** (terminal): paste `claude mcp add --transport http fairwind http://localhost:8788/mcp`.
- **ChatGPT desktop**: its connectors require a public URL, so this doesn't work yet.

只认本机连接；Fairwind 得开着。

## 能做什么 · Tools

| 工具 | 干什么 |
|---|---|
| `fairwind_info` | 版本、数据目录、判据目录、哪些模块开着。先调它认认路 |
| `fairwind_profile_get` / `_set` | 「关于你」：名字、作品站、身份、常住、阶段、资助偏好、排除/关注规则 |
| `fairwind_entries_list` | 档案条目。`kind` 不传 = 全部 |
| `fairwind_entry_add` / `_set` | 加一条 / 改一条：`kind`、`title`、`body`、`medium`、`year`、`meta`（任意键值）、`images`（图片链接）、`site_path`、`draft` |
| `fairwind_pursuits_list` | 看板上的机会卡（机会线模块开着才有） |
| `fairwind_pursuit_add` / `_set` / `_note` | 加一张卡 / 改链接截止阶段小记 / 记一笔手记 |
| `fairwind_judgments_list` / `_write` | 读、写五个判据文件（邮件模块开着才有） |
| `fairwind_judgments_preview` | 拿最近判过的几件事用新判据再判一遍，并排看差别 |

### 档案的类目 · Kinds

出厂七种：`work` 作品、`statement` 自述、`job` 工作、`education` 教育、`credit` 展览/驻地/获奖/策展（`meta.type` = 个展 | 群展 | 驻地 | grant | 策展）、`skill` 技能、`offer` 工作坊/可提供。
**也可以用你自己的类目名**（比如 `驻地日志`、`合作过的人`、`委托项目`）：界面上按类目自己长出一栏；`meta` 里写什么就显示什么，Fairwind 写申请时也全看得见。一条都没有的类目不出现。

Seven default kinds, plus **any kind name of your own**. The UI grows a section per kind; whatever you put in `meta` is shown and read by Fairwind. Empty kinds don't appear.

## 试试这几句 · Try saying

- 「读 https://我的网站.com，把作品、展览、教育、自述填进 Fairwind。先 list 一遍别重复；每件作品把图片链接一起带上；拿不准的标成 draft。」
- 「我不维护职业经历，只维护作品和它们背后的概念。给每件作品加一个 meta.概念，两三句。」
- 「把这个链接做成一张机会卡：<url>。截止日期以官方页为准，写清为什么值得。」
- 「按我的口味改判据：投递类 30 天再问；约时间的 5 天没回就提醒；拿不准宁可提醒我。写进 对方来信.md 和 我发出的信.md，改完 preview 给我看变了哪几条。」

- "Read https://my-site.com and fill my works, exhibitions, education and statement into Fairwind. List first so nothing is duplicated; attach image links to each work; mark uncertain ones as draft."
- "I don't keep a job history — only works and the ideas behind them. Add a `meta.concept` to each work, two or three sentences."
- "Turn this link into a pursuit card: <url>. Take the deadline from the official page and say why it's worth it."
- "Rewrite my judgment rules: wait 30 days before asking about submissions; remind me after 5 days of silence on scheduling; when unsure, remind me. Write them into 对方来信.md and 我发出的信.md, then preview what changes."

## 哪些不能碰 · What stays fixed

- 判断返回哪几个字段（要不要回、等多久、约了什么时候、一句话梗概）由程序定，判据文件里写「加一个字段」不生效，会被点名。
- 发信永远是你自己的手。工具里没有发信。
