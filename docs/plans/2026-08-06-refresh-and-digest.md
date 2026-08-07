# 第二刀实施计划：更新最新信息（收信 → 清过期 → 重提下一步）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工具条上一个「更新最新信息」按钮：所有登记过 thread 的线收一遍信；**只在真收到新信的线上**消化——作废过期待办（划掉、说出因为哪封信）、提出新的下一步（带记号、说得出依据）；全部结果进过卡队列。

**Architecture:** 一道迁移（三列 + 视图重建 + 三个 RPC）→ brain 加一个 `/refresh` 口（内部复用 `handleSync`，收到新信才追加一次消化 `think()`）→ 前端串行逐线调 `/refresh` 报进度、结果 enqueue → 卡面和抽屉把「它提的」「作废的」画出来。**闸在数据库层**：propose 的 RPC 拒绝覆盖你写的待办，void 的 RPC 必须给出消息 id。

**Tech Stack:** 同第一刀（React 18 + Vite + node:test 零新依赖）。迁移用 Supabase MCP 的 `apply_migration`。

**上游规格：** [docs/specs/2026-08-06-batch-and-queue-design.md](../specs/2026-08-06-batch-and-queue-design.md) §二（含 2026-08-06 收窄）
**第一刀：** [2026-08-06-filters-picking-and-queue.md](2026-08-06-filters-picking-and-queue.md)（已完成——queue.js 的 `via` 字段、抽屉队列模式都在位）

## Global Constraints

- **已有信息不许消失、不许不可见。** 作废 = 划掉留痕 + 指向那封信，永不删除。
- **宁可不说，也不猜。** 没新信的线②③零触碰；没依据的提案宁可不写。这条在 RPC 层、prompt 层各设一道，不靠单点。
- **你写的待办永不被覆盖。** `next_action_by='you'` 且没做完没作废 → propose RPC 直接拒绝。
- **静默失败是最坏的。** 单线失败不拖累整批，但必须在 Trouble 上说话。
- brain 的工具白名单一个都不放宽（`READ_TOOLS` / `GMAIL_TOOLS` 原样）。
- Fairwind 的新口子第一个参数必须是 `p_pursuit_id`，且**只 grant 给 service_role**——它仍被关在单线里，前端拿不到这两个口。
- 不新增 npm 依赖。中文注释，语气跟现有代码一致。
- 文案固定：`更新最新信息`、`更新中 n/N`、`它提的`、`作废于`、`做完了`、`再等一等`。
- **工作区带着 08-05 的在途改动**（PursuitFocus/styles.css 等 14 个文件）。凡是碰这些文件的 commit，照第一刀的做法部分暂存（`git hash-object -w` + `git update-index --cacheinfo`），保证 commit diff 只含本任务改动、在途工作一行不丢不卷。

---

### Task 1: 迁移 0029 —— 三列、视图、三个口子

**Files:**
- Create: `supabase/migrations/0029_next_action_digest.sql`
- Apply via: Supabase MCP `apply_migration`（name: `next_action_digest`）

**Interfaces:**
- Produces（后续任务全靠这些）：
  - 列 `producer.pursuits.next_action_void_at timestamptz` / `next_action_void_by uuid` / `next_action_by text not null default 'you'`
  - 视图 `v_pa_pursuits` 多出这三列
  - `public.pa_void_next_action(p_pursuit_id uuid, p_msg_id uuid, p_reason text)`（service_role）
  - `public.pa_propose_next_action(p_pursuit_id uuid, p_action text, p_touch date)`（service_role；返回 jsonb `{written: bool, reason: text}`）
  - `public.pa_accept_next_action(p_pursuit_id uuid)`（anon 可调——「你认了」）

- [ ] **Step 1: 写迁移文件**

创建 `supabase/migrations/0029_next_action_digest.sql`：

