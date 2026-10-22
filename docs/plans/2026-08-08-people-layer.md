# 人际管理第一刀 · 实施计划

> **给执行的人：** 用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务实施。步骤是 `- [ ]` 复选框。

**目标：** 把「人」立成独立一层，让已经造好的邮件流水线（认领 thread → 拉信 → 起草 → 进 Gmail 草稿箱）能跑在**没有机会线**的往来上，验收标准是 Maisa 那封信走通全程。

**设计稿：** [docs/specs/2026-08-08-people-layer-design.md](../specs/2026-08-08-people-layer-design.md)

**做法：** 三张已有的表（`pursuit_messages` / `pursuit_threads` / `deliverables`）从「只能挂机会线」改成「要么挂线、要么挂人」，一道自校验的迁移把现有邮件按人认领；四种由头写成纯函数，接进已有的过卡队列；人际管理页复用详情页那三栏的形状。

**技术栈：** Postgres（Supabase 迁移）· React 18 + Vite · `node --test`（纯逻辑）· brain sidecar（Node，Claude Agent SDK + Gmail MCP）

## 全局约束

- **绝不丢信息。** 这是天天在用的真实系统。任何改动不许让已有信息消失或不可见。迁移必须自校验，数字对不上就 `raise exception` 整道回滚。
- **卡上说得出为什么。** 任何日期、任何提醒，都要能说出来源（`红点不再撒谎`、`「到日子了」也得说得出是哪个日子`）。
- **不加 cron。** 四种由头全部挂在你已有的动作上（页面加载 / 按「更新最新信息」/ 你记一笔）。
- **不改表名。** `pursuit_messages` 名字不准了，加 `comment on table` 说清楚即可。
- **迁移编号从 0032 起。** 现有最新是 `0031_message_meta.sql`。
- **注释写中文，说人话，说清为什么。** 跟现有代码一致——解释取舍，不复述代码。
- **测试命令：** `npm test`（= `node --test 'src/lib/*.test.js'`）。只有 `src/lib/` 下的纯函数有测试，迁移用自校验 SQL，UI 靠手动走一遍验收。

---

### Task 1: 迁移 0032 —— contacts 长成第一公民

**Files:**
- Create: `supabase/migrations/0032_people_layer_contacts.sql`

**Interfaces:**
- Produces: `producer.contacts` 新增 `channels / intro_by / intro_thanked_at / last_touch_at / last_touch_src / cadence_days / next_touch_at / next_touch_why`；视图 `public.v_pa_contacts` 带上这些列并 **grant 给 anon**。

- [ ] **Step 1: 写迁移**

```sql
-- Producer Agent — 人这一层：contacts 从「外联的附属」变成第一公民
--
-- 设计稿：docs/specs/2026-08-08-people-layer-design.md 第三节
--
-- 背景：0011 建 contacts 是为了冷外联——「信是发给人的，不是发给机构的」。
-- 但它只有 email 一个渠道、没有任何联系节奏，而且整张表挂在机会线下面。
-- 这一刀之后它是第一公民：人可以没有机会线而存在（Maisa 就是）。
--
-- 刻意没动 email 那一列：它上面的唯一索引是去重的地基，channels 是补充不是替代。
-- 为了整洁把地基拆了不值得。

alter table producer.contacts
  add column if not exists channels         jsonb not null default '[]'::jsonb,
  add column if not exists intro_by         uuid references producer.contacts(id) on delete set null,
  add column if not exists intro_thanked_at date,
  add column if not exists last_touch_at    date,
  add column if not exists last_touch_src   text,
  add column if not exists cadence_days     int,
  add column if not exists next_touch_at    date,
  add column if not exists next_touch_why   text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_touch_src_chk') then
    alter table producer.contacts add constraint contacts_touch_src_chk
      check (last_touch_src is null or last_touch_src in ('email', 'checkin', 'meet'));
  end if;
end $$;

comment on column producer.contacts.channels is
  '[{kind,value,primary}]，kind ∈ email|wechat|sms|whatsapp|ig|phone。用 jsonb 不用列：渠道会一直长（IG DM 迟早要），列会一直加';
comment on column producer.contacts.last_touch_src is
  '上次碰的日期从哪来：email=库里那封信 / checkin=你打卡 / meet=你记的线下一笔。没有它，那个日期就是来路不明的数字';
comment on column producer.contacts.next_touch_why is
  '这个日子哪来的，存原话（他说 "circle back next semester"）。认不出来就两列都不写，不猜';
comment on column producer.contacts.cadence_days is
  '你给这个人定的节奏。null = 不管他——大多数人都是 null，这是对的';

create index if not exists contacts_next_touch_idx
  on producer.contacts (next_touch_at) where next_touch_at is not null;

-- ── 视图：加新列，并开给 anon ──────────────────────────────────
-- 0011 当时把这张视图 revoke 掉了 anon（notes 里有私人内容），可整个 app 走的
-- 正是 anon、没有登录。而邮件正文（v_pa_pursuit_messages）从 0027 起就对 anon
-- 开着了——contacts 一直关着是个**不一致**，不是一道真的墙。
-- 这儿把它补齐。收紧登录是另一刀，见设计稿缓办五。
drop view if exists public.v_pa_contacts;
create view public.v_pa_contacts as
  select id, name, email, org, role, notes, channels,
         intro_by, intro_thanked_at,
         last_touch_at, last_touch_src, cadence_days,
         next_touch_at, next_touch_why,
         created_at, updated_at
    from producer.contacts;

grant select on public.v_pa_contacts to anon, authenticated, service_role;
```

- [ ] **Step 2: 跑迁移**

在 Supabase SQL Editor 里整段执行（或 `supabase db push`，看项目现有做法）。

- [ ] **Step 3: 验证列都在、anon 读得到**

```sql
select column_name from information_schema.columns
 where table_schema = 'producer' and table_name = 'contacts'
   and column_name in ('channels','intro_by','intro_thanked_at','last_touch_at',
                       'last_touch_src','cadence_days','next_touch_at','next_touch_why');
-- 预期：8 行

select grantee, privilege_type from information_schema.role_table_grants
 where table_name = 'v_pa_contacts' and grantee = 'anon';
-- 预期：1 行 SELECT
```

- [ ] **Step 4: 提交**

```bash
git add supabase/migrations/0032_people_layer_contacts.sql
git commit -m "0032：contacts 长成第一公民——多渠道、谁介绍的、上次碰过哪天"
```

---

### Task 2: 迁移 0033 —— 往来改挂人（含自校验）

**Files:**
- Create: `supabase/migrations/0033_people_layer_own_threads.sql`

**Interfaces:**
- Consumes: Task 1 的 `producer.contacts` 新列
- Produces: `pursuit_messages` / `pursuit_threads` / `deliverables` 三张表各有 `contact_id`，`pursuit_id` 可空，带 `check (pursuit_id is not null or contact_id is not null)`；视图 `v_pa_pursuit_messages` / `v_pa_deliverables` 末尾追加 `contact_id`；新视图 `v_pa_threads`。

- [ ] **Step 1: 写迁移**

