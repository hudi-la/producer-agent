-- Producer Agent — 这条线在等什么，是重放算出来的
--
-- 一条线 / 一个人同时只有一个 state：
--   WAITING_REPLY（你发了信等对方，或对方说了某天联系你）
--   NEEDS_REPLY（对方来了信，等你回）      MEETING_SET（约了日子）
--   DEBRIEF（见面时间过了，等你说怎么样）   OWE_THANKS（该谢介绍人）
--   OWE_MEETING_NOTE（见面 48 小时信）     IDLE = 视图里没有这一行
--
-- 算法：取该对象最新一条「起了个 state」的标签（awaiting / needs_reply /
-- meet_at），再看它之后有没有关掉它的东西。
--
-- **关 WAITING_REPLY 的唯一途径是 resolves=true 的标签** —— 「存在一封
-- 对方回信」这个事实本身不关。第一稿的错就在这：任何回信都关，
-- 「收到，回头看」也关。判「解决没解决」是 brain 那格的事，视图只认标签。
--
-- NEEDS_REPLY 多一条纯规则的关法：你记了一笔（note/meet/decision）。
-- 「我在微信上处理了」不需要再劳驾谁判断。
--
-- OWE_THANKS / OWE_MEETING_NOTE 不靠标签，靠 v_pa_cue_facts 已有的判据
-- （org_ever_replied、last_meet_at、met_followed_up、intro_thanked_at）。
-- 回谢挂在**介绍人**身上：Weidi 介绍了 Ana 和 Biayna，是 Weidi 头上
-- 一条、两个理由，不是 Ana、Biayna 各一条。
--
-- 同一个对象几件事撞车 → since_at 最新的赢（合并规则：后发生的事说了算）。
--
-- 设计稿：docs/specs/2026-08-19-what-this-line-is-waiting-on-design.md 第四、九节

create or replace view public.v_pa_state
with (security_invoker = off) as
with owned as (
  -- 每条带标签的消息属于谁。线的归属认 on_this_line（0086 的规矩：
  -- m.pursuit_id 常是 null，v_pa_pursuit_mail 才是「这封信是哪条线的」的答案）。
  select t.*, m.created_at as at,
         case when coalesce(pm.pursuit_id, m.pursuit_id) is not null then 'pursuit'
              when m.contact_id is not null then 'contact' end as subject_kind,
         coalesce(pm.pursuit_id, m.pursuit_id, m.contact_id) as subject_id
    from producer.message_tags t
    join producer.pursuit_messages m
      on m.id = t.message_id and m.deleted_at is null and m.kind <> 'gmail_draft'
    left join lateral (
      select v.pursuit_id from public.v_pa_pursuit_mail v
       where v.id = m.id and v.on_this_line
       order by v.created_at desc limit 1
    ) pm on true
),
opening as (
  select *,
         case when awaiting is not null then 'WAITING_REPLY'
              when needs_reply          then 'NEEDS_REPLY'
              when meet_at is not null  then 'MEETING_SET' end as opened
    from owned
   where subject_id is not null
     and (awaiting is not null or needs_reply or meet_at is not null)
),
current_open as (
  select distinct on (subject_kind, subject_id) *
    from opening o
   where not exists (          -- 之后被判「解决了」→ 关
           select 1 from owned r
            where r.subject_kind = o.subject_kind and r.subject_id = o.subject_id
              and r.at > o.at and r.resolves)
     and not (o.opened = 'NEEDS_REPLY' and exists (
           select 1 from producer.pursuit_messages n   -- 你记了一笔 → 关（纯规则）
            where ((o.subject_kind = 'pursuit' and n.pursuit_id = o.subject_id)
                or (o.subject_kind = 'contact' and n.contact_id = o.subject_id))
              and n.kind in ('note', 'meet', 'decision')
              and n.deleted_at is null and n.created_at > o.at))
   order by subject_kind, subject_id, at desc
),
tag_state as (
  select subject_kind, subject_id,
         -- 见面结束就换问题。多长算结束不知道，先按 1 小时；
         -- 真在乎的话让判 meet_at 的那格顺便判个时长，别在这儿拍。
         case when opened = 'MEETING_SET' and now() > meet_at + interval '1 hour'
              then 'DEBRIEF' else opened end as state,
         coalesce(awaiting, gist, reply_why) as what,
         reply_why as why,
         at as since_at,
         case opened
           when 'WAITING_REPLY' then at + make_interval(days => wait_days)
           when 'NEEDS_REPLY'   then at           -- 等你回：立刻到点
           else meet_at end as due_at,
         message_id as anchor_id
    from current_open
),
owe_meet as (
  -- 见面成了、48 小时里该回一封。met_followed_up = 见面之后你发过信（0080）。
  select 'contact'::text as subject_kind, f.subject_id,
         'OWE_MEETING_NOTE'::text as state,
         '和「' || f.name || '」meeting 了，回复一下。' as what,
         null::text as why,
         f.last_meet_at as since_at,
         f.last_meet_at + interval '48 hours' as due_at,
         null::uuid as anchor_id
    from public.v_pa_cue_facts f
   where f.subject_kind = 'contact'
     and f.last_meet_at is not null and not f.met_followed_up
),
owe_thanks as (
  -- 挂在介绍人身上，被介绍的人**真联系上了**才算（只发出没人回不算）。
  -- 一个介绍人几条介绍并成一行 —— 一封谢信提几个人，不是几封。
  select 'contact'::text, i.id, 'OWE_THANKS'::text,
         '见到了你经「' || i.name || '」介绍认识的 '
           || string_agg('「' || c.name || '」', '、' order by ev.at) || '，跟他说一声谢谢。',
         null::text,
         max(ev.at), max(ev.at), null::uuid
    from producer.contacts c
    join producer.contacts i on i.id = c.intro_by
    join lateral (
      select greatest(f.last_in_at, f.last_meet_at) as at, f.org_ever_replied, f.last_meet_at
        from public.v_pa_cue_facts f
       where f.subject_kind = 'contact' and f.subject_id = c.id
    ) ev on ev.org_ever_replied or ev.last_meet_at is not null
   where c.intro_thanked_at is null
   group by i.id, i.name
)
select distinct on (subject_kind, subject_id)
       x.subject_kind, x.subject_id, x.state, x.what, x.why,
       x.since_at, x.due_at,
       -- MEETING_SET 当天早上就该动（不是等到 12 点），所以按当地的「日」比
       case when x.state in ('MEETING_SET')
              then case when (x.due_at at time zone producer.app_tz())::date
                          <= (now() at time zone producer.app_tz())::date
                        then 'due' else 'waiting' end
            when x.due_at <= now() then 'due'
            else 'waiting' end as zone,
       x.anchor_id
  from (
    select * from tag_state
    union all select * from owe_meet
    union all select * from owe_thanks
  ) x
 order by subject_kind, subject_id, since_at desc;   -- 撞车 → 后发生的事赢