```sql
-- 「更新最新信息」的数据面：作废、提案、认领。
--
-- 三列三种意思，一列一种（0019 的规矩）：
--   next_action_void_at  这条待办什么时候作废的（作废 ≠ 做完，next_action_done_at 是做完）
--   next_action_void_by  因为哪封信作废的（指向 pursuit_messages，界面上点得回去）
--   next_action_by       这句待办谁写的：you | fairwind。「它提的」记号就认这一列，
--                        不拿文本前缀混在正文里——改文案要迁全库，前端还得字符串匹配。
--
-- 划掉不删掉：next_action 原文永远留着。你翻到卡上看得见「这条本来在，
-- 被这封信作废了」——不是它凭空没了（铁律：看不见 = 丢了）。

alter table producer.pursuits
  add column if not exists next_action_void_at timestamptz,
  add column if not exists next_action_void_by uuid references producer.pursuit_messages(id),
  add column if not exists next_action_by text not null default 'you'
    check (next_action_by in ('you', 'fairwind'));

comment on column producer.pursuits.next_action_void_at is '待办作废时间；作废≠做完，与 done_at 分开';
comment on column producer.pursuits.next_action_void_by is '因为哪封信作废（pursuit_messages.id）';
comment on column producer.pursuits.next_action_by is '这句待办谁写的：you | fairwind';

-- ── 读面：照抄 0023，多三列 ─────────────────────────
drop view if exists public.v_pa_pursuits;
create view public.v_pa_pursuits as
  select p.id, p.title, p.kind, p.org, p.location, p.url, p.funding, p.deadline,
         p.match_stars, p.why, p.notes, p.source, p.eligible, p.stage,
         p.work_id, p.task_id, p.created_at,
         p.next_touch_at, p.payoff, p.contact_id,
         p.opens_at, p.deadline_at, p.next_action, p.next_action_done_at, p.last_touch_at,
         p.next_action_void_at, p.next_action_void_by, p.next_action_by,
         p.jot,
         w.title as work_title,
         c.name  as contact_name,
         c.role  as contact_role,
         p.ball, p.ball_at,
         b.ball_auto,
         case when b.manual_holds then p.ball else b.ball_auto end as ball_eff
    from producer.pursuits p
    left join producer.works    w on w.id = p.work_id
    left join producer.contacts c on c.id = p.contact_id
    left join lateral (
      select m.role, m.created_at
        from producer.pursuit_messages m
       where m.pursuit_id = p.id
         and m.role in ('org','artist')
         and m.kind = 'email'
       order by m.created_at desc
       limit 1
    ) last_ext on true
    cross join lateral (
      select
        case
          when p.next_touch_at is not null and p.next_touch_at <= current_date then 'me'
          when last_ext.role = 'org'    then 'me'
          when last_ext.role = 'artist' then 'them'
          else null
        end as ball_auto,
        p.ball is not null
          and (
            p.ball_at is null
            or (
              (last_ext.created_at is null or last_ext.created_at <= p.ball_at)
              and (p.next_touch_at is null
                   or p.next_touch_at > current_date
                   or p.next_touch_at <= p.ball_at::date)
            )
          ) as manual_holds
    ) b;

grant select on public.v_pa_pursuits to anon, authenticated, service_role;

-- ── Fairwind 的两个新口子（只给 service_role，前端拿不到） ──────
-- 边界同 08-05：第一个参数是 p_pursuit_id，它被关在单线里。
-- 闸设在这儿而不是只在 prompt 里——prompt 会被忽略，数据库不会。

-- 作废：必须说出因为哪封信（p_msg_id 必填且必须是这条线上的消息）。
create or replace function public.pa_void_next_action(
  p_pursuit_id uuid, p_msg_id uuid, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public, producer as $$
declare v_ok boolean;
begin
  if p_msg_id is null then
    return jsonb_build_object('voided', false, 'reason', '没说因为哪封信，不作废');
  end if;
  select exists(select 1 from producer.pursuit_messages m
                 where m.id = p_msg_id and m.pursuit_id = p_pursuit_id) into v_ok;
  if not v_ok then
    return jsonb_build_object('voided', false, 'reason', '那条消息不在这条线上');
  end if;
  update producer.pursuits
     set next_action_void_at = now(),
         next_action_void_by = p_msg_id
   where id = p_pursuit_id
     and next_action is not null
     and next_action_done_at is null      -- 做完的不用作废
     and next_action_void_at is null;     -- 作废过的不重复作废
  if not found then
    return jsonb_build_object('voided', false, 'reason', '这条线没有可作废的待办');
  end if;
  return jsonb_build_object('voided', true);
end $$;

-- 提案：你写的待办（by=you 且没做完没作废）永不覆盖——这一条在库里卡死。
-- Fairwind 自己旧的提案可以被新提案顶掉（它改自己的话不算覆盖你）。
create or replace function public.pa_propose_next_action(
  p_pursuit_id uuid, p_action text, p_touch date default null
) returns jsonb
language plpgsql security definer set search_path = public, producer as $$
begin
  if p_action is null or btrim(p_action) = '' then
    return jsonb_build_object('written', false, 'reason', '空提案不写');
  end if;
  update producer.pursuits
     set next_action = btrim(p_action),
         next_action_by = 'fairwind',
         next_action_done_at = null,
         next_action_void_at = null,
         next_action_void_by = null,
         next_touch_at = coalesce(p_touch, next_touch_at)
   where id = p_pursuit_id
     and not (      -- 你的、活着的待办 → 拒绝
       next_action is not null
       and next_action_by = 'you'
       and next_action_done_at is null
       and next_action_void_at is null
     );
  if not found then
    return jsonb_build_object('written', false, 'reason', '你自己写的待办还活着，不覆盖');
  end if;
  return jsonb_build_object('written', true);
end $$;

-- 你认了它的提案：记号消失。前端直连（跟 pa_set_jot 同一档）。
create or replace function public.pa_accept_next_action(p_pursuit_id uuid)
returns void
language plpgsql security definer set search_path = public, producer as $$
begin
  update producer.pursuits
     set next_action_by = 'you'
   where id = p_pursuit_id
     and next_action_by = 'fairwind';
end $$;

-- 最小权限：Fairwind 的两个口子只有 service_role 够得着。
revoke all on function public.pa_void_next_action(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.pa_void_next_action(uuid, uuid, text) to service_role;
revoke all on function public.pa_propose_next_action(uuid, text, date) from public, anon, authenticated;
grant execute on function public.pa_propose_next_action(uuid, text, date) to service_role;
grant execute on function public.pa_accept_next_action(uuid) to anon, authenticated, service_role;
```