```sql
-- Producer Agent — 往来改挂人：三张表要么挂线、要么挂人
--
-- 设计稿：docs/specs/2026-08-08-people-layer-design.md 第三节
--
-- 为什么：往来常常**先于**机会线。Tom Leeser 介绍了 Maisa → 你发信 → 他回了，
-- 这时候还什么都不是。可 pursuit_messages / pursuit_threads / deliverables
-- 第一列都是 pursuit_id not null，所以这封信在库里没有地方放。
--
-- 划线的判据不是新发明的，是数据自己已经分开了的：
--   · 有 gmail_message_id（role 只能 org|artist，0027 有硬校验）→ 跟外面的人的真实往来 → 归人
--   · 没有（role 是 producer|artist）→ 你跟 Fairwind 的商量 → 归线
--
-- 表名不改：pursuit_messages 装的已经不只是机会线的消息了，名字确实不准，
-- 但改名要动 brain 一串 RPC、两个视图、前端一堆引用——纯代价零收益。

-- ══ 一、三张表加人 ═════════════════════════════════════════════
alter table producer.pursuit_messages
  add column if not exists contact_id uuid references producer.contacts(id) on delete set null;
alter table producer.pursuit_messages alter column pursuit_id drop not null;
create index if not exists pm_contact_idx
  on producer.pursuit_messages (contact_id, created_at) where contact_id is not null;

alter table producer.deliverables
  add column if not exists contact_id uuid references producer.contacts(id) on delete set null;
alter table producer.deliverables alter column pursuit_id drop not null;
create index if not exists deliverables_contact_idx
  on producer.deliverables (contact_id, status, sort) where contact_id is not null;

-- pursuit_threads 的主键是 (pursuit_id, gmail_thread_id)，pursuit_id 要可空就得换主键。
-- 换成代理主键 + 两条部分唯一索引（按线一条、按人一条），
-- 「同一条线不能登记同一个 thread 两次」这条保证一点没丢。
alter table producer.pursuit_threads
  add column if not exists id         uuid not null default gen_random_uuid(),
  add column if not exists contact_id uuid references producer.contacts(id) on delete set null;
alter table producer.pursuit_threads drop constraint if exists pursuit_threads_pkey;
alter table producer.pursuit_threads add primary key (id);
alter table producer.pursuit_threads alter column pursuit_id drop not null;
create unique index if not exists pt_by_pursuit
  on producer.pursuit_threads (pursuit_id, gmail_thread_id) where pursuit_id is not null;
create unique index if not exists pt_by_contact
  on producer.pursuit_threads (contact_id, gmail_thread_id) where contact_id is not null;

-- ══ 二、迁移数据 ═══════════════════════════════════════════════
-- ① 有 gmail_message_id 的消息 → 从它所在 pursuit 的 contact_id 取人
update producer.pursuit_messages m
   set contact_id = p.contact_id
  from producer.pursuits p
 where m.pursuit_id = p.id
   and m.gmail_message_id is not null
   and m.contact_id is null
   and p.contact_id is not null;

-- ② 那条 pursuit 根本没有 contact_id 的 —— 从邮件里认人。
--
-- 这是整道迁移唯一脏的一步。meta->>'from_name' 存的是 Gmail 的 from 字段
-- （brain/server.js 写的），可能是「名字 <邮箱>」也可能只有名字，**不保证是干净的邮箱**。
-- 所以这儿只拿它当名字用，邮箱留空——下次收信或你手填。
--
-- 建出来的人会出现在人际管理页上，而你从没手动加过他们。这不是副作用：
-- 这正是他们第一次进系统。
do $$
declare r record; cid uuid;
begin
  for r in
    select p.id as pid, p.org,
           (select m2.meta->>'from_name'
              from producer.pursuit_messages m2
             where m2.pursuit_id = p.id and m2.role = 'org' and m2.gmail_message_id is not null
             order by m2.created_at limit 1) as from_name
      from producer.pursuits p
     where p.contact_id is null
       and exists (select 1 from producer.pursuit_messages m
                    where m.pursuit_id = p.id and m.gmail_message_id is not null)
  loop
    insert into producer.contacts (name, org, notes)
    values (coalesce(nullif(btrim(r.from_name), ''), r.org, '未具名联系人'),
            r.org,
            '0033 迁移从这条线的邮件里认出来的人。邮箱还没有——下次收信或你手填。')
    returning id into cid;

    update producer.pursuits         set contact_id = cid where id = r.pid;
    update producer.pursuit_messages set contact_id = cid
     where pursuit_id = r.pid and gmail_message_id is not null and contact_id is null;
  end loop;
end $$;

-- ③ thread 和产出照着线上的人补一份引用
update producer.pursuit_threads t set contact_id = p.contact_id
  from producer.pursuits p
 where t.pursuit_id = p.id and p.contact_id is not null and t.contact_id is null;

update producer.deliverables d set contact_id = p.contact_id
  from producer.pursuits p
 where d.pursuit_id = p.id and p.contact_id is not null and d.contact_id is null;

-- ④ 每个人的「上次碰」从邮件回填。来源写 email——日期说得出出处。
update producer.contacts c
   set last_touch_at = x.d, last_touch_src = 'email'
  from (select contact_id, max(created_at)::date as d
          from producer.pursuit_messages
         where contact_id is not null and gmail_message_id is not null
         group by contact_id) x
 where c.id = x.contact_id and c.last_touch_at is null;

-- ══ 三、护栏：不许出现无主数据 ═════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pm_owner_chk') then
    alter table producer.pursuit_messages add constraint pm_owner_chk
      check (pursuit_id is not null or contact_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pt_owner_chk') then
    alter table producer.pursuit_threads add constraint pt_owner_chk
      check (pursuit_id is not null or contact_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deliverables_owner_chk') then
    alter table producer.deliverables add constraint deliverables_owner_chk
      check (pursuit_id is not null or contact_id is not null);
  end if;
end $$;

-- ══ 四、自校验：数字对不上就整道回滚 ═══════════════════════════
-- 「绝不丢信息」不是嘱咐，是这段代码。迁移和验收在同一个事务里，
-- 少一封就 raise，整道 migration 回滚，库回到动手之前。
do $$
declare n_mail int; n_owned int;
begin
  select count(*) into n_mail
    from producer.pursuit_messages where gmail_message_id is not null;
  select count(*) into n_owned
    from producer.pursuit_messages where gmail_message_id is not null and contact_id is not null;
  if n_mail <> n_owned then
    raise exception '迁移没做完：% 封邮件里有 % 封没有主，整道回滚。',
      n_mail, n_mail - n_owned;
  end if;
  raise notice '✓ % 封邮件全部认领到人', n_mail;
end $$;

-- ══ 五、读面 ═══════════════════════════════════════════════════
-- create or replace 只能在末尾追加列，前面的列名/顺序一个都没动。
create or replace view public.v_pa_pursuit_messages as
  select id, pursuit_id, role, kind, content, meta, created_at,
         gmail_message_id, body_raw, contact_id
    from producer.pursuit_messages;
grant select on public.v_pa_pursuit_messages to anon, authenticated, service_role;

create or replace view public.v_pa_deliverables as
  select id, pursuit_id, kind, title, body, rules, status, finalized_at,
         blocked_by, blocked_ref, depends_on, source, source_msg, due, meta,
         created_by, sort, created_at, updated_at, contact_id
    from producer.deliverables
   order by sort, created_at;
grant select on public.v_pa_deliverables to anon, authenticated, service_role;

-- 认领的 thread 以前前端看不见（只有 brain 用）。名片上要显示「认领了几条往来」，
-- 所以开一张读面出来。
create or replace view public.v_pa_threads as
  select id, pursuit_id, contact_id, gmail_thread_id, last_synced_at, added_by, created_at
    from producer.pursuit_threads;
grant select on public.v_pa_threads to anon, authenticated, service_role;

comment on table producer.pursuit_messages is
  '名字不准了：它装的不只是机会线的消息。有 gmail_message_id 的是跟外面的人的往来（归 contact_id），没有的是你跟 Fairwind 的商量（归 pursuit_id）。改名要动一串 RPC 和视图，纯代价零收益，所以留着这条注释';
```

- [ ] **Step 2: 先记下迁移前的数**

```sql
select count(*) from producer.pursuit_messages where gmail_message_id is not null;
-- 记下这个 N
```

- [ ] **Step 3: 跑迁移**

整段执行。**看到 `NOTICE: ✓ N 封邮件全部认领到人` 才算过**；看到 `ERROR: 迁移没做完` 说明有信没认领到人，整道已回滚，去查是哪条线的 meta 里没有 from_name。

- [ ] **Step 4: 验收**

