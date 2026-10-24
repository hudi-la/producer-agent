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
| 能 | 读这条机会线的全部往来、你的战绩信息库、你的画像；联网搜、读网页；往往来历史里写一条回复；**建 / 改一份草稿产出**；**读这条线登记过的 Gmail thread**；**把一封信放进你的草稿箱**；**写一封能直接发的信**（写完在末尾报一声 `[[LETTER]]`）；**拨提醒**（聊天里得出「提醒该改」的结论时报一声 `[[STATE]]`，当场落成一条决定笔，提醒栏跟着变，你随时能撤回） |
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

## 你说一句，它判该记成什么（2026-09-11）

「记一笔」按钮退场。你在卡里说的每一句，Fairwind 在同一次回复里顺便判成三种之一：

| 你说的 | 它报的信封 | 落成什么 |
|---|---|---|
| 事件：打了没接 / 表单交了 / 见完了 / 周四再催 | `[[STATE]]`（多一种 `met` = 见成了） | 一条笔，**正文是你的原话**，标签它自己打；状态当场变 |
| 记忆：他是我老师 / 她不爱接电话 / 资助只报销机票 | `[[MEMO]]` | 线上一条 `memo` 笔（不算事件，不进判断队列），或这个人的关系记忆末尾追加一段 |
| 商量 | 无 | 什么都不记 |

每种都有小卡带【撤回】。**同一件事只判一次**：它落的笔自带标签，盲格子（转移表）
不再排队重判 —— 见面复盘那格原来的双判（先问「见成了吗」再由 Fairwind 报 STATE）删了。

脑子没开的时候，输入框换成「这句会直接记成一笔」，回车直接记成 `note` 笔，
脑子醒了由盲格子判。手机上脑子永远没开，那儿就永远是记笔模式。

设计稿：`docs/specs/2026-09-11-say-it-and-fairwind-files-it-design.md`。

## 聊天拨得动提醒（2026-09-04）

提醒栏（🔔 和卡面金字）是 `v_pa_state` 按规则算的；聊天里 Fairwind 带着全卷宗，
判得常常比盲格子准。他定的：**聊天为准，默认落地，按了能撤回。**

- Fairwind 在回复末尾报 `[[STATE]] {"move":…,"why":…}`，七种拨法（`brain/stateMove.js`
  的 `MOVES`）之外的不认。脑子当场调 `pa_apply_state_move`：记一条 decision 笔 +
  一条标签（署名 `fairwind-chat`），提醒栏立刻换。
- 气泡底下一张小卡「提醒改成了：…」带【撤回】。撤回 = `pa_undo_state_move`，软删那条笔、
  删它的标签，state 现算长回原样。回退聊天删掉气泡，它拨的提醒一起撤。
- 七种拨法**全锚在那条新笔上**，一封信已有的标签一个字不动 —— 撤回才只有一个动作。
- 转移表（`judge.js`）一格不改：拨完之后状态机从新 state 继续跑。
  **聊天不是绕过状态机，是拨状态机的手。**
- 聊天的上下文带上提醒那一行（`pa_brain_context.state`）—— 不是让它顺着提醒说，
  是让它知道自己要改的是哪条。

设计稿：`docs/specs/2026-09-04-chat-moves-the-state-design.md`。

## 每周找机会（2026-09-03）

他的持续关注列表原来是盘上那张 Excel（`Desktop/applicaitons/opportunity/HuDi_Opportunities.xlsx`，
82 行），每周由 claude.ai 的定时任务扫一遍，再由人肉搬进 Fairwind 造卡。现在整张表进了
`producer.opportunities`（**机会池**），每周那一轮在脑子里跑，一轮三步：

| | 干什么 | 花多少 |
|---|---|---|
| ① 复查池子 | 挑一批去官网看开了没有。**不是全表每周查一遍** —— 优先级在 `pa_opp_to_check` 里：该开门的 > 该关门的 > 从没查过的 > 最久没查的 | `config.check_per_round`，默认 20 行，6 行一批 |
| ② 出去找新的 | 聚合源 + 搜索。找到的**进池子**，不直接造卡，所以不设条数上限 | 一次调用 |
| ③ 挑 | 本轮开着的行判「以他这个阶段够不够得着」（要真去翻往届名单），够格的造卡 | `config.reach_per_round`，默认 8 个 |