- [ ] **Step 2: 应用迁移**

用 Supabase MCP：`apply_migration`，name `next_action_digest`，query 为上述全文。

- [ ] **Step 3: 验证**

用 Supabase MCP `execute_sql` 跑三条：

```sql
-- 1. 视图有三列了
select next_action_void_at, next_action_void_by, next_action_by
  from public.v_pa_pursuits limit 1;
-- 2. 闸：拿一条有你手写待办的线试 propose，必须拒绝
select public.pa_propose_next_action(
  (select id from producer.pursuits where next_action is not null
     and next_action_done_at is null limit 1),
  '测试提案（不该写进去）');
-- 预期 {"written": false, "reason": "你自己写的待办还活着，不覆盖"}
--（现有 next_action 全是你写的：next_action_by 默认 'you'）
-- 3. void 缺 msg_id，必须拒绝
select public.pa_void_next_action(
  (select id from producer.pursuits limit 1), null);
-- 预期 {"voided": false, ...}
```

改前改后各数一遍行数（pursuits / pursuit_messages），必须一样。

- [ ] **Step 4: 提交**

```bash
git add supabase/migrations/0029_next_action_digest.sql
git commit -m "0029：作废、提案、认领——三列三个口子

闸设在库里：propose 拒绝覆盖你写的活待办，void 必须说出因为哪封信。
Fairwind 的两个口子只 grant 给 service_role，前端够不着。"
```

---

### Task 2: brain `/refresh` —— 收信，收到了才消化

**Files:**
- Modify: `brain/server.js`

**Interfaces:**
- Consumes: `handleSync`（已有）、`loadContext`、`think`、`addMessage`、`db.rpc`、Task 1 的两个 RPC
- Produces: `POST /refresh {pursuit_id}` → `{ok, threads, added, voided: bool, proposed: bool, note?}`