grant select on public.v_pa_state to anon, authenticated, service_role;

-- ── 自查（照 0089 pa_selfcheck_reads 的先例另立一个，跟 pa_selfcheck 并排跑）──
create or replace function public.pa_selfcheck_state()
returns table (组 text, 检查 text, 期望 text, 实际 text, 通过 boolean)
language plpgsql
security definer
set search_path = public, producer
as $$
declare v text;
begin
  组 := 'state';

  检查 := '一条线 / 一个人同时只有一个 state';
  期望 := '0 个对象多行';
  select count(*)::text into v from (
    select subject_kind, subject_id from public.v_pa_state
    group by 1, 2 having count(*) > 1) d;
  实际 := v || ' 个对象多行'; 通过 := v = '0'; return next;

  检查 := 'WAITING_REPLY 都有到点日（没有 due 的等待等于没设）';
  期望 := '0 行没 due';
  select count(*)::text into v from public.v_pa_state
   where state = 'WAITING_REPLY' and due_at is null;
  实际 := v || ' 行没 due'; 通过 := v = '0'; return next;

  检查 := 'NEEDS_REPLY 都带着「凭什么要回」（那句话是要显示给他看的）';
  期望 := '0 行没理由';
  select count(*)::text into v from public.v_pa_state
   where state = 'NEEDS_REPLY' and coalesce(btrim(why), '') = '';
  实际 := v || ' 行没理由'; 通过 := v = '0'; return next;

  检查 := '标签都锚在活着的真事实上（草稿、删了的不许挂标签）';
  期望 := '0 条挂错';
  select count(*)::text into v from producer.message_tags t
    join producer.pursuit_messages m on m.id = t.message_id
   where m.deleted_at is not null or m.kind = 'gmail_draft';
  实际 := v || ' 条挂错'; 通过 := v = '0'; return next;
end $$;

grant execute on function public.pa_selfcheck_state() to anon, authenticated, service_role;