```sql
-- 一封都不能没有主
select count(*) from producer.pursuit_messages
 where gmail_message_id is not null and contact_id is not null;   -- 必须 = Step 2 的 N

-- 看看迁移建出来了哪些人
select id, name, org, last_touch_at, last_touch_src from producer.contacts order by created_at;

-- 无主数据一行都不该有
select count(*) from producer.pursuit_messages where pursuit_id is null and contact_id is null;  -- 0
select count(*) from producer.pursuit_threads  where pursuit_id is null and contact_id is null;  -- 0
select count(*) from producer.deliverables     where pursuit_id is null and contact_id is null;  -- 0
```

- [ ] **Step 5: 提交**

```bash
git add supabase/migrations/0033_people_layer_own_threads.sql
git commit -m "0033：往来改挂人——要么挂线要么挂人，迁移自校验，少一封就回滚"
```

---

### Task 3: 队列能装人

**Files:**
- Modify: `src/lib/queue.js`
- Test: `src/lib/queue.test.js`

**Interfaces:**
- Produces:
  - `key(kind, id) -> string`（`'pursuit:uuid'`）
  - `keyOf(item) -> string`
  - `parseKey(k) -> {kind, id}`
  - `enqueue(q, [{kind, id, via}]) -> q`
  - `done(q, key)` / `later(q, key, on?)` / `inQueue(q, key)`（**参数从裸 id 换成 key**）
  - `q.items` 每项是 `{kind, id, via, skipped, skippedAt}`，`q.at` 是 key 字符串

- [ ] **Step 1: 先写会失败的测试**

追加到 `src/lib/queue.test.js`：

```js
import { key, keyOf, parseKey } from './queue.js'

const P = (id) => ({ kind: 'pursuit', id })
const C = (id) => ({ kind: 'contact', id })

test('旧存档没有 kind —— 一律当 pursuit，一项都不丢', () => {
  const old = { items: [{ id: 'a', via: 'pick' }, { id: 'b', via: 'update' }], at: 'b' }
  const q = normalize(old)
  assert.equal(q.items.length, 2)
  assert.equal(q.items[0].kind, 'pursuit')
  assert.equal(q.at, 'pursuit:b')          // 裸 id 的光标也要认回来
  assert.equal(q.items[1].via, 'update')   // via 不能被清掉
})

test('人和机会线撞同一个 id 也是两项 —— 去重按 kind+id', () => {
  const q = enqueue(EMPTY, [P('x'), C('x')])
  assert.equal(q.items.length, 2)
  assert.deepEqual(q.items.map(keyOf), ['pursuit:x', 'contact:x'])
})

test('同一个人塞两次还是一项，via 更新', () => {
  const q = enqueue(enqueue(EMPTY, [C('m')]), [{ ...C('m'), via: 'bump' }])
  assert.equal(q.items.length, 1)
  assert.equal(q.items[0].via, 'bump')
})

test('做完一个人：拿走，光标落到下一张', () => {
  const q = done(enqueue(EMPTY, [C('m'), P('p')]), key('contact', 'm'))
  assert.deepEqual(q.items.map(keyOf), ['pursuit:p'])
  assert.equal(q.at, 'pursuit:p')
})

test('key / parseKey 转得回来', () => {
  assert.equal(key('contact', 'abc'), 'contact:abc')
  assert.deepEqual(parseKey('contact:abc'), { kind: 'contact', id: 'abc' })
})
```

同时把文件里已有的 `q3()`、`ids()` 两个辅助改成带 kind 的写法，其余断言跟着换成 key：

```js
const q3 = () => enqueue(EMPTY, [P('a'), P('b'), P('c')])
const ids = (q) => q.items.map(keyOf)
// 已有断言里的 ['a','b','c'] → ['pursuit:a','pursuit:b','pursuit:c']
// done(q3(), 'a')            → done(q3(), key('pursuit','a'))
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `npm test`
Expected: FAIL —— `key is not a function` / `normalize` 出来的 `at` 还是裸 id

- [ ] **Step 3: 改 queue.js**

文件头那段注释后面补一段，说清为什么队列是一条：

```js
// 队列**是一条，不是两条**。顶栏那个数字说的是「你还欠着几件事」——
// 它是手头这摊活，不是某个区的活。所以一项要说清自己是什么：
// kind='pursuit' 是机会线，kind='contact' 是人。
//
// 旧存档里的项没有 kind（那时候只有机会线），读回来一律当 pursuit——
// 这正是 normalize 存在的理由，localStorage 里现有的队列一项都不会丢。
```

替换身份相关的部分：

```js
/** 队列里认身份的键。旧存档没有 kind，一律当 pursuit。 */
export const key = (kind, id) => `${kind === 'contact' ? 'contact' : 'pursuit'}:${id}`
export const keyOf = (x) => key(x.kind, x.id)
/** 从键拆回来 —— 界面拿它去库里读对应的东西。 */
export const parseKey = (k) => {
  const i = String(k).indexOf(':')
  return i < 0 ? { kind: 'pursuit', id: String(k) } : { kind: k.slice(0, i), id: k.slice(i + 1) }
}
/** 旧存档里 at 是裸 id。 */
const atKey = (a) => (typeof a === 'string' && a ? keyOf(parseKey(a)) : null)

export function normalize(raw) {
  if (!raw || !Array.isArray(raw.items)) return EMPTY
  const seen = new Set()
  const items = []
  for (const x of raw.items) {
    if (!x || typeof x.id !== 'string') continue
    const k = key(x.kind, x.id)
    if (seen.has(k)) continue
    seen.add(k)
    items.push({
      kind: x.kind === 'contact' ? 'contact' : 'pursuit',
      id: x.id,
      via: x.via || 'pick',
      skipped: Boolean(x.skipped),
      skippedAt: x.skippedAt || null,
    })
  }
  if (!items.length) return EMPTY
  const want = atKey(raw.at)
  const at = items.some((x) => keyOf(x) === want) ? want : keyOf(items[0])
  return { items, at }
}
```

`liveAt` / `keepOrMove` / `enqueue` / `done` / `later` / `indexOf` / `goto` / `inQueue` 里所有拿 `x.id` 跟外部值比的地方，一律换成 `keyOf(x)` 跟 key 比：

```js
function liveAt(items, from) {
  for (let i = from; i < items.length; i++) if (!items[i].skipped) return keyOf(items[i])
  for (let i = Math.min(from, items.length) - 1; i >= 0; i--) if (!items[i].skipped) return keyOf(items[i])
  return items[Math.min(from, items.length - 1)] ? keyOf(items[Math.min(from, items.length - 1)]) : null
}

function keepOrMove(items, q, k, from) {
  if (q.at !== k && items.some((x) => keyOf(x) === q.at)) return q.at
  return liveAt(items, from)
}

export function enqueue(q, entries) {
  const items = q.items.slice()
  for (const e of entries || []) {
    if (!e || typeof e.id !== 'string') continue
    const k = key(e.kind, e.id)
    const i = items.findIndex((x) => keyOf(x) === k)
    if (i >= 0) items[i] = { ...items[i], via: e.via || items[i].via, skipped: false, skippedAt: null }
    else items.push({ kind: e.kind === 'contact' ? 'contact' : 'pursuit', id: e.id, via: e.via || 'pick', skipped: false, skippedAt: null })
  }
  if (!items.length) return EMPTY
  const at = items.some((x) => keyOf(x) === q.at) ? q.at : keyOf(items[0])
  return { items, at }
}

export function done(q, k) {
  const i = q.items.findIndex((x) => keyOf(x) === k)
  if (i < 0) return q
  const items = q.items.filter((x) => keyOf(x) !== k)
  if (!items.length) return EMPTY
  return { items, at: keepOrMove(items, q, k, i) }
}

export function later(q, k, on = todayStr()) {
  const i = q.items.findIndex((x) => keyOf(x) === k)
  if (i < 0) return q
  const moved = { ...q.items[i], skipped: true, skippedAt: on }
  const items = [...q.items.slice(0, i), ...q.items.slice(i + 1), moved]
  return { items, at: keepOrMove(items, q, k, i) }
}

export function indexOf(q) { return q.items.findIndex((x) => keyOf(x) === q.at) }