- [ ] **Step 1: 加 handleRefresh**

在 `brain/server.js` 的 `handleSync` 函数**后面**加：

```js
// ── 更新最新信息：收信 → （收到了才）消化 ─────────────────────
//
// 只消化事实，不主动巡逻：added=0 就一个字不写。
// 在没变化的线上编一句凑数的话，哪怕只发生一次，这个按钮就不可信了。
//
// 消化 = 两问：① 新信让现在的待办作废了吗 ② 现在该干什么。
// 答案落库走 0029 的两个口子——闸在库里（你的活待办拒绝覆盖、
// 作废必须指认哪封信），prompt 只是第一道，不是唯一一道。
async function handleRefresh(body) {
  const { pursuit_id } = body
  if (!pursuit_id) throw new Error('要有 pursuit_id')

  const sync = await handleSync({ pursuit_id })
  if (!sync.added) {
    // 没有新信 = 没有新事实 = 不惊动任何东西
    return { ...sync, voided: false, proposed: false }
  }

  // 重新拉上下文——刚收的信要在里面。
  // loadContext 返回的键叫 p（不是 pursuit）；0029 之后 pa_brain_context 的
  // select p.* 自动带上三列新字段，msgs 是整行（含库内 id）。
  const ctx = await loadContext(pursuit_id)
  const p = ctx.p
  const fresh = ctx.msgs.filter((m) => m.kind === 'email').slice(-sync.added - 3)
  const cur = p.next_action && !p.next_action_done_at && !p.next_action_void_at
    ? p.next_action : null

  const { text } = await think(
    `这条机会线刚收到 ${sync.added} 封新信。两个问题，只答有依据的：

【现在卡上的待办】${cur ? `「${cur}」` : '（没有）'}
【近期往来（含新信）】
${fresh.map((m) => `${m.created_at?.slice(0, 10) || '?'} ${m.role === 'artist' ? 'HuDi' : (m.meta?.from_name || '对方')}：${m.content}`).join('\n')}
【截止】${p.deadline_at || p.deadline || '无'}　【该碰日】${p.next_touch_at || '无'}

问题一：新信有没有让卡上那条待办**过期**？（比如「没回就催」而对方回了。）
过期了就指认是哪封信，说一句人话的理由。没过期、或根本没待办，就 null。

问题二：读完新信，这条线**现在**该干什么？必须能指着某封信或某个日期说出依据。
说不出依据就 null——宁可不说，也不猜。凑数的话比空着更坏。
如果该干的事有明确日子（比如信里约了 8/12 回复），给 touch 一个 YYYY-MM-DD。

**最后一行**单独输出，别的什么都不要加：
[[DIGEST]] {"void": {"msg_id": "<作废依据那封信的库内 id，从上面往来里没有就用最新那封的 gmail id 对应行>", "reason": "…"} | null, "next": {"action": "一句话，20 字内", "basis": "依据（哪封信/哪个日期）", "touch": "YYYY-MM-DD 或 null"} | null}`,
    READ_TOOLS,
  )

  const m = text.match(/\[\[DIGEST\]\]\s*(\{[\s\S]*\})\s*$/)
  let digest = null
  try { digest = m ? JSON.parse(m[1]) : null } catch (_) { digest = null }
  if (!digest) {
    // 消化失败不吞掉收信成果——信已经在库里了，只是没消化。说实话。
    return { ...sync, voided: false, proposed: false, note: '信收下了，但这次没消化成（格式不对）' }
  }

  let voided = false
  if (digest.void?.reason) {
    // msg_id 由库校验（必须是这条线上的消息）。模型给的 id 不可靠时，
    // 退回「这次新收的最后一封」——作废的依据就是这批新信。
    const fallback = ctx.msgs.filter((x) => x.kind === 'email').at(-1)?.id || null
    const msgId = ctx.msgs.some((x) => x.id === digest.void.msg_id) ? digest.void.msg_id : fallback
    const { data } = await db.rpc('pa_void_next_action', {
      p_pursuit_id: pursuit_id, p_msg_id: msgId, p_reason: digest.void.reason,
    })
    voided = Boolean(data?.voided)
    if (voided) await addMessage(pursuit_id, 'producer',
      `卡上那条「${cur}」作废了——${digest.void.reason}`)
  }

  let proposed = false
  if (digest.next?.action && digest.next?.basis) {   // 没依据的提案连库都不碰
    const { data } = await db.rpc('pa_propose_next_action', {
      p_pursuit_id: pursuit_id,
      p_action: digest.next.action,
      p_touch: digest.next.touch || null,
    })
    proposed = Boolean(data?.written)
    if (proposed) await addMessage(pursuit_id, 'producer',
      `我看下一步该：${digest.next.action}（依据：${digest.next.basis}）——不对就改掉，认了就勾。`)
  }

  return { ...sync, voided, proposed }
}
```

