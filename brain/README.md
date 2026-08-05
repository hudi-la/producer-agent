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
| 能 | 读这条机会线的全部往来、你的战绩信息库、你的画像；联网搜、读网页；往往来历史里写一条回复 |
| **不能** | 改阶段、改作品盒子、建卡、删东西 |

不能那一栏是**结构上做不到**，不是嘱咐它别做——数据库那头只开了「读上下文」和
「写一条消息」两个函数（`supabase/migrations/0009_brain_rpc.sql`），没有别的口。
Fairwind 本人拿到的工具也只有 WebSearch / WebFetch，它连数据库都碰不到，是这个进程代它读写的。

想让它能动阶段和盒子，是另开一刀的事，先把「一起想」跑顺。

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