export function goto(q, delta) {
  if (!q.items.length) return q
  const i = indexOf(q)
  const n = Math.max(0, Math.min(q.items.length - 1, (i < 0 ? 0 : i) + delta))
  return { ...q, at: keyOf(q.items[n]) }
}

export function inQueue(q, k) { return q.items.some((x) => keyOf(x) === k) }
```

- [ ] **Step 4: 跑测试，确认全绿**

Run: `npm test`
Expected: PASS（含原有全部用例）

- [ ] **Step 5: 提交**

```bash
git add src/lib/queue.js src/lib/queue.test.js
git commit -m "队列装得下人：身份换成 kind+id，旧存档一项不丢"
```

---

### Task 4: 四种由头

**Files:**
- Create: `src/lib/cues.js`
- Test: `src/lib/cues.test.js`

**Interfaces:**
- Consumes: 无（纯函数）
- Produces:
  - `cuesFor(contact, msgs, { today, introName }) -> Cue[]`
  - `Cue = { via: 'bump'|'circleback'|'thanks'|'met', why: string, stopped?: boolean }`
  - `stopped: true` 的 **不进队列**，但卡上要显示（「已经碰过 2 次，停了」）
  - 常量 `BUMP_WAIT = [7, 21]`、`MEET_HOURS = 48`

- [ ] **Step 1: 先写会失败的测试**

```js
// src/lib/cues.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cuesFor, BUMP_WAIT, MEET_HOURS } from './cues.js'

const T = (s) => new Date(s + 'T12:00:00Z')
const mail = (at, role, id = at) => ({ created_at: T(at).toISOString(), role, gmail_message_id: id, kind: 'message' })
const note = (at) => ({ created_at: T(at).toISOString(), role: 'note', kind: 'meet', gmail_message_id: null })
const who = { id: 'c1', name: 'Maisa' }
const via = (cs, v) => cs.find((c) => c.via === v)

test('发出去还没到等待期 —— 不吵你', () => {
  const cs = cuesFor(who, [mail('2026-08-05', 'artist')], { today: T('2026-08-08') })
  assert.equal(via(cs, 'bump'), undefined)
})

test('发出去 7 天没回音 —— 第 1 次碰', () => {
  const cs = cuesFor(who, [mail('2026-08-01', 'artist')], { today: T('2026-08-08') })
  assert.equal(via(cs, 'bump').why.includes('第 1 次碰'), true)
  assert.equal(via(cs, 'bump').why.includes('8/1'), true)
})

test('碰过一次，第 2 次要等 21 天 —— 没到不吵', () => {
  const msgs = [mail('2026-07-01', 'artist'), mail('2026-07-10', 'artist')]
  assert.equal(via(cuesFor(who, msgs, { today: T('2026-07-20') }), 'bump'), undefined)
  assert.equal(via(cuesFor(who, msgs, { today: T('2026-08-01') }), 'bump').why.includes('第 2 次碰'), true)
})

test('碰满三次 —— 停了，但卡上要说得出停了', () => {
  const msgs = ['2026-05-01', '2026-05-10', '2026-06-01'].map((d) => mail(d, 'artist'))
  const c = via(cuesFor(who, msgs, { today: T('2026-08-08') }), 'bump')
  assert.equal(c.stopped, true)
  assert.equal(c.why.includes('停了'), true)
})

test('对方回了 —— bump 归零，不再提', () => {
  const msgs = [mail('2026-07-01', 'artist'), mail('2026-07-03', 'org')]
  assert.equal(via(cuesFor(who, msgs, { today: T('2026-08-08') }), 'bump'), undefined)
})

test('到日子了 —— 卡上带原话', () => {
  const c = { ...who, next_touch_at: '2026-08-01', next_touch_why: '他说 "circle back next semester"' }
  const cue = via(cuesFor(c, [], { today: T('2026-08-08') }), 'circleback')
  assert.equal(cue.why.includes('circle back next semester'), true)
  assert.equal(cue.why.includes('8/1'), true)
})

test('日子还没到 —— 不吵', () => {
  const c = { ...who, next_touch_at: '2026-09-01' }
  assert.equal(via(cuesFor(c, [], { today: T('2026-08-08') }), 'circleback'), undefined)
})

test('介绍人还没回谢 —— 要等对方真回过你才提', () => {
  const c = { ...who, intro_by: 'tom' }
  const only = cuesFor(c, [mail('2026-08-01', 'artist')], { today: T('2026-08-08'), introName: 'Tom Leeser' })
  assert.equal(via(only, 'thanks'), undefined)          // 只发出去，没人回 —— 谈不上聊完了
  const both = cuesFor(c, [mail('2026-08-01', 'artist'), mail('2026-08-02', 'org')],
                       { today: T('2026-08-08'), introName: 'Tom Leeser' })
  assert.equal(via(both, 'thanks').why.includes('Tom Leeser'), true)
})

test('已经回谢过 —— 不再提', () => {
  const c = { ...who, intro_by: 'tom', intro_thanked_at: '2026-08-05' }
  const cs = cuesFor(c, [mail('2026-08-01', 'artist'), mail('2026-08-02', 'org')],
                     { today: T('2026-08-08'), introName: 'Tom Leeser' })
  assert.equal(via(cs, 'thanks'), undefined)
})

test('见了面还没发信 —— 超过 48 小时也不消失，只是改口', () => {
  const early = cuesFor(who, [note('2026-08-08')], { today: new Date(T('2026-08-08').getTime() + 3600e3) })
  assert.equal(via(early, 'met').why.includes('48 小时信还没发'), true)
  const late = cuesFor(who, [note('2026-08-01')], { today: T('2026-08-08') })
  assert.equal(via(late, 'met').why.includes(`已经过 ${MEET_HOURS} 小时`), true)
})

test('见完之后已经发过信 —— 不再提', () => {
  const cs = cuesFor(who, [note('2026-08-01'), mail('2026-08-02', 'artist')], { today: T('2026-08-08') })
  assert.equal(via(cs, 'met'), undefined)
})

test('等待期就是设计稿里那两个数', () => {
  assert.deepEqual(BUMP_WAIT, [7, 21])
})
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `npm test`
Expected: FAIL —— `Cannot find module './cues.js'`

- [ ] **Step 3: 写 cues.js**