- [ ] **Step 2: 挂路由**

把 `/gmail-draft` 和 `/sync` 那个合并路由块里的条件改成三口合一：

```js
  if (req.method === 'POST' && (req.url === '/gmail-draft' || req.url === '/sync' || req.url === '/refresh')) {
    const isDraft = req.url === '/gmail-draft'
    const isRefresh = req.url === '/refresh'
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}')
        console.log(`\n→ ${new Date().toLocaleTimeString('zh-CN')} ${isDraft ? '放草稿箱' : isRefresh ? '更新' : '收信'} ${body.pursuit_id}`)
        const out = isDraft ? await handleGmailDraft(body) : isRefresh ? await handleRefresh(body) : await handleSync(body)
        console.log(`  ↳ ${JSON.stringify(out)}`)
        send(res, 200, out)
      } catch (err) {
        console.error('✗', err.message)
        send(res, 500, { error: err.message })
      }
    })
    return
  }
```

- [ ] **Step 3: 语法验证**

```bash
node --check brain/server.js
```

- [ ] **Step 4: 冒烟（不用 Gmail）**

起 brain（或让用户起着），拿一条**没有任何邮件**的线打 `/refresh`：

```bash
curl -s -X POST localhost:8787/refresh -H 'content-type: application/json' \
  -d '{"pursuit_id":"<一条无邮件线的 id>"}'
```

预期：`{ok:true, threads:0, added:0, voided:false, proposed:false, note:"这条线还没有任何邮件往来…"}`——**没有任何 LLM 调用、没写任何东西**。

- [ ] **Step 5: 提交**

`brain/server.js` 带在途改动，照 Global Constraints 部分暂存。

```bash
git commit -m "brain /refresh：收信，收到了才消化

added=0 一个字不写。消化两问（作废了吗 / 现在该干什么）走 0029 的
两个口子，闸在库里。消化失败不吞收信成果，说实话。"
```

---

### Task 3: 前端 —— 按钮、串行循环、进度、进队

**Files:**
- Create: `src/lib/refresh.js`
- Modify: `src/components/Subbar.jsx`（加按钮 + 进度）
- Modify: `src/App.jsx`（循环 + enqueue + Trouble 计数）
- Modify: `src/components/Trouble.jsx`（加一行「N 条线更新失败」）
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `enqueue`（queue.js）、brain `/refresh`（Task 2）
- Produces:
  - `refreshPursuit(id): Promise<{added, voided, proposed, ...}>`（refresh.js）
  - `<Subbar>` 新 props：`onRefresh()`、`refreshing: {i, n} | null`
  - `<Trouble>` 新 prop：`refreshFailed: number`
  - 队列项 `via: 'update'`

- [ ] **Step 1: refresh.js**

创建 `src/lib/refresh.js`：

