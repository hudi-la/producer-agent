# 设计稿：给渡装上脑子（写回路径 + 本地 sidecar）

> 状态：brainstorming 产出，待评审。日期：2026-08-03。
> 承接 `2026-08-01-artist-producer-agent-design.md` 的「四根柱子 · ①不失忆 ④一起想」。
> 本稿解决一个具体的岔口：**机会线详情页底部那个对话框，接什么。**

---

## 一句话

把 `PursuitFocus` 底下那个假框变成真的：你打字 → 落进 `pursuit_messages` → 本机一个小进程用 **Claude Agent SDK**（挂订阅）带着这条线的全部往来去想 → 回复写回同一张表 → 界面刷新就看见。

## 岔口是怎么定的

原问题是「接 API，还是继续在 Claude Code 里讨论」。实际上是三档，不是两档：

| | 谁提供「会干活」的能力 | 计费 | 判断 |
|---|---|---|---|
| ① Messages API + 多轮对话 | 裸模型只会说话。web search / web fetch 是服务端工具可白拿，但读写 Supabase 得自己写工具 | 按 token | 唯一的**产品化**路径，但现在不是时候 |
| ② **Claude Agent SDK**（= Claude Code 打包成库） | 内置 Read/Write/Edit/Bash/Glob/Grep/WebSearch/WebFetch + MCP + subagent，整套 harness | **可挂订阅（个人自用）** | ✅ 选它 |
| ③ Claude Code 本体（现状） | 同②，但只在终端里，应用碰不到 | 订阅 | 是现状，不是答案 |

选②的理由：能力最全（Supabase MCP 现成能挂、`hudiworks.com` 用 WebFetch 读、scout 用 WebSearch 找）、自用阶段不花钱、跟已定的「计费决定（自用）」一致。

> 放弃的备选：**①现在就上**——按 token 花钱，且读写库的工具要自己造一遍，自用阶段纯亏。留到真给别人用那天。
> 放弃的备选：**框改成纯留言板**（你打字落库，人肉在 Claude Code 里回）——零成本，但那个框永远是半个功能，且「切窗口」这件事本身就是 v0 散架的一部分。

## 不变量：记忆不许住在 Claude Code 里

现状的对话记忆在 `~/.claude/projects/<工作目录>/<session>.jsonl`——**一个 session 一个文件，按工作目录分组，不是按机会线分组**。新开 chat 断片、`/clear` 断片、聊长了压缩吃细节，而且应用查不到、跨不了设备。这正是 v0「每个机会得手动开新 chat、会失忆、散架」的病根。

所以：**`producer.pursuit_messages` 是记忆的唯一真相源。** 脑子每次开工先从库里读这条线的全部往来，收工把新的写回去。换脑子（②→①）时换的是宿主，不是数据。

---

## 架构

```
你的 Mac
├── Vite 前端            localhost:5173     只读走 anon → public.v_pa_*
│      └─ composer ──POST /chat──┐
├── 🆕 brain（sidecar）  localhost:8787     ←┘
│      ├─ Claude Agent SDK（订阅认证）
│      │    ├─ WebSearch / WebFetch   找机会、读 hudiworks.com
│      │    └─ Supabase MCP           读 producer.*
│      └─ service_role key            写 producer.pursuit_messages
└── Supabase（云）        producer schema = 记忆
```

一个 `brain/` 目录，一个进程，`npm run brain` 起。日常可做成 launchd 开机自启。

**为什么必须多一个进程**：Agent SDK 是 Node 库，要文件系统、要起 MCP 子进程，浏览器里跑不了；订阅凭证在 `~/.claude/` 里，也只能在本机用。前端不能直连，中间必须有个东西代跑。

---

## 分两刀

### 第一刀：写回路径（不碰脑子）

前端目前**整个是只读的**（`loadPursuits` 只 select，composer 是个 `<span>` 占位）。先把写路径打通——①②③哪条路都要它，纯赚。

- `PursuitFocus` 的 composer 换成真 `<input>` + 发送
- 新增 `src/lib/sendMessage.js` → `POST http://localhost:8787/chat`
- 乐观渲染：本地先插一条「你」的气泡，标 pending
- brain 没起时：请求失败 → 气泡标「脑子没开」，不丢字

做完这一刀，框就是活的：你说的话真的存进了记忆，只是渡还没回。

### 第二刀：brain sidecar

```js
// POST /chat  { pursuit_id, text }
1. insert pursuit_messages (role:'user', content:text)        // 先落库，永不丢
2. select pursuit + entries + 该线全部 messages → 拼 prompt
3. query({ prompt, options: { mcpServers: {supabase}, allowedTools } })
4. insert pursuit_messages (role:'producer', content:回复)
5. 200 OK
```

**前端怎么知道有回复**：轮询 `v_pa_pursuit_messages`，2 秒一次，只在详情页打开时轮。
> 取舍：不做 SSE 流式。理由——复用已有读路径、断网/关页面都能恢复、代码量差一个量级。等真觉得「等着很空」再升流式。

---

## 权限与安全

- **anon key 保持只读**（浏览器里的 key 是公开的，绝不给写权限）
- **写全部走 sidecar，用 service_role key**，存 `brain/.env`，不进 git、不进前端 bundle
- 已知欠账不变：anon 能读全部 `producer`（含 profile 的 O-1/地址、草稿）。自用本地 OK，**公开部署前必须上 auth + 收紧**——这一刀不动它，但别忘了

## 护栏：渡只能说话，不能替你按按钮

第一版 brain **只允许 insert `pursuit_messages`**。不能改 stage、不能改盒子、不能建卡、不能删。

理由是原设计里那条：「**一起想 = 协作台面，不是自动化按钮**」。渡提议「这个该进挑作品阶段了」，动手的是你。等这套跑顺了、你确认想让它动手，再单独开一刀讨论给哪些写权限。

---

## 边界（说在前面，别到时候意外）

- **只在这台 Mac 上有效**。手机开 Cloudflare Pages 那个地址，卡片能看、记忆能读，框是哑的
- 换电脑要重装 brain
- **订阅额度是共享的**——你自己写代码也在烧 Claude Code，会抢
- 给别人用的那天，brain 得搬上云 + 换 Messages API 计费。记忆在 DB，所以这次搬家换的是脑子宿主

## 待验证（做之前先冒烟）

1. **Agent SDK 能不能真挂订阅跑通**——这条是整个方案的承重墙。先写十行 `query()` 打印一句话，确认不需要 `ANTHROPIC_API_KEY`
2. Supabase MCP 在 Agent SDK 里挂上后，能不能读到 `producer` schema（前端是绕道 `public.v_pa_*` 视图的，MCP 直连可能要单独授权）
3. 一条线的全部往来拼进 prompt 后有多长——Eyebeam 那条有 5 条，还早；但要想好长了怎么办（先截最近 N 条，别急着上压缩）