```js
// 由头 —— 「现在为什么该动这个人」。
//
// 设计稿：docs/specs/2026-08-08-people-layer-design.md 第四节
//
// 核心判断：**「多久没碰」不是引擎，「由头」才是。** 冷却时间只是排序用的，
// 它决定先找谁，但它不足以让你动笔。在美国，纯问候（just checking in）
// 是公认最没用的邮件——有效的 keep-in-touch 一定带一个由头。
//
// 原则：能算出来的就算，算不出来的才存。这里全是纯函数——给它人 + 那个人名下
// 的消息，回一句**带日期带来源**的人话，或者 null。存下来的会跟事实分叉，
// 算出来的不会。

/** '2026-08-06' 或时间戳 → '8/6'。两位数的月日都要去前导零。 */
const md = (x) => {
  const d = x instanceof Date ? x : new Date(x)
  return Number.isNaN(+d) ? '?' : `${d.getMonth() + 1}/${d.getDate()}`
}
const DAY = 86400000
const days = (from, to) => Math.floor((to - new Date(from)) / DAY)

/** 只有邮件才算「跟外面的人的往来」——没有 gmail_message_id 的是你跟 Fairwind 的商量。 */
const mailsOf = (msgs) => (msgs || []).filter((m) => m.gmail_message_id)

/**
 * 你连着发出去、中间没人回的最后几封。
 * 第一封不算「碰」，之后每一封才是——所以 bump 次数 = 这一串的长度 - 1。
 */
export function unansweredRun(msgs) {
  const mail = mailsOf(msgs)
  const run = []
  for (let i = mail.length - 1; i >= 0; i--) {
    if (mail[i].role !== 'artist') break
    run.unshift(mail[i])
  }
  return run
}

/**
 * 美国那条公认的 follow-up 节奏：约一周后碰一次，再等两三周，第三次不回就停。
 * 不回 ≠ 拒绝，多数是淹了；但碰三次以上就真的过界了。
 */
export const BUMP_WAIT = [7, 21]
export const MEET_HOURS = 48

function bumpCue(msgs, today) {
  const run = unansweredRun(msgs)
  if (!run.length) return null
  const last = run[run.length - 1]
  const bumps = run.length - 1
  // 碰满了：**不进队列，但也不许消失**。消失 = 你以为系统还在管，其实早放弃了。
  if (bumps >= BUMP_WAIT.length) {
    return { via: 'bump', stopped: true,
             why: `已经碰过 ${bumps} 次，停了（最后一次 ${md(last.created_at)}）` }
  }
  const waited = days(last.created_at, today)
  if (waited < BUMP_WAIT[bumps]) return null
  return { via: 'bump',
           why: `${md(last.created_at)} 发出去，${waited} 天没回音（第 ${bumps + 1} 次碰）` }
}

function circlebackCue(contact, today) {
  if (!contact.next_touch_at) return null
  const at = new Date(contact.next_touch_at + 'T00:00:00')
  if (at > today) return null
  return { via: 'circleback',
           why: contact.next_touch_why
             ? `${contact.next_touch_why} → ${md(at)} 到了`
             : `你定的日子到了（${md(at)}）` }
}

// 在美国，warm intro 的闭环是「过阵子单独回介绍人一句」——大多数人不做，
// 做了的人会一直有人愿意介绍。但**得等对方真回过你**：只发出去没人回，
// 谈不上「聊上了」，这时候去回谢是尴尬的。
function thanksCue(contact, msgs, introName) {
  if (!contact.intro_by || contact.intro_thanked_at) return null
  if (!mailsOf(msgs).some((m) => m.role === 'org')) return null
  return { via: 'thanks',
           why: `跟 ${contact.name || '他'} 聊上了，还没回谢 ${introName || '介绍人'}` }
}

// Opening / artist talk / conference 是美国 networking 的主场，
// 见完 48 小时内那封 follow-up 不发，那次见面基本等于没发生。
// 48 小时**不是延迟，是过期提示**：过了也不消失，只是改口——
// 消失等于替你决定放弃。
function metCue(msgs, today) {
  const meets = (msgs || []).filter((m) => m.role === 'note' && m.kind === 'meet')
  if (!meets.length) return null
  const last = meets[meets.length - 1]
  const sentAfter = mailsOf(msgs).some(
    (m) => m.role === 'artist' && new Date(m.created_at) > new Date(last.created_at))
  if (sentAfter) return null
  const hrs = Math.floor((today - new Date(last.created_at)) / 3600000)
  return { via: 'met',
           why: hrs > MEET_HOURS
             ? `${md(last.created_at)} 见的，已经过 ${MEET_HOURS} 小时了，follow-up 还没发`
             : `${md(last.created_at)} 见过，48 小时信还没发` }
}

/**
 * 这个人身上现在有哪些由头。
 * msgs 要按 created_at 升序（loadContacts 就是这么给的）。
 */
export function cuesFor(contact, msgs, { today = new Date(), introName = null } = {}) {
  return [
    bumpCue(msgs, today),
    circlebackCue(contact, today),
    thanksCue(contact, msgs, introName),
    metCue(msgs, today),
  ].filter(Boolean)
}

/** 该进队列的那些 —— 停了的只在卡上显示，不塞进你手头这摊活。 */
export const actionable = (cues) => cues.filter((c) => !c.stopped)
```

- [ ] **Step 4: 跑测试，确认全绿**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/cues.js src/lib/cues.test.js
git commit -m "四种由头：该 bump / 到日子了 / 还没回谢 / 48 小时信，每句带日期带来源"
```

---

### Task 5: 读人这一层

**Files:**
- Create: `src/lib/loadContacts.js`
- Modify: `src/lib/chat.js`（加 `fetchContactMessages`）

**Interfaces:**
- Consumes: Task 1 / 2 的视图
- Produces:
  - `loadContacts() -> { contacts, msgsByContact, source, reason, detail }`
  - `contacts[i]` 是 `v_pa_contacts` 的行，额外带 `pursuits: [{id, title, stage}]`（他挂在哪几条机会线上）
  - `msgsByContact[id]` 是升序的消息数组
  - `fetchContactMessages(contactId) -> rows | null`

- [ ] **Step 1: 写 loadContacts.js**

```js
import { supa, DB_CONFIGURED, FELL_BACK } from './backends.js'

// 人这一层的读面。
//
// 跟 loadPursuits 一个姿势：连不上 / 库是空的，都退回一个说得清原因的空结果，
// 而不是无声地显示「没有人」——空页可以，骗人不行。
//
// 这儿**一次把消息全拉回来**（不像首页那样只读一个布尔）。理由是人少：
// 这一刀不做导入，库里十来个人。等扫老邮箱那刀进来几千个人，这里要改成
// 按需拉——到时候会疼，但现在为它加复杂度是白加。

const empty = (reason, detail) => ({
  contacts: [], msgsByContact: {}, source: 'empty', reason, detail,
})

export async function loadContacts() {
  if (!DB_CONFIGURED) return empty(FELL_BACK.NO_CONFIG)
  try {
    const { data: contacts, error: ce } = await supa
      .from('v_pa_contacts').select('*').order('last_touch_at', { ascending: false, nullsFirst: false })
    if (ce) return empty(FELL_BACK.QUERY_FAILED, ce.message)
    if (!contacts?.length) return empty(FELL_BACK.EMPTY)

    // 他挂在哪几条机会线上 —— 这是「人是独立一层、两区共用」看得见的样子。
    const { data: pursuits } = await supa
      .from('v_pa_pursuits').select('id,title,stage,contact_id')
    const byContact = {}
    for (const p of pursuits || []) {
      if (!p.contact_id) continue
      ;(byContact[p.contact_id] ||= []).push({ id: p.id, title: p.title, stage: p.stage })
    }

    const { data: msgs, error: me } = await supa
      .from('v_pa_pursuit_messages').select('*')
      .not('contact_id', 'is', null).order('created_at')
    if (me) return empty(FELL_BACK.QUERY_FAILED, me.message)

    const msgsByContact = {}
    for (const m of msgs || []) (msgsByContact[m.contact_id] ||= []).push(m)

    return {
      contacts: contacts.map((c) => ({ ...c, pursuits: byContact[c.id] || [] })),
      msgsByContact,
      source: 'live', reason: null,
    }
  } catch (e) {
    return empty(FELL_BACK.QUERY_FAILED, e.message)
  }
}
```

- [ ] **Step 2: 在 chat.js 里加单个人的消息拉取**

追加到 `src/lib/chat.js`（紧挨 `fetchMessages` 之后）：

```js
/** 拉这个人名下的往来（邮件 + 你记的笔）。没连库时返回 null。 */
export async function fetchContactMessages(contactId) {
  if (!supa) return null
  const { data, error } = await supa
    .from('v_pa_pursuit_messages').select('*')
    .eq('contact_id', contactId).order('created_at')
  if (error) return null
  return data
}
```

- [ ] **Step 3: 起开发服，确认控制台没报错**

Run: `npm run dev`，在浏览器 console 里跑一次：

```js
// 临时验证用，验完就删
const { loadContacts } = await import('/src/lib/loadContacts.js')
console.log(await loadContacts())
```
Expected: `source: 'live'`，`contacts` 里能看到 0033 迁移建出来的人

- [ ] **Step 4: 提交**

```bash
git add src/lib/loadContacts.js src/lib/chat.js
git commit -m "读人这一层：名片、他名下的往来、他挂在哪几条线上"
```

---

### Task 6: brain 接受 contact_id

**Files:**
- Modify: `brain/server.js`
- Modify: `src/lib/backends.js:BRAIN_BUILD`

**Interfaces:**
- Consumes: Task 2 的表结构
- Produces: `/refresh`、`/chat`、`/gmail-draft` 三个口都接受 `{contact_id}` 作为 `{pursuit_id}` 的替代；`/refresh` 认出时间锚点时写 `contacts.next_touch_at` + `next_touch_why`

- [ ] **Step 1: 加一个统一的「这次是给谁干活」**

在 `brain/server.js` 里 `addMessage` 附近加：

```js
// 一次请求是给谁干活：一条机会线，还是一个人。
//
// 两个口子进来的形状一样，只是主人不同。写成一个小对象，免得每个函数各判一遍
// ——各判一遍就一定会有一处判漏，那一处会静悄悄把信写到没有主的地方去。
function ownerOf(body) {
  if (body?.contact_id) return { kind: 'contact', id: body.contact_id }
  if (body?.pursuit_id) return { kind: 'pursuit', id: body.pursuit_id }
  return null
}
```

- [ ] **Step 2: 让写消息、写产出、认领 thread 都吃 owner**

`addMessage(pursuitId, role, ...)` 改成 `addMessage(owner, role, ...)`，RPC 参数按 `owner.kind` 选：

```js
async function addMessage(owner, role, content, kind = 'message', meta = null) {
  const { data, error } = await db.rpc(
    owner.kind === 'contact' ? 'pa_add_contact_message' : 'pa_add_message',
    {
      ...(owner.kind === 'contact' ? { p_contact_id: owner.id } : { p_pursuit_id: owner.id }),
      p_role: role, p_content: content, p_kind: kind,
      ...(meta ? { p_meta: meta } : {}),
    },
  )
  if (error) throw new Error(`存${role === 'artist' ? '你的话' : 'Fairwind 的回复'}失败：` + error.message)
  return data
}
```

同样改：`pa_add_email` → `pa_add_contact_email`、`pa_upsert_deliverable` → `pa_upsert_contact_deliverable`、`pa_touch_thread` → `pa_touch_contact_thread`。

`/gmail-draft` 里还有一处要跟着改：它现在按 `pursuit_id` 去 `pursuit_threads` 查「这条线已认领的 thread」，好把草稿建成对最新那封的回复。owner 是 contact 时，改成按 `contact_id` 查同一张表。**漏了这一处，草稿会建成一封新信而不是回复**——收信人看到的是两条不相干的线。

- [ ] **Step 3: 补这些 RPC（迁移 0034）**

Create `supabase/migrations/0034_people_layer_rpc.sql`：

```sql
-- 人这一层的写口。跟 0009 / 0027 一个姿势：Fairwind 拿到的每个口都
-- 只能碰它该碰的行，护栏在函数里而不是提示词里。

