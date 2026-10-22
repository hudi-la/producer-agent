-- Producer Agent — 往来改挂人：三张表要么挂线、要么挂人
--
-- 设计稿：docs/specs/2026-08-08-people-layer-design.md 第三节
--
-- 为什么：**往来常常先于机会线。** Tom Leeser 介绍了 Maisa → 你发信 → 他回了，
-- 这时候还什么都不是。可 pursuit_messages / pursuit_threads / deliverables
-- 第一列都是 pursuit_id not null，所以那封信在库里没有地方放，
-- 整条已经造好的流水线（认领 thread → 拉信 → 起草 → 进 Gmail 草稿箱）他一步都上不去。
--
-- 划线的判据不是新发明的，是**数据自己已经分开了的**：
--   · 有 gmail_message_id（role 只能 org|artist，0027 有硬校验）→ 跟外面的人的真实往来 → 归人
--   · 没有（role 是 producer|artist）→ 你跟 Fairwind 的商量 → 归线
--
-- 表名不改：pursuit_messages 装的已经不只是机会线的消息了，名字确实不准，
-- 但改名要动 brain 一串 RPC、两个视图、前端一堆引用——纯代价零收益。
-- 末尾那条 comment on table 把这件事说清楚。

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
-- 换成代理主键 + 两条**部分**唯一索引（按线一条、按人一条）：
-- 「同一条线不能登记同一个 thread 两次」这条保证一点没丢，只是换了个说法。
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
-- （brain/server.js 收信时写的），通常长这样：
--     Maisa Chen <m.chen@calarts.edu>
-- **邮箱就在里面**，库里就有，不用去 Gmail 拿。名字和邮箱分开抠：
--   · 尖括号里的 → email
--   · 尖括号外的 → name（去掉可能包着的引号）
--   · 整段就是个裸地址（没有名字）→ email 拿全段，name 退回机构名
--
-- 为什么非抠不可：没有邮箱的人**收不到信也发不出信**，而且 contacts 那条
-- email 唯一索引对他们完全失效——你哪天贴一封他们的信进来，会长出第二个人。
--
-- 抠不出来的就老实留空。宁可空着，也不往 email 那列塞一个猜出来的值：
-- 那一列上有唯一索引，塞错了会挡住真正的那个人。
--
-- 已经存在的邮箱不再建人，直接挂上去 —— 同一个人不该有两张名片。
--
-- 建出来的人会出现在人际管理页上，而你从没手动加过他们。
-- 这不是副作用：**这正是他们第一次进系统。**
do $$
declare r record; cid uuid; nm text; em text;
begin
  for r in
    select p.id as pid, p.org,
           (select m2.meta->>'from_name'
              from producer.pursuit_messages m2
             where m2.pursuit_id = p.id
               and m2.role = 'org'
               and m2.gmail_message_id is not null
             order by m2.created_at limit 1) as from_name
      from producer.pursuits p
     where p.contact_id is null
       and exists (select 1 from producer.pursuit_messages m
                    where m.pursuit_id = p.id and m.gmail_message_id is not null)
  loop
    -- 先抠尖括号里的；没有尖括号就看整段本身是不是个地址
    em := lower(nullif(btrim((regexp_match(coalesce(r.from_name, ''), '<([^>]+@[^>]+)>'))[1]), ''));
    if em is null and r.from_name ~ '^\s*[^\s<>@]+@[^\s<>@]+\s*$' then
      em := lower(btrim(r.from_name));
    end if;
    -- 名字 = 尖括号外那截，去掉包裹的引号
    nm := btrim(regexp_replace(coalesce(r.from_name, ''), '<[^>]*>', ''), ' "''');
    if nm = '' or nm = em then nm := null; end if;

    -- 这个邮箱已经在库里了 → 挂过去，不建第二个
    cid := null;
    if em is not null then
      select id into cid from producer.contacts where lower(email) = em limit 1;
    end if;

    if cid is null then
      insert into producer.contacts (name, email, org, notes)
      values (coalesce(nm, r.org, '未具名联系人'), em, r.org,
              case when em is null
                then '0033 迁移从这条线的邮件里认出来的人。**邮箱没抠出来**——他收不到信也发不出信，去 Gmail 里补一个。'
                else '0033 迁移从这条线的邮件里认出来的人。' end)
      returning id into cid;
    end if;

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

-- ④ 每个人的「上次碰」从邮件回填。**来源一起写**——日期说得出出处。
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
--
-- 「绝不丢信息」不是嘱咐，是这一段代码。迁移和验收在同一个事务里跑，
-- 少认领一封就 raise exception，整道 migration 回滚，库回到动手之前。
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
-- create or replace 只能在**末尾追加**列，前面的列名/顺序一个都没动。
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

-- 认领的 thread 以前前端看不见（只有 brain 用）。名片上要显示「认领了哪几条往来」，
-- 所以开一张读面出来。gmail_thread_id 不是秘密——点开就是你自己的信箱。
create or replace view public.v_pa_threads as
  select id, pursuit_id, contact_id, gmail_thread_id, last_synced_at, added_by, created_at
    from producer.pursuit_threads;
grant select on public.v_pa_threads to anon, authenticated, service_role;

comment on table producer.pursuit_messages is
  '名字不准了：它装的不只是机会线的消息。有 gmail_message_id 的是跟外面的人的往来（归 contact_id），没有的是你跟 Fairwind 的商量（归 pursuit_id）。改名要动一串 RPC、两个视图和前端一堆引用，纯代价零收益，所以留着这条注释';
