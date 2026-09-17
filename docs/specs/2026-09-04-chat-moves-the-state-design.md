# 聊天里定的事，拨得动状态机

> 日期：2026-09-04。状态：**设计稿**。
> 接在 [8/19 这条线在等什么](2026-08-19-what-this-line-is-waiting-on-design.md) 后面，转移表一格不改。
>
> **指代**：**你** = Di Hu；**对方** = 线另一头的真人；**Fairwind** = agent。

---

## 〇、病

聊天里 Fairwind 给的法子常常比提醒栏的好（「对方那封已经算回了，不用再等」
「三封没回，之前她明说过感兴趣，打个电话」）。可提醒栏照旧喊「该催了」，
两边各说各的。

原因有三条，都在代码里：

1. **聊天看不见提醒。** `pa_brain_context`（0066）不带 `v_pa_state`，Fairwind
   不知道提醒栏正说着什么，改也没法指名改哪条。
2. **聊天说的话不是事实。** state 是把信、笔、标签重放算出来的（0094），聊天回复
   不在链条里。唯一例外是见面复盘那一格（`handleChat` 里 DEBRIEF × YOUR_ANSWER）。
3. **落地的口子都要你再动一次手**：【已处理】、改期、记一笔。0103 开头记着同一个病
   （「聊定周四再催，结论没口子可落」），当时的解法是加了改期按钮 —— 让你替系统对账。

以前的做法是往转移表加格子追每种新法子。**表管的是「一条事实进来了该问什么」，
聊天管的是「怎么办」。** 两者只需要交汇处一个口子，不需要更多格子。

## 一、原则

- **聊天为准。** Fairwind 在聊天里带着全卷宗，提醒是盲格子按规则算的。两边不一致，
  改的是提醒，不是让聊天顺着提醒说。
- **改法是一个封闭的集合。** 聊天能对状态机做的事只有下面第三节那七种「拨法」，
  每种都落成已有的写口。Fairwind 说不出集合之外的改法，系统也执行不了。
- **默认落地，按了能撤回。**（2026-09-04 他定的：「不是按来确认，而是默认确认，
  按就可以撤回」。）Fairwind 报了信封，brain 当场调 RPC 落成一条 decision 笔 + 标签；
  气泡底下那张小卡写「提醒改成了：…」，带一个【撤回】。撤回 = 那条笔软删，
  state 现算长回原样。跟【收进产出】的分工反过来：它做，你否。
- **每一次拨动都撤得干净。** 所以七种拨法**全部锚在一条新笔上**，不改任何一封信
  已有的标签（改了就得记旧值、就得走 0113 重排，撤回就不干净）。撤回只有一个动作：
  软删那条笔。
- **全程留痕。** 每次拨动都是时间线上一条笔，`situation` 写明「聊天里定的」，
  提醒栏那一行的 `anchor_id` 指回这条笔。撤回了的笔留在库里（deleted_at），
  时间线不显示。没有看不见的改动。

自激的护栏：信封只在**你刚说了一句**（`handleChat`）或**到点起草**（`timerPass`）
这两条路上认；缺 why、缺 due 的一律不落，日志出声；同一条气泡只认一个信封。

## 二、聊天看见提醒（只为了指名改哪条）

`pa_brain_context` / `pa_contact_context` 各带一列 `state`（`v_pa_state` 那一行的
state / what / why / due_at / zone / followups / anchor_id / replied_at）。

prompt 的 perLine 档加一段（**措辞是给它改提醒用的，不是让它服从**）：

```
## 提醒栏现在这样说
「{stateLine}」（{zone}，到点 {due}，锚在 {anchor 那条的日期和梗概}）
这是按规则算的。你手上有全卷宗，你觉得它不对，就照「拨提醒」那条规矩改它。
```

IDLE 时这段写「提醒栏没有这条线的事」。

## 三、七种拨法（`[[STATE]]` 信封）

Fairwind 在聊天回复**最后一行**报，跟 `[[LETTER]]` 同款：

```
[[STATE]] {"move":"…","why":"一句话，凭什么（会显示给他看）", …按 move 带字段}
```

| move | 意思 | 字段 | 落成什么 | 提醒变成 |
|---|---|---|---|---|
| `resolved` | 对方那封信其实已经算回了 / 这事办完了 | 可带 `needs_reply`+`reply_why`（那封信还要你回） | 笔 + `resolves=true`（+ `needs_reply`） | 等待消失；要回的话出「该你回」 |
| `wait` | 改等别的事 / 换法子后等结果（「打电话，等一周看她接不接」） | `awaiting`, `due`(日期) | 笔（正文 = 法子）+ `resolves=true` 关旧的 + `awaiting` + `wait_days` 到 due | 一条新等待，`stopped` 清零（followups 从新笔起算） |
| `reschedule` | 等的事没变，只改到点日（「周四再催」） | `due` | 笔 + `resolves=true` + `awaiting` = 原来那句 + `wait_days` 到 due | 到点日变，等的那句话不变 |
| `park` | 先放着，到某天再看 | `due` | 笔 + `resolves=true` + `awaiting='先放着：…'` + `wait_days` 到 due | 等待区，到那天再进「该动的」 |
| `needs_reply` | 这封其实要回 | `reply_why` | 笔 + `needs_reply=true` + `reply_why` | 该动的：需要回复 |
| `meeting` | 约了日子 | `meet_at` | 笔 + `meet_at` | 约了见面 |
| `done` | 这件事不用管了（跟【已处理】一样） | 无 | 笔 + `resolves=true` | 消失 |

