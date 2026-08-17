# 施工：对话边想边出字

稿子：`docs/specs/2026-08-14-streaming-chat-design.md`

## 1. `brain/server.js` — `think()` 收 `onEvent`

- 签名加第 6 个参数 `onEvent`（可选）。
- 传了就 `includePartialMessages: true`。
- 循环里认三种：
  - `m.type === 'stream_event'`：
    - `content_block_start` 且 `content_block.type === 'text'` → 已经出过字就先
      `onEvent({t:'delta', text:'\n'})`（对齐 `out.join('\n')`）
    - `content_block_delta` 且 `delta.type === 'text_delta'` → `{t:'delta', text}`
  - `m.type === 'assistant'`：原样攒 `out`，另外把 `tool_use` 块报成 `{t:'tool', name}`
  - `m.type === 'result'`：原样
- `onEvent` 自己抛错不能带崩这一轮（界面断了不等于活该停）→ 包 try/catch。

## 2. `brain/server.js` — `handleChat(body, onEvent)`

- `mine` 落库后立刻 `onEvent({t:'mine', row: mine})`。
- `think(...)` 那一处把 `onEvent` 透下去。
- 别的不动（abort 分支、finally 清 RUNS、落库都照旧）。

## 3. `brain/server.js` — `POST /chat/stream`

- 头：`text/event-stream` / `no-cache` / `keep-alive` / `x-accel-buffering: no`，
  外加已经设好的那几个 CORS 头。
- `res.on('close')`：还没写完就 `RUNS.get(run_id)?.abort()`。
- `handleChat(body, send)` 成功 → `{t:'done', reply}` 或 `{t:'done', aborted:true}`；
  抛错 → `{t:'error', error: err.message}`。两种都 `res.end()`。
- `BRAIN_BUILD` 顺手推一版（前端靠它提示「脑子是旧的」）。

## 4. `src/lib/chat.js` — 读 SSE

- `streamChat(body, onEvent)`：`fetch` POST → 404 抛一个认得出的错 →
  reader 循环，`\n\n` 切帧，`data: ` 之后 `JSON.parse`。
  返回 `{mine, reply, aborted}`。
- `sendMessageStream(pursuitId, text, meta, runId, onEvent)`：包一层，
  404 就退回现有的 `sendMessage`。

## 5. `src/lib/people.js`

- `sayToContactStream(id, text, onEvent)` → `streamChat({contact_id:id, text}, onEvent)`，
  404 退回 `sayToContact`。

## 6. `src/components/PursuitFocus.jsx`

- `live` / `act` 两个状态 + 一个攒 delta 的 ref + rAF 刷新。
- `send()` 改调 `sendMessageStream`，`mine` 事件到了就替掉临时条。
- `busy` 那块渲染：`live` 有字 → markdown 气泡 + 光标；没字 → 三个点 + `act`。
- 滚动 effect 的依赖加 `live`，去掉 smooth（每帧 smooth 会抖）。
- `finally` 里清 `live` / `act`。

## 7. `src/components/PersonFocus.jsx`

- 同上，接在 `busy === 'talk'` 那个气泡上。

## 8. `src/styles.css`

- `.bubble.streaming::after` 一个闪的光标；`.thinking-act` 一行小字。

## 验

- `npm test`（现有那批不碰这条路，只是别弄坏）
- 手动：开 brain，机会线里说一句 → 字一段段出；中途按终止 → 停住、不写回复；
  名片里说一句 → 同样；群发 N 条 → 走老路，照常。
- 把 brain 停掉再说一句 → 还是那句「脑子没开」，不是一个看不懂的流错误。
