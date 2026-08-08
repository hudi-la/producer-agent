# Fairwind 的脑子（brain）

跑在你这台机器上的一个小进程。界面上看不到它，但没有它，机会线底下那个框就只能存话、等不到回复。

**计费走你的 Claude 订阅用量，不烧 API。**

## 起它

```sh
npm run brain          # 在项目根目录；等同于 cd brain && npm start
```

看到这行就是活的：

```
🔥 Fairwind 的脑子醒着  http://localhost:8788
```

前端照常 `npm run dev`。两个都开着，框才能聊。

## 第一次要配一件事

`brain/.env` 里 `SUPABASE_SERVICE_ROLE_KEY` 还是空的。去 Supabase 后台
→ Project Settings → API Keys → **service_role**（点 Reveal），复制粘上。

这个 key 能绕过 RLS 读写整个库，所以：**只许待在这个文件里**。它不进前端 bundle、
不进 git（`.gitignore` 已覆盖 `.env`）。前端用的还是那个只读的 anon key。

## 它能做什么、不能做什么

| | |
|---|---|
| 能 | 读这条机会线的全部往来、你的战绩信息库、你的画像；联网搜、读网页；往往来历史里写一条回复；**建 / 改一份草稿产出**；**读这条线登记过的 Gmail thread**；**把一封信放进你的草稿箱** |
| **不能** | 定稿、**发邮件**、改阶段、改作品盒子、建卡、删东西、翻你的信箱 |

不能那一栏是**结构上做不到**，不是嘱咐它别做：

- **定稿**——数据库那头 `pa_upsert_deliverable` 只碰得到 `status='draft'` 的行，已定稿的它改不动；而把 draft 变 final 的那个函数（`pa_set_final`）压根没 grant 给它。定稿只对浏览器开放，也就是只对你的手开放。
- **发邮件**——claude.ai 的 Gmail 连接器整套工具里**没有 send**，只有读和 `create_draft`。发送这个能力不存在，不是被我们关掉的。
- **翻信箱**——收信只拉这条线在 `producer.pursuit_threads` 里登记过的 thread。它没有「列出所有邮件」的入口。
- **越线**——它每个写口的第一个参数都是 `pursuit_id`。它被关在你正打开的那一条线里，那条线之外的东西够不着。

（口子的全部清单见 `supabase/migrations/0027_deliverables_and_threads.sql` 末尾那段 grant；
工具白名单在 `server.js` 的 `READ_TOOLS` / `GMAIL_TOOLS`。）

⚠️ **白名单不能省。** 2026-08-05 实测发现 Agent SDK 会继承你整台机器的工具配置——
不写 `allowedTools` 的话，Fairwind 拿得到 Bash、Write、Supabase MCP。那两个常量是护栏本身。

## 边界

- **只在这台 Mac 上有效**。手机开线上那个地址，卡片能看、记忆能读，框是哑的。
- 订阅额度跟你自己用 Claude Code 是同一池子，会互相抢。
- 一次回复可能要几十秒（它联网查资料时），界面上会显示「 Fairwind 在想……」。

## 排查

| 界面上说 | 怎么办 |
|---|---|
| Fairwind 的脑子没开 | `npm run brain` 没起，或者端口被占了 |
| 缺配置（终端里） | `.env` 里的 service_role key 还是空的 |
| 读上下文失败 | key 填错了（填成 anon 了？），或者迁移没应用 |