**全部锚在那条新笔上**，一封信已有的标签一个字不动。`reschedule` 的代价是
「等了 N 天」从新笔起算，接受（换来撤回只有一个动作）。

不在表里的 move 一律丢，并在 brain 日志出声。**落库只调现成的 `pa_add_pursuit_note` /
`pa_add_contact_message` + `pa_tag_message`**，包在一个新 RPC 里（第五节）。

到点起草那条路（`timerPass`，尤其 0118 的「换法子」那格）用的是同一个 prompt 基座，
所以它给建议时也能顺手报 `[[STATE]]`：「打电话，等到 9/12」= `wait`。

解析的成对规矩抄 `parseTag`：`wait`/`park` 没 due 就丢；`resolved`/`needs_reply`
没 why 就丢；日期只认 `YYYY-MM-DD`。

## 四、你看见什么

Fairwind 那条气泡底下，跟 LetterCard 并排，出一张小卡，**出现的时候已经改完了**：

```
提醒改成了：等她接电话 · 到 9/12
凭什么：8/11 她回过「很想聊」，三封信没接，签名里有直线
[ 撤回 ]
```

通知栏那行和卡面金字跟着换（它们读的就是 `v_pa_state`，标签一写就变）。
时间线多一条 decision 笔：「聊天里定的：等她接电话 · 到 9/12（凭什么：…）」。

按【撤回】：那条笔软删，提醒长回原样，小卡变成「撤回了」（灰，不再有按钮）。
什么时候按都行，不限时。

回退聊天（`pa_rewind_chat`）删掉了那条气泡，它带的笔一起软删 —— 气泡没了，
它改的提醒不能还在。

【已处理】【改期】【记一笔】都留着，是没聊天时的手工路。

## 五、写口

两个新 RPC。落地的那个把「记笔 + 打标签」并成一个事务：

```sql
public.pa_apply_state_move(
  p_kind text, p_subject uuid,      -- 'pursuit' | 'contact'
  p_move text, p_why text,
  p_awaiting text default null, p_due date default null,
  p_meet_at timestamptz default null,
  p_needs_reply boolean default null, p_reply_why text default null,
  p_src_msg uuid default null        -- Fairwind 那条气泡的 id
) returns uuid                      -- 那条笔的 id
```

- 笔：kind='decision'，正文 = 那张小卡的第一行（「聊天里定的：…」），
  meta = `{state_move: {move, why, src_msg}}`。
- 标签：`situation = '聊天里定的：' || move`，`p_by = 'fairwind-chat'`。
- 只 grant `service_role`：落地是 brain 做的。

撤回：

```sql
public.pa_undo_state_move(p_note uuid) returns void
```

只认 meta 里有 `state_move` 的笔，软删（`deleted_at = now()`）；标签跟着笔一起
从 `v_pa_state` 的 owned 里消失（视图本来就只认 `deleted_at is null`）。
grant anon/authenticated：撤回是你的手。

`pa_rewind_chat` 补一句：被删气泡的 id 出现在某条笔的 `meta.state_move.src_msg` 里，
那条笔一并软删。

## 六、不变的东西

- 转移表（`judge.js`）一格不动。拨完之后状态机从新 state 继续跑：真信来了照旧
  问「解决了等的事吗」。**聊天不是绕过状态机，是拨状态机的手。**
- `v_pa_state` 的算法不动。decision 笔本来就是 `pursuit_messages` 里的一行，
  标签挂上去就参与重放。
- 白名单不动。`[[STATE]]` 是信封不是工具，Fairwind 拿到的还是 `READ_TOOLS`。
- 【已处理】和 `pa_reschedule_wait` 不动。

## 七、验收

1. Descanso 那种：对方回信定了 9/9，标签判成「没解决」。聊天里说「不用等了」→
   `resolved` 当场落地 → 等待消失，那封信要回的话出「该你回」。
2. Arboretum：`stopped`，Fairwind 说打电话 → `wait` 落地「等她接电话 · 9/12」→
   提醒从「别再催了」变成等待区一条，9/12 到点；followups 显示 0。
3. 「周四再催」→ `reschedule` → 到点日变周四，等的那句话不变。
4. 撤回：`v_pa_state` 长回拨动前那一行（state / what / due_at 逐字相同），
   `message_tags` 里那条还在但笔是 deleted。
5. 落地之后一封真信进来：转移表照常从新 state 出发问问题（judge.test 加一例）。
6. 信封字段缺 due / 缺 why：不落，小卡不出，brain 日志一行。
7. 回退聊天删掉气泡 → 它的笔一起软删，提醒长回。
8. `pa_selfcheck_state` 加一条：`situation like '聊天里定的%'` 的标签，笔的 meta
   里都有 `state_move`（撤得回）。

## 八、名词表

| 名字 | 是什么 |
|---|---|
| v_pa_state | 库里算出来的「这条线现在等什么、到点没」，提醒栏和卡面金字都读它 |
| message_tags / 标签 | 每次判断的结果，挂在引发它的那封信或那条笔上 |
| decision 笔 | 记一笔的一种，「拍板了」，是一条真事实 |
| anchor | 提醒那一行锚在哪条信/笔上 |
| [[STATE]] | Fairwind 回复末尾的信封，页面靠它认出「这是一个改提醒的提议」 |
| pa_apply_state_move | brain 收到信封调的那个口，一次完成记笔和打标签 |
| pa_undo_state_move | 【撤回】调的口，软删那条笔 |
| 0113 连坐重排 | 重判一封信，它之后同线的标签删了按顺序重排 |