```js
// 「更新最新信息」的前端侧：一条线一炮，串行由 App 驱动。
//
// 为什么前端驱动循环而不是 brain 一把全跑：进度（更新中 3/40）要实时给人看，
// 单线失败要能跳过接着跑——都是循环在谁手里的问题。brain 只管「一条线怎么更新」。
import { BRAIN } from './backends.js'

export async function refreshPursuit(id) {
  const r = await fetch(`${BRAIN}/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pursuit_id: id }),
  })
  const out = await r.json().catch(() => null)
  if (!r.ok || !out || out.error) throw new Error(out?.error || `HTTP ${r.status}`)
  return out
}
```

（已核实：[backends.js:15](../../src/lib/backends.js#L15) 导出的就叫 `BRAIN`，端口 8788。另注意 `BRAIN_BUILD` 校验：Task 2 改了 brain 之后要把 [backends.js:33](../../src/lib/backends.js#L33) 的 `BRAIN_BUILD` 和 brain 侧的对应常量**一起**升一号，不然 Trouble 会亮「brain 版本旧」——backends.js 有在途改动，这一行的改动照部分暂存规矩走。）

- [ ] **Step 2: Subbar 加按钮和进度**

「更新最新信息」放非选择模式那组的**最前面**（它是日常第一动作）；进度贴在 pickinfo 那个位置：

```jsx
      {/* 系统在报，不能点——所以不进按钮组，灰字带转圈 */}
      {refreshing && (
        <span className="refreshing"><i className="spin" aria-hidden="true" />更新中 {refreshing.i}/{refreshing.n}</span>
      )}
```

```jsx
        <>
          <button className="wbtn" disabled={Boolean(refreshing)} onClick={onRefresh}>更新最新信息</button>
          <button className="wbtn" onClick={onStartPick}>批量操作</button>
          <button className="wbtn" onClick={onOpenTasks}>造卡任务</button>
        </>
```

props 加 `onRefresh, refreshing`。**跑的时候按钮 disabled，别的一切照常**（界面不锁）。

- [ ] **Step 3: App 的循环**

状态 + 循环（放 queue 状态旁边）：

```js
  const [refreshing, setRefreshing] = useState(null)      // {i, n} | null
  const [refreshFailed, setRefreshFailed] = useState(0)   // 上一轮挂了几条，Trouble 用

  // 串行逐线。40 条里多数没邮件，brain 秒回；有信的那几条各要十几秒。
  // 收到东西的线当场进队（via: 'update'）——不等整轮跑完，先到先过。
  const runRefresh = async () => {
    if (refreshing) return
    const list = pl.pursuits
    setRefreshFailed(0)
    let failed = 0
    for (let i = 0; i < list.length; i++) {
      setRefreshing({ i: i + 1, n: list.length })
      try {
        const out = await refreshPursuit(list[i].id)
        if (out.added || out.voided || out.proposed) {
          setQueue((q) => enqueue(q, [{ id: list[i].id, via: 'update' }]))
        }
      } catch (_) {
        failed++
      }
    }
    setRefreshing(null)
    setRefreshFailed(failed)
    loadPursuits().then((r) => { if (r) setPl(r) })   // 立刻把新状态拉回来，不等 8 秒轮询
  }
```

Subbar 传 `onRefresh={runRefresh} refreshing={refreshing}`；Trouble 传 `refreshFailed={refreshFailed}`。

- [ ] **Step 4: Trouble 加一行**

warn 档（数据是真的，只是有几条没更新到）：标题「有 N 条线这轮没更新到」，正文「信没丢——它们只是这轮没收到。brain 的终端里有每条的报错，再按一次「更新最新信息」会重试。」`refreshFailed === 0` 时这行不渲染。

- [ ] **Step 5: 样式**

```css
/* 系统在报：更新到第几条。不能点，会自己消失。 */
.refreshing { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.refreshing .spin { width: 11px; height: 11px; border-radius: 50%; border: 1.5px solid var(--line-2); border-top-color: var(--accent); animation: qspin .8s linear infinite; }
@keyframes qspin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .refreshing .spin { animation: none; } }
```

- [ ] **Step 6: 验证 + 提交**

`npm test`（21 个不动）+ `npm run build`。浏览器：按钮在、按下去 disabled + 进度走、跑完消失。App.jsx/Trouble.jsx/styles.css 有在途改动的照规矩部分暂存。

```bash
git commit -m "更新最新信息：按钮、串行循环、进度、失败上 Trouble