**够得着（reach）是这套东西里唯一需要真做调研的判断**：方向合不合、身份能不能申，读一遍官网就知道；
「够不够得着」得去翻 past fellows / alumni，拿真人的履历跟他的比。所以它单独一步、
只对本轮开着的行做、判完存在行上（**一个机会判一次就够**，300 天后才重判）。
判据和四档在 `brain/reach.js`。

⚠️ **查不到往届名单就存 `unknown`，绝不许编一份出来** —— 编出来的参照比没有参照坏得多，
他会照着它决定投不投。没有 `reach_evidence` 的结论一律降级成 `unknown`（`parseReach` 里那一刀）。

造卡是**门槛不是名额**：`fit ★★★ 且 reach ≠ longshot`，或 `fit ★★ 且 reach = realistic`，
够格的全造。`config.card_cap`（默认 12）只是安全阀，触发了会在战报里说「还有 N 个够格但这轮没造」。

其余的：
- 提示词、每周几点、开不开，都在界面「造卡任务」面板里改（双击提示词进编辑，确定才存）。
- 「现在跑一次」= 把任务拨成 `run_now`，脑子下一轮（30 秒内）就接手。关着的任务也能这样跑一次。
- **脑子没开，到点不会跑。** 开了会立刻补跑，下一次仍按排期算，不漂。
- 战报写进 `tasks.last_result`：三步各一行，包括「还有多少行没轮到」和「查了没收的和原因」。

### 那张 Excel 怎么进来的（一次性）

```sh
npm run import:xlsx            # 加 --dry 只看不写；--file 换路径
```

只读，原文件一个字节都不写。跑完会把池子里的行跟看板上已有的卡对上（`pa_link_pool_to_cards`），
对上的显示「已在看板上」，不会被复查也不会再造一张重的。

护栏没动：模型拿到的还是 `READ_TOOLS`，它只**报**（`[[CARDS]]` / `[[CHECKS]]` / `[[REACH]]`
三种信封），解析和落库是脑子的事，建卡只走 `pa_create_pursuit` 一个口。
设计稿：`docs/specs/2026-09-03-opportunity-pool-design.md`。

## 抄送的人、同机构回信的人，自己进门（2026-09-04）

机构回信时抄送了同事 B、或转给 B 让 B 从自己地址回你——这个 B 以前在系统里不存在：
To/Cc 从第一天就存着，但整条管线只看「对面那一个地址」。真例：Brooke 回信抄送了 Rachel，
Lorna 抄送了 Meighan，Meighan 自己回信还被休假自动回复连累判成「群发」，三个人一个都没有。

现在收信循环里多一步（④.6，`mail/copied.js`），**不过模型**：

| 情形 | 做什么 |
|---|---|
| 在某条线的信串里出现、跟线上的人**同一个机构**（域名相同）、信头有人名署名 | 自动：建名片 → 认领地址 → 挂上线 → 他自己的信搬进对话表 |
| 不同机构的抄送、看着像共享信箱的（info@ / programs@）、没署名的 | 进「新联系人」面板，理由写清是谁在哪条线抄送的 |

gmail.com 这种公共域名不算「同一个机构」。**没署名不编名字**——认不出的端给你看。

来路三处都写：名片「关系记忆」（`contacts.notes`）、`contacts.meta.source`（结构化）、
卡片「相关的人」那一行下面的小字（`pursuit_parties.note`，`added_by='rule'`）。

```sh
npm run mail:copied -- --dry   # 只看它想收谁、想把谁端给你
npm run mail:copied            # 收
```

设计稿：`docs/specs/2026-09-04-copied-people-design.md`。

**一伙人（0122）**：一串信里 ≥2 个人说过话、≥5 个人在场、≥2 个域名、不带群发信头——那是同期的驻地、
一个展的参展者、一个工作坊的学员。这种**不自动收**：在「新联系人」面板顶上一伙一格，写上在哪个活动里
合作过，一个按钮全收。脑子每轮只替它补老信缺的署名（`mail/groups.js`）。

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
