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
| 能 | 读这条机会线的全部往来、你的战绩信息库、你的画像；联网搜、读网页；往往来历史里写一条回复；**建 / 改一份草稿产出**；**读这条线登记过的 Gmail thread**；**把一封信放进你的草稿箱**；**写一封能直接发的信**（写完在末尾报一声 `[[LETTER]]`） |
| **不能** | 定稿、**按发送键**、改阶段、改作品盒子、建卡、删东西、翻你的信箱 |

不能那一栏是**结构上做不到**，不是嘱咐它别做：

- **定稿**——数据库那头 `pa_upsert_deliverable` 只碰得到 `status='draft'` 的行，已定稿的它改不动；而把 draft 变 final 的那个函数（`pa_set_final`）压根没 grant 给它。定稿只对浏览器开放，也就是只对你的手开放。
- **按发送键**——2026-08-16 之前这一条是「发邮件」：连接器整套工具里没有 send，能力不存在。现在 brain 自己有 `gmail.send` 了，所以护栏挪了位置，没有拆：发送是 `mail/send.js` 里一个纯 HTTP 函数，**不在工具白名单里**，只有页面上那颗按钮能触发。它写得出信，按不了发送键。
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

## 接上 Gmail

全局邮件同步要 brain 自己拿 OAuth 直连 Gmail API——不再走 claude.ai 那个
连接器。为什么换：连接器的工具**只有模型能调**，于是每取一批信都要花一次
模型往返，抓取和理解焊死在一起。65 条机会线里只有 3 条登记过 thread，就是
这么卡住的。换掉之后抓取是纯 HTTP，模型只在「这个地址背后是谁」那一步出场。

scope 是 `gmail.readonly` + `gmail.send`。send 那一格只能发，给不了读的能力。

**护栏没拆，挪了位置**：以前是「这个系统发不出信」，现在是「Fairwind 写得出信，
但按不了发送键」——发送是 `mail/send.js` 里一个纯 HTTP 函数，不在模型的工具
白名单里，只有页面上那颗按钮能触发它。依然是结构上做不到，不是嘱咐。

> ⚠️ **升级到能发信（2026-08-16）要重新授权一次。**
>
>     npm run mail:auth
>
> 旧的授权里没有 `gmail.send` 那一格。不重授的话，按「发送」会报
> **403 insufficient permissions**——而那个报错长得一点也不像
> 「你少授权了一格」，别在别处找原因。

### 一次性配置

1. 开 https://console.cloud.google.com/ ，建一个项目（叫什么都行）。
2. **APIs & Services → Library** → 搜 `Gmail API` → **Enable**。
3. **APIs & Services → OAuth 同意屏幕**（新版界面叫 **Google Auth Platform**，
   左边栏拆成了 Overview / Branding / **Audience** / Clients / Data Access）：
   - **User type 在「Audience」这一页**，选 **External**
     （个人 Gmail 账号只有这一个选项，多半已经是了）
   - 应用名、support email 在「Branding」那页，填你自己的
   - Scopes（Data Access）那步可以跳过——我们在代码里要
   - **还在「Audience」这一页往下拉，找到 Publishing status，
     点「PUBLISH APP」把它从 Testing 改成 In production。**
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**：
   - Application type 选 **Desktop app**
   - 建好之后把 Client ID 和 Client secret 填进 `brain/.env`：
     ```
     GMAIL_CLIENT_ID=…
     GMAIL_CLIENT_SECRET=…
     ```
5. 在 `brain/` 里跑：
   ```
   npm run mail:auth
   ```
   浏览器会开一个 Google 授权页。**「Google 尚未验证此应用」是正常的**——
   这就是你自己刚建的应用，点「高级」→「继续前往」。
   授权成功后凭证落在 `brain/.mail-tokens.json`（已 gitignore）。

### 第 3 步那个「In production」为什么要紧

同意屏幕（Audience 那页）停在 **Testing** 的话，Google 发下来的 refresh token **7 天就过期**。
对一个天天在用的系统，那等于每周挂一次，而且挂的样子是「这轮 0 封新信」——
跟「真的没有新信」长得一模一样。改成 In production 之后 token 是长期的。

（未经 Google 验证也可以 publish。未验证的应用授权时会多一个警告页，
自己用点过去就行。）

### 授权还是会掉的几种情况

代码会明确报 `MailAuthError` 并告诉你怎么修，**不会**静默变成「0 封新信」：

- **你改了 Google 密码** —— 带 Gmail scope 的 token 必失效，最容易撞上
- 6 个月没用过
- 你在 https://myaccount.google.com/permissions 撤销了授权

修法都一样：再跑一次 `npm run mail:auth`。