前端驱动循环：进度要实时、单线失败要能跳过接着跑。
收到东西的线当场进队，先到先过。"
```

---

### Task 4: 卡面和抽屉 —— 把「它提的」「作废的」画出来

**Files:**
- Modify: `src/lib/nextAction.js`（actionLine 跳过已作废 + `voidedAction()`）
- Create: `src/lib/nextAction.test.js`
- Modify: `src/components/Pipeline.jsx`（PCard 的「它提的」记号）
- Modify: `src/components/PursuitFocus.jsx`（作废行 + 队列模式顶上「这次发生了什么」+ 认领）
- Modify: `src/lib/chat.js`（`acceptNextAction()` 走 `pa_accept_next_action`）
- Modify: `src/App.jsx`（`finishCard` 对 via='update' 的卡先认领再出队）
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: 视图三列（Task 1）、队列项 `via`（第一刀）
- Produces:
  - `actionLine(p)`：`next_action_void_at` 非空时跳过①，往下走②③；返回对象多一个 `by: 'fairwind' | null`
  - `voidedAction(p): {text, at, byMsg} | null`
  - `acceptNextAction(pursuitId)`

- [ ] **Step 1: 测试先行**

创建 `src/lib/nextAction.test.js`——盖住三件事（用 day() 辅助函数同 filters.test.js）：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actionLine, voidedAction } from './nextAction.js'

test('作废的待办不再出现在「该干什么」那行', () => {
  const p = { next_action: '催 LOA', next_action_void_at: '2026-08-06T10:00:00Z' }
  assert.equal(actionLine(p), null)
})

test('作废但有开放日的卡，往下顺位到开放那条——作废不该让卡哑掉', () => {
  const d = new Date(); d.setDate(d.getDate() + 5); d.setHours(0,0,0,0)
  const pad = (x) => String(x).padStart(2, '0')
  const opens = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const p = { next_action: '催 LOA', next_action_void_at: '2026-08-06T10:00:00Z', opens_at: opens }
  assert.match(actionLine(p).text, /起开放/)
})

test('它提的待办带 by 标记；你写的不带', () => {
  assert.equal(actionLine({ next_action: 'x', next_action_by: 'fairwind' }).by, 'fairwind')
  assert.equal(actionLine({ next_action: 'x', next_action_by: 'you' }).by, null)
  assert.equal(actionLine({ next_action: 'x' }).by, null)   // 旧数据没这列
})

test('voidedAction 把作废行整理出来，含指回那封信的 id', () => {
  const p = { next_action: '催 LOA', next_action_void_at: '2026-08-06T10:00:00Z', next_action_void_by: 'msg-1' }
  const v = voidedAction(p)
  assert.equal(v.text, '催 LOA')
  assert.equal(v.byMsg, 'msg-1')
  assert.match(v.at, /8月6日/)
})

test('没作废就没有作废行', () => {
  assert.equal(voidedAction({ next_action: '催 LOA' }), null)
})
```

跑 `npm test` 确认新文件全红，然后改 `nextAction.js`：

- `actionLine` 第①档条件加 `&& !p.next_action_void_at`；返回值加 `by: p.next_action_by === 'fairwind' ? 'fairwind' : null`（只在①档有意义，②③档 by 恒 null）
- 新增：

```js
/** 被新信作废的待办。划掉留痕：原文、何时、因为哪封信（点得回去）。 */
export function voidedAction(p) {
  if (!p.next_action || !p.next_action_void_at) return null
  const d = new Date(p.next_action_void_at)
  return { text: p.next_action, at: `${d.getMonth() + 1}月${d.getDate()}日`, byMsg: p.next_action_void_by || null }
}
```

跑到全绿（21 + 5 = 26）。

- [ ] **Step 2: PCard 记号**

`pc-act` 那块：`act.by === 'fairwind'` 时行尾加 `<span className="pc-by">它提的</span>`。样式：

```css
/* 它提的、你还没认的待办。认了记号就消失（next_action_by → you）。 */
.pc-by { font-size: 10px; color: var(--accent); border: 1px solid var(--accent-soft); background: var(--accent-soft); border-radius: 5px; padding: 0 5px; margin-left: 6px; flex: none; }
```

