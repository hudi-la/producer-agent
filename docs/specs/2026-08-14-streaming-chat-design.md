# 对话边想边出字

2026-08-14

## 现在为什么是「憋着」

一句话发出去到看见回复，中间是三个点在跳，短则十几秒、长则一分多钟。
不是前端偷懒，是整条链路每一节都在攒：

1. `brain/server.js` 的 `think()` 遍历 `query()` 吐出来的消息，把每个 `text`
   块 push 进 `out`，循环结束才 `out.join('\n')` 返回。
2. `POST /chat` 拿到完整的 `reply` 才 `res.end(JSON.stringify(...))`。
3. 前端 `await sendMessage(...)`，promise resolve 之前屏幕上什么都没有。

Claude 那种「一行一行冒出来」要三节全改：模型层要 partial、传输层要能分段、
界面层要有个地方接。

## 改法

### 一、脑子：`think()` 多一个出口

`@anthropic-ai/claude-agent-sdk` 0.3.220 的 `query()` 支持
`includePartialMessages: true`，会额外吐 `type: 'stream_event'` 的消息，
里面是原始的 `content_block_delta`。

`think()` 多收一个可选的 `onEvent`。**传了才开 partial**，不传的行为一个字不变
——「讲懂」「认人」「收信」那几处调用 `think()` 的地方不需要流，也不该为这个
多付一份事件解析。

要紧的一点：**流出去的字不是存进库的字**。库里存的仍然是老路子——
从 `assistant` 消息的 `text` 块攒出来的 `out.join('\n')`。partial 只是给眼睛看的
预览，最后一定拿正式那份把预览换掉。理由是 delta 可能丢、可能顺序怪，
而落库的内容是不能将就的。

块之间的 `\n`：`out` 是按 text 块攒的，join 时每块之间加一个换行。
流这边也要在第二个及之后的 text 块开头补一个 `\n`，不然预览和最终文本会差
几个换行，换的那一下会跳。

顺带把工具动作也报出来（`{t:'tool', name}`）。不是顺手加的功能：它联网查资料
那一轮**一个字都不产**，只有 partial 的话界面跟今天一样是三个死点，
等于这次改在最长的那段等待里没生效。

### 二、传输：新开 `POST /chat/stream`

`/chat` 原样留着。它还有两个用户：App.jsx 的群发（对 N 条线各说一句，
没有一条可见的时间线可以流）和 people.js 里那个通用的 `post()`。
把它改成 SSE 会连累这两处，而它们本来也不需要流。

新路由和 `/chat` **共用同一个 `handleChat`**，只是多传一个 `onEvent`
——不复制业务逻辑，不然两条路早晚走岔。

帧长这样（每帧一行 `data:`，JSON）：

```
{"t":"mine","row":{...}}      你那条落库了（早发，让界面把乐观插入的临时条替换掉）
{"t":"tool","name":"WebSearch"}
{"t":"delta","text":"……"}
{"t":"done","reply":{...}}    或 {"t":"done","aborted":true}
{"t":"error","error":"……"}
```

终止照旧走 `/chat/stop` + `run_id`，那套 AbortController 不动。
另外补一条：连接断了（关页面、切走）也把这一次掐掉 —— 不掐的话它继续想完、
继续写库，而没有任何人在等这份回复。

### 三、界面：预览气泡

`src/lib/chat.js` 加一个读 SSE 的底层函数，机会线和名片两边共用。
`fetch` + `ReadableStream`，按 `\n\n` 切帧 —— 不用 `EventSource`，那个只能 GET。

**脑子是旧的怎么办**：`/chat/stream` 返回 404 就退回老的 `sendMessage`。
一次改动不该让没重启 brain 的人连话都说不了。

两处组件各加一个 `live` 状态存流到一半的文本，`busy` 期间：
`live` 有字就渲染成一个正常的 markdown 气泡（带个闪的光标），
还没有字就还是三个点，旁边挂上工具动作那行字。`done` 一到，
把正式那条塞进 `msgs`、`live` 清空。

**每个 token 不能 setState**。攒在 ref 里，用 `requestAnimationFrame` 刷 —— 
不然一次回复几百次重渲染，加上每次都 `scrollIntoView({behavior:'smooth'})`，
页面会抖成一团。

机会线那边的 3 秒轮询不用改：预览不在 `msgs` 里，而正式回复要到最后才落库，
轮询在流的中途拉不到半截的东西。

## 不改的

- 库里存什么、存的时机（你那条先落、它那条想完再落）—— 一个字不动。
- 群发：N 条线并行，没有一条时间线能流给你看，继续走 `/chat`。
- 「讲懂」「认人」这些后台活：没人盯着屏幕，流给谁看。