create or replace function public.pa_add_contact_message(
  p_contact_id uuid, p_role text, p_content text,
  p_kind text default 'message', p_meta jsonb default '{}'::jsonb
) returns producer.pursuit_messages language plpgsql security definer set search_path = public as $$
declare r producer.pursuit_messages;
begin
  insert into producer.pursuit_messages (contact_id, role, kind, content, meta)
  values (p_contact_id, p_role,
          coalesce(nullif(btrim(p_kind), ''), 'message'), p_content,
          coalesce(p_meta, '{}'::jsonb))
  returning * into r;
  -- 记一笔就是「上次碰」，日期和来源一起写——来源不写，日期就是来路不明的数字
  if p_role = 'note' and p_kind = 'meet' then
    update producer.contacts
       set last_touch_at = current_date, last_touch_src = 'meet'
     where id = p_contact_id;
  end if;
  return r;
end $$;
grant execute on function public.pa_add_contact_message(uuid,text,text,text,jsonb)
  to anon, authenticated, service_role;

create or replace function public.pa_add_contact_email(
  p_contact_id uuid, p_role text, p_gmail_message_id text,
  p_content text, p_body_raw text default null,
  p_meta jsonb default '{}'::jsonb, p_created_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r producer.pursuit_messages; ins boolean := false;
begin
  if p_role not in ('org', 'artist') then
    raise exception 'email 的 role 只能是 org|artist，收到 %', p_role;
  end if;
  if coalesce(btrim(p_gmail_message_id), '') = '' then
    raise exception 'gmail_message_id 不能为空——没有它就没法去重';
  end if;

  insert into producer.pursuit_messages
    (contact_id, role, kind, content, body_raw, gmail_message_id, meta, created_at)
  values (p_contact_id, p_role, 'message', p_content, p_body_raw, p_gmail_message_id,
          coalesce(p_meta, '{}'::jsonb), coalesce(p_created_at, now()))
  on conflict do nothing
  returning * into r;

  if found then ins := true; else
    select * into r from producer.pursuit_messages
     where contact_id = p_contact_id and gmail_message_id = p_gmail_message_id;
  end if;

  update producer.contacts
     set last_touch_at = greatest(coalesce(last_touch_at, '1900-01-01'::date),
                                  coalesce(p_created_at, now())::date),
         last_touch_src = 'email'
   where id = p_contact_id;

  return jsonb_build_object('inserted', ins, 'message', to_jsonb(r));
end $$;
grant execute on function public.pa_add_contact_email(uuid,text,text,text,text,jsonb,timestamptz)
  to service_role;

-- 同一个人同一封信不能进两次（对应 0027 那条 pm_gmail_uniq）
create unique index if not exists pm_gmail_contact_uniq
  on producer.pursuit_messages (contact_id, gmail_message_id)
  where contact_id is not null and gmail_message_id is not null;

-- 产出也要能挂人。护栏跟 0027 那条一模一样、一条不减：
-- Fairwind 只能碰 status='draft'——已定稿的它改不动、删不掉，
-- 也没有把 draft 变 final 的口。定稿是你的手（pa_set_final，走 anon 浏览器直连）。
-- 这不是嘱咐，是这个函数里没有那条路径。
create or replace function public.pa_upsert_contact_deliverable(
  p_contact_id uuid, p_id uuid default null,
  p_kind text default 'email', p_title text default '未命名',
  p_body text default null, p_rules jsonb default null,
  p_source text default null, p_due date default null,
  p_meta jsonb default null, p_sort int default 100
) returns producer.deliverables language plpgsql security definer set search_path = public as $$
declare r producer.deliverables;
begin
  if p_id is null then
    insert into producer.deliverables
      (contact_id, kind, title, body, rules, source, due, meta, sort, created_by, status)
    values (p_contact_id, p_kind, p_title, p_body, coalesce(p_rules, '{}'::jsonb),
            p_source, p_due, coalesce(p_meta, '{}'::jsonb), p_sort, 'fairwind', 'draft')
    returning * into r;
  else
    update producer.deliverables set
      kind = coalesce(p_kind, kind), title = coalesce(p_title, title),
      body = coalesce(p_body, body), rules = coalesce(p_rules, rules),
      source = coalesce(p_source, source), due = coalesce(p_due, due),
      meta = coalesce(p_meta, meta), sort = coalesce(p_sort, sort)
     where id = p_id and contact_id = p_contact_id and status = 'draft'
     returning * into r;
    if r.id is null then
      raise exception '改不动：要么不是这个人的产出，要么已经定稿了';
    end if;
  end if;
  return r;
end $$;
grant execute on function public.pa_upsert_contact_deliverable(uuid,uuid,text,text,text,jsonb,text,date,jsonb,int)
  to service_role;

-- 认领一条邮件往来到人身上
create or replace function public.pa_claim_contact_thread(
  p_contact_id uuid, p_thread_id text
) returns void language sql security definer set search_path = public as $$
  insert into producer.pursuit_threads (contact_id, gmail_thread_id, added_by)
  values (p_contact_id, p_thread_id, 'you')
  on conflict do nothing;
$$;
grant execute on function public.pa_claim_contact_thread(uuid, text)
  to anon, authenticated, service_role;

-- 同步到哪儿了。收完信 brain 会来盖一下时间戳。
create or replace function public.pa_touch_contact_thread(
  p_contact_id uuid, p_thread_id text, p_history_id text default null
) returns void language sql security definer set search_path = public as $$
  update producer.pursuit_threads
     set last_synced_at = now(), last_history_id = coalesce(p_history_id, last_history_id)
   where contact_id = p_contact_id and gmail_thread_id = p_thread_id;
$$;
grant execute on function public.pa_touch_contact_thread(uuid, text, text) to service_role;

-- 建 / 改一个人。名片上的每一格都能改——「档案能改」那一刀定的规矩。
create or replace function public.pa_upsert_contact(
  p_id uuid default null, p_name text default null, p_email text default null,
  p_org text default null, p_role text default null, p_notes text default null,
  p_channels jsonb default null, p_intro_by uuid default null,
  p_next_touch_at date default null, p_next_touch_why text default null,
  p_cadence_days int default null
) returns producer.contacts language plpgsql security definer set search_path = public as $$
declare r producer.contacts;
begin
  if p_id is null then
    insert into producer.contacts (name, email, org, role, notes, channels, intro_by,
                                   next_touch_at, next_touch_why, cadence_days)
    values (p_name, nullif(btrim(p_email), ''), p_org, p_role, p_notes,
            coalesce(p_channels, '[]'::jsonb), p_intro_by,
            p_next_touch_at, p_next_touch_why, p_cadence_days)
    returning * into r;
  else
    update producer.contacts set
      name = coalesce(p_name, name), email = coalesce(nullif(btrim(p_email), ''), email),
      org = coalesce(p_org, org), role = coalesce(p_role, role),
      notes = coalesce(p_notes, notes), channels = coalesce(p_channels, channels),
      intro_by = coalesce(p_intro_by, intro_by),
      next_touch_at = coalesce(p_next_touch_at, next_touch_at),
      next_touch_why = coalesce(p_next_touch_why, next_touch_why),
      cadence_days = coalesce(p_cadence_days, cadence_days)
     where id = p_id returning * into r;
  end if;
  return r;
end $$;
grant execute on function public.pa_upsert_contact(uuid,text,text,text,text,text,jsonb,uuid,date,text,int)
  to anon, authenticated, service_role;

-- 回谢了。只写时间戳，由头③ 立刻不再提。
create or replace function public.pa_mark_intro_thanked(p_contact_id uuid)
returns void language sql security definer set search_path = public as $$
  update producer.contacts set intro_thanked_at = current_date where id = p_contact_id;
$$;
grant execute on function public.pa_mark_intro_thanked(uuid) to anon, authenticated, service_role;
```

- [ ] **Step 4: 让 /refresh 认时间锚点**

在 `/refresh` 那段收信 prompt 的 `[[MAIL]]` 之外，加一行输出约定，并在解析后写库：

```js
// 认时间锚点。在美国，「circle back next semester」「after March」是**真话**——
// 是真的邀请你在那个时间点再来一次。婉拒长的是另一个样子
// （not a fit at this time），而且**不给时间锚点**。
// 所以判据很干净：给了锚点的是真的。
//
// 认不出来就**什么都不写**：不猜、不用默认值。名片上永远留一个手填的口。
// 这条是整刀里唯一「调出来的」东西，所以它必须能干净降级。
const anchor = text.match(/\[\[NEXT\]\]\s*(\{[\s\S]*?\})\s*$/m)
if (anchor && owner.kind === 'contact') {
  let a = null
  try { a = JSON.parse(anchor[1]) } catch (_) {}
  if (a?.at && a?.quote) {
    await db.rpc('pa_upsert_contact', {
      p_id: owner.id, p_next_touch_at: a.at, p_next_touch_why: `他说 "${a.quote}"`,
    })
  }
}
```

prompt 里追加：

```
如果对方信里给了**再联系的时间锚点**（next semester / after March / in the fall /
具体日期），另起一行输出：
[[NEXT]] {"at":"2026-09-01","quote":"circle back next semester"}
at 是你把那句话折算成的日期，quote 是**原话**，一个字都别改。
认不出来就**这一行整个不要输出** —— 宁可不说，不许猜。
```

- [ ] **Step 5: 撞版本号**

`src/lib/backends.js` 里 `BRAIN_BUILD` 改成 `'2026-08-08c'`，`brain/server.js` 的 `/health` 里那个同步改。

（改了 brain 不重启，界面完全看不出来——这已经害过一次，所以两边各存一个日期。）

- [ ] **Step 6: 重启 brain，验一遍**

Run: `npm run brain`，然后：

```bash
curl -s localhost:8788/health | head -c 200
```
Expected: `build` 是 `2026-08-08c`

- [ ] **Step 7: 提交**

```bash
git add supabase/migrations/0034_people_layer_rpc.sql brain/server.js src/lib/backends.js
git commit -m "0034 + brain：写口认得出「这次是给谁干活」，收信顺带认时间锚点"
```

---

### Task 7: 人际管理页 —— 列表

**Files:**
- Modify: `src/components/People.jsx`（整页重写）
- Modify: `src/App.jsx`（接 `loadContacts`、把 `contacts` 传下去）
- Modify: `src/styles.css`（名片列表的样式）

**Interfaces:**
- Consumes: `loadContacts()`（Task 5）、`cuesFor` / `actionable`（Task 4）
- Produces: `People` 组件收 `{ contacts, msgsByContact, onOpen, onAdd, tasks }`

- [ ] **Step 1: 重写 People.jsx**

保留原页面开头那段「它将来是什么、为什么不是按人看机会线」的注释（那段判断仍然对），把「还没做」改掉，加：

- 页头：`人际管理` + 一句说清这一层是什么
- 工具条：`加个人` 按钮 + 过卡入口（跟项目争取那边同一个组件）
- 名片列表：按 `last_touch_at` 降序，每张卡显示 **名字 · 机构/角色 · 上次碰（带来源）· 挂着几条线 · 由头**

关键的一段（由头怎么上卡）：

```jsx
// 卡上必须说得出为什么。「你为什么在队里」钉进卡头 那一刀定的规矩：
// 渲染了但看不见 = 没渲染。
const cues = cuesFor(c, msgsByContact[c.id] || [], {
  today: now,
  introName: byId[c.intro_by]?.name,
})
```

```jsx
{cues.map((q) => (
  <div key={q.via} className={`cue cue-${q.via}${q.stopped ? ' cue-stopped' : ''}`}>
    {q.why}
  </div>
))}
```

`last_touch_at` 那行永远带来源：

```jsx
const SRC = { email: '来自那封信', checkin: '你打的卡', meet: '你记的一笔' }
// 上次 8/1 · 你记的一笔
```

**这一刀不做四层分层**（设计稿第五节）：现在库里十来个人，分层只是负担。判据记在设计稿缓办三里，跟导入那一刀一起做。

- [ ] **Step 2: 在 App.jsx 里接上**

```jsx
const [ct, setCt] = useState(null)
useEffect(() => { loadContacts().then(setCt) }, [])
```

`area === 'people'` 那一支传下去；`view.name === 'person'` 时渲染 Task 8 的 `PersonFocus`。

- [ ] **Step 3: 手动验一遍**

Run: `npm run dev` → 切到 **人际管理**
Expected:
- 看得到 0033 迁移建出来的人，一个不少（跟 `select count(*) from producer.contacts` 对得上）
- 每张卡的「上次 M/D」后面都跟着来源，没有光秃秃的日期
- 有由头的卡上显示由头原文

- [ ] **Step 4: 提交**

```bash
git add src/components/People.jsx src/App.jsx src/styles.css
git commit -m "人际管理不再是占位页：名片列出来，上次碰说得出出处"
```

---

### Task 8: 名片三栏 + 加个人 + 认领往来 + 记一笔

**Files:**
- Create: `src/components/PersonFocus.jsx`
- Create: `src/lib/people.js`（写口的前端封装）
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 6 的 RPC、Task 5 的 `fetchContactMessages`
- Produces:
  - `src/lib/people.js`：`upsertContact(fields)` · `claimThread(contactId, threadId)` · `logMeet(contactId, text)` · `markIntroThanked(contactId)` · `refreshContact(contactId)` · `draftForContact(contactId)`
  - `PersonFocus` 组件

- [ ] **Step 1: 写 src/lib/people.js**

跟 `chat.js` 一个分工：读和「你自己改自己名片上的字段」浏览器直连走 anon；「让 Fairwind 去想」走 sidecar。

```js
import { supa, BRAIN } from './backends.js'

const rpc = async (fn, args) => {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { data, error } = await supa.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}

export const upsertContact = (f) => rpc('pa_upsert_contact', {
  p_id: f.id ?? null, p_name: f.name ?? null, p_email: f.email ?? null,
  p_org: f.org ?? null, p_role: f.role ?? null, p_notes: f.notes ?? null,
  p_channels: f.channels ?? null, p_intro_by: f.intro_by ?? null,
  p_next_touch_at: f.next_touch_at ?? null, p_next_touch_why: f.next_touch_why ?? null,
  p_cadence_days: f.cadence_days ?? null,
})

export const claimThread = (contactId, threadId) =>
  rpc('pa_claim_contact_thread', { p_contact_id: contactId, p_thread_id: threadId })

/** 线下见了一面，记一笔。一条记录同时干三件事：更新「上次碰」、触发 48 小时由头、留下聊到哪。 */
export const logMeet = (contactId, text) =>
  rpc('pa_add_contact_message', {
    p_contact_id: contactId, p_role: 'note', p_kind: 'meet', p_content: text,
  })

export const markIntroThanked = (contactId) =>
  rpc('pa_mark_intro_thanked', { p_contact_id: contactId })

const post = async (path, body) => {
  let res
  try {
    res = await fetch(`${BRAIN}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
  } catch (_) {
    throw new Error('Fairwind 的脑子没开 —— 另开一个终端跑 npm run brain')
  }
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out.error) throw new Error(out.error || `脑子出错了（${res.status}）`)
  return out
}

export const refreshContact = (id) => post('/refresh', { contact_id: id })
export const sayToContact = (id, text) => post('/chat', { contact_id: id, text })
export const draftToGmail = (deliverableId) => post('/gmail-draft', { deliverable_id: deliverableId })
```

- [ ] **Step 2: 写 PersonFocus.jsx**

复用 `PursuitFocus` 的三栏骨架和 class 名（`styles.css:743` 那套窄屏叠一栏的规则直接生效）：

| 栏 | 装什么 |
|---|---|
| 左 · 卷宗 | 名字 / 机构 / 角色 / channels（用什么找他）/ 谁介绍的 + 「回谢了」按钮 / 上次碰**及来源** / 你定的节奏 / 下次碰**及原话** —— 每一格可改（`upsertContact`） |
| 中 · 往来 | `fetchContactMessages` 的全部（邮件 + 你记的笔），外加 **他挂在哪几条机会线上**（点得过去）；底部两个口子：`认领一条邮件往来`（贴 thread id）· `记一笔`（线下见面） |
| 右 · 要发的信 | `v_pa_deliverables` where `contact_id`，`起草回信` → `sayToContact`；定稿 → 已有的 `pa_set_final`；`放进 Gmail 草稿箱` → `draftToGmail` |

中栏那句「挂在哪几条线上」是重点——这是「人是独立一层、两区共用」落地之后**看得见**的样子。

- [ ] **Step 3: 手动验：Maisa 走通全程**

Run: `npm run dev` + `npm run brain`

1. 人际管理 →「加个人」→ 名字 Maisa、邮箱、介绍人选 Tom Leeser（Tom 不在库里就先加他）
2. 名片中栏 →「认领一条邮件往来」→ 贴那条 Gmail thread id
3. 点「更新最新信息」→ 中栏出现他回的那封信
4. 右栏「起草回信」→ 出来一版草稿
5. 改两句 → 定稿
6. 「放进 Gmail 草稿箱」→ 去 Gmail 草稿箱里确认那封信在
7. **回到列表页**：Maisa 卡上应该冒出由头 `thanks` ——「跟 Maisa 聊上了，还没回谢 Tom Leeser」

Expected: 七步全通，第 7 步的由头自己出现

- [ ] **Step 4: 提交**

```bash
git add src/components/PersonFocus.jsx src/lib/people.js src/styles.css
git commit -m "名片三栏：谁 / 往来 / 要发的信——Maisa 从邮箱走到 Gmail 草稿箱"
```

---

### Task 9: 由头进队列 + 两边工具条

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/Subbar.jsx`
- Modify: `src/components/QueueRest.jsx`（如果它按 pursuit 写死了）

**Interfaces:**
- Consumes: Task 3 的 `key`/`keyOf`/`parseKey`、Task 4 的 `cuesFor`/`actionable`
- Produces: 过卡队列同时装机会线和人；两边工具条同一个入口、同一个数字

- [ ] **Step 1: 把由头塞进队列**

`App.jsx` 里 `contacts` 加载完之后：

```jsx
// 由头进队 —— 跟 needsMe 一个姿势：纯计算，页面加载时算，不加 cron。
// stopped 的不进：碰满三次那种只在卡上显示「停了」，不塞进你手头这摊活。
useEffect(() => {
  if (!ct?.contacts?.length) return
  const now = new Date()
  const byId = Object.fromEntries(ct.contacts.map((c) => [c.id, c]))
  const entries = []
  for (const c of ct.contacts) {
    const cs = actionable(cuesFor(c, ct.msgsByContact[c.id] || [],
      { today: now, introName: byId[c.intro_by]?.name }))
    if (cs.length) entries.push({ kind: 'contact', id: c.id, via: cs[0].via })
  }
  if (entries.length) setQueue((q) => enqueue(q, entries))
}, [ct])
```

现有塞机会线的地方一律补上 `kind: 'pursuit'`，`queueDone(q, p.id)` 之类改成 `queueDone(q, key('pursuit', p.id))`。

- [ ] **Step 2: 过卡时按 kind 渲染**

`parseKey(queue.at)` 拿到 `{kind, id}`：`pursuit` → `PursuitFocus`，`contact` → `PersonFocus`。

- [ ] **Step 3: 两边工具条各放一个同样的入口**

`Subbar` 现在只在项目争取那边渲染过卡入口。人际管理的工具条上放同一个组件、同一个数字——**队列是一条，不是两条**：顶栏那个数字说的是「你还欠着几件事」，它是手头这摊活，不是某个区的活。

- [ ] **Step 4: 手动验**

Run: `npm run dev`
Expected:
- 人际管理和项目争取两边工具条上的过卡数字**一样**
- 点开过卡，一路 `›` 翻下去，机会线和人混在一队，各自渲染各自的详情
- 每张卡的卡头都说得出为什么在队里（带日期）
- 刷新页面，队列还在（`localStorage` 读得回来）

- [ ] **Step 5: 跑一遍全部测试**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/App.jsx src/components/Subbar.jsx src/components/QueueRest.jsx
git commit -m "由头进队：机会线和人混在同一摊活里，两边工具条同一个数字"
```

---

## 最终验收

全部做完之后，这四条都要真跑过：

1. **Maisa 走通全程** —— 加个人 → 认领往来 → 更新 → 起草 → 定稿 → Gmail 草稿箱，七步全通
2. **迁移一封没丢** —— `select count(*) from producer.pursuit_messages where gmail_message_id is not null and contact_id is not null` 等于动手前的数
3. **老队列没丢** —— 升级前 localStorage 里的队列项，升级后一项不少，`via` 也还在
4. **`npm test` 全绿**

## 这一刀明确不做

（详见[设计稿](../specs/2026-08-08-people-layer-design.md)第七节）

- 实时收发信 —— 横在两个版面前面的同一件事，单独开一轮
- 扫老邮箱导通讯录 · 群发新作品
- 四层分层（有来有往 / 久没动 / 从没回过 / 办完事的）
- 收紧 anon 登录