- [ ] **Step 3: 抽屉/整页的作废行 + 「这次发生了什么」**

PursuitFocus 的 `fh` 区（`done` 那行旁边）加：

```jsx
          {voided && (
            <p className="pf-void">✗ <s>{voided.text}</s> <span>· {voided.at}作废</span>
              {voided.byMsg && <button className="lnk" onClick={() => jumpTo?.(voided.byMsg)}>因为这封信 →</button>}
            </p>
          )}
```

队列模式（`queue` 非空）且 `via === 'update'` 的卡，对话上方加一段「这次发生了什么」摘要盒：新信几封（点跳最近那封）/ 作废了哪条 / 它提了什么——**全部从库里读**（`msgs` 里最新的 email、`voidedAction(p)`、`actionLine(p).by`），队列不存内容。`via` 要从 App 传进来（qInfo 加一个 `via` 字段）。

```css
.pf-void { font-size: 12px; color: var(--ink-3); }
.pf-void s { text-decoration-color: var(--g2); }
.qwhat { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 10px; padding: 10px 13px; margin-bottom: 12px; font-size: 12.5px; display: flex; flex-direction: column; gap: 5px; }
```

- [ ] **Step 4: 认领**

`chat.js` 加：

```js
/** 你认了 Fairwind 提的下一步：记号消失。 */
export async function acceptNextAction(pursuitId) {
  const { error } = await supa.rpc('pa_accept_next_action', { p_pursuit_id: pursuitId })
  if (error) throw new Error(error.message)
}
```

App 的 `finishCard`：`via === 'update'` 且这张卡 `next_action_by === 'fairwind'` 时，出队前先 `acceptNextAction(id)`（失败不拦出队，alert 说一声）。乐观更新 `next_action_by: 'you'`。

- [ ] **Step 5: 验证 + 提交**

`npm test`（26 绿）+ build + Playwright：
1. 用 Supabase MCP `execute_sql` 给一条测试线手工造状态：`update producer.pursuits set next_action='测试待办', next_action_by='fairwind' where id='<某线>'`——卡上出现「它提的」记号
2. 再造作废态——卡面那行消失，详情里出现划掉的 `✗ 测试待办 · 8月x日作废`
3. 造完**还原原值**（改前先 select 存下来）——测试不留脏数据
4. 队列 via='update' 的卡顶上有「这次发生了什么」

有在途改动的文件照规矩部分暂存。

```bash
git commit -m "卡面认得出「它提的」，划掉的看得见因为哪封信"
```

---

### Task 5: 全链路真跑一次（要你在场）

不是代码任务，是验收仪式——这一步需要 brain 开着、Gmail 连接器活着，只有用户的机器上有这个环境。

- [ ] brain 重启（拿到新 `/refresh` 口）：`npm run brain`
- [ ] 页面上按「更新最新信息」，看进度走完
- [ ] 对着 CultureHub / Paperbark 那几条有真实邮件的线检查：
  - 新信进了左栏往来，没有重复
  - 有待办真过期的线：划掉了、写着因为哪封信、点得回去
  - 提的下一步带「它提的」记号、依据说得通
  - **没新信的线一个字没被动**（抽查两条冷外联线的 updated 状态）
- [ ] 队列里过一遍，「做完了」认掉一条提案，记号消失
- [ ] 按第二次「更新最新信息」：全部 `added: 0`，队列不重复塞

---

## 顺序与依赖

Task 1 → Task 2 → Task 3 → Task 4 → Task 5，严格串行（2 靠 1 的 RPC，3 靠 2 的口，4 靠 1 的视图列，5 靠全部）。

## 明确不做（这一刀）

- 定时自动跑（缓办）
- 清过期管右栏产出（缓办——先验 next_action 一处）
- 你的平台操作当触发源（缓办，规格里记了）
- `basis` 存库——依据活在对话消息里（「我看下一步该⋯（依据：⋯）」），不加列。将来要结构化再说
