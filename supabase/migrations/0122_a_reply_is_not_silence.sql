-- Producer Agent — 人家回信了，那就不叫「没等到」
--
-- 真事（2026-09-02，他拍的）：Descanso 那条线 Francesca 已经回信定了 9/9，
-- 面板上那行还写着「等了 4 天没等到 —— 该催了，follow up 在卡里」。
-- 他的原话：「这个提醒是该在那儿的，我想说的是它写的内容应该是**你收到了
-- 对方的来信，请你回复**，而不是你等了好几天还没等到，需要催一下。」
--
-- 那一次的直接原因是面板端着一份旧快照（前端已按同一个钟修好）。但底下还
-- 有一个真窟窿：**判断是排队的**。tagPass 一轮只判 12 条，他断网几个钟头
-- 回来、一批信同时落地，排在后面的要等好几轮才轮到。这段时间里信明明躺在
-- 库里，面板还在喊「该催了」——催一个已经回过你的人，而按下 follow up 的
-- 是他自己的手。
--
-- 病根跟 0114 是同一个：**拿「判断」管了一件「事实」就能算的事**。
-- 「对方在你出手之后来过信没有」是数得出来的，不需要问模型。
-- 所以这儿只多问一句事实，一个判断都不动：
--
--   replied_at = 你最后一次出手之后，对方来的、**还没判过的**最近一封信
--
-- 「还没判过」这个闸是关键，它把改动锁死在那段真空里：判完了一切照旧走判断
-- （关等待 / 该你回 / 该催了），replied_at 自己变回 null。
-- 除 tag_state 的 replied_at 一列外与 0114 一字不差。

create or replace view public.v_pa_state
with (security_invoker = off) as
with tz as (
  -- 时区直接读表，不调 producer.app_tz()：security_invoker=off 只把**表**
  -- 按 owner 查，函数还是按调用者跑 —— anon 调 producer 的函数会炸。
  select coalesce((select p.data->>'tz' from producer.profile p limit 1),
                  'America/Los_Angeles') as z
),
owned as (
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
-- 信/笔那一支：等对方、等你回。
-- 一条标签可以同时开两个 state（0111）。真事：Kirk 挑了 9/3 的那封 ——
-- 判得全对（解决旧等待 + 要回一句 + 新等待「月底确认」），可原来的
-- CASE 让 awaiting 压过 needs_reply，「要回」被「等待」遮没了。
-- 跟 0099 见面那支同族的病：并存的事实各开各的，最后由挑选规则
-- （到点的优先）定谁上台。
opening as (
  select *, 'WAITING_REPLY'::text as opened from owned
   where subject_id is not null and awaiting is not null
  union all
  select *, 'NEEDS_REPLY' from owned
   where subject_id is not null and needs_reply
),
current_open as (
  -- 每种 state 各自「后发生的赢」（换等的事 = 新 awaiting 顶旧的）
  select distinct on (subject_kind, subject_id, opened) *
    from opening o
   where not exists (
           select 1 from owned r
            where r.subject_kind = o.subject_kind and r.subject_id = o.subject_id
              and r.at > o.at and r.resolves)
     and not (o.opened = 'NEEDS_REPLY' and exists (
           select 1 from producer.pursuit_messages n
            where ((o.subject_kind = 'pursuit' and n.pursuit_id = o.subject_id)
                or (o.subject_kind = 'contact' and n.contact_id = o.subject_id))
              and n.kind in ('note', 'meet', 'decision')
              and n.deleted_at is null and n.created_at > o.at))
   order by subject_kind, subject_id, opened, at desc
),
-- 见面那一支：独立开、独立关
meeting as (
  select distinct on (subject_kind, subject_id) *
    from owned o
   where o.subject_id is not null and o.meet_at is not null
     and not exists (          -- 只有见面类的判断能关一场见面
           select 1 from owned r
            where r.subject_kind = o.subject_kind and r.subject_id = o.subject_id
              and r.at > o.at and r.resolves
              and (r.situation like 'MEETING_SET%' or r.situation like 'DEBRIEF%'
                   or r.situation = '已处理按钮'))
   order by subject_kind, subject_id, meet_at desc   -- 改约 = 更晚的约定顶掉旧的
),
tag_state as (
  -- WAITING_REPLY 的钟从**你最后一封发出的信**起算（0114）。
  -- follow-up 等的语义是「你最后一次出手之后对方沉默 N 天」——
  -- 你发了跟进，钟自动从跟进那天重新走；批量跟进一发，全体滑回等待。
  -- 真事：8/23 发的四封跟进被判「计时不动」（判得没错 —— 8/24 才到点，
  -- D-1 规则让他提前一晚发），旧钟不动，发完的事赖在「该动的」里。
  -- 病根是拿「判断」管了一件「事实」就能算的事。
  select c.subject_kind, c.subject_id, c.opened as state,
         case when c.opened = 'NEEDS_REPLY' then coalesce(c.gist, c.reply_why)
              else coalesce(c.awaiting, c.gist, c.reply_why) end as what,
         c.reply_why as why,
         base.at as since_at,
         case c.opened when 'WAITING_REPLY' then base.at + make_interval(days => c.wait_days)
                       else c.at end as due_at,
         c.message_id as anchor_id,
         back.at as replied_at
    from current_open c
    left join lateral (
      select greatest(c.at, coalesce(max(m.created_at), c.at)) as at
        from producer.pursuit_messages m
        left join lateral (
          select v.pursuit_id from public.v_pa_pursuit_mail v
           where v.id = m.id and v.on_this_line limit 1
        ) pm on true
       where c.opened = 'WAITING_REPLY'
         and m.kind = 'email' and m.role = 'artist' and m.deleted_at is null
         and m.created_at > c.at and m.created_at <= now()   -- 预约的信到点才算
         and ((c.subject_kind = 'pursuit'
               and coalesce(pm.pursuit_id, m.pursuit_id) = c.subject_id)
           or (c.subject_kind = 'contact' and m.contact_id = c.subject_id))
    ) base on true
    -- 「对方在你出手之后来过信没有」——纯事实，一个判断都不用。
    -- **只数还没判过的那些**（message_tags 里没有它）：判完了就按判断走，
    -- 判成 resolves 这条等待自己就没了，判成 needs_reply「该你回」自己会上台，
    -- 判成两者都不是（自动回复、答非所问）那「该催了」本来就是对的。
    -- 不加这个闸的话，Stanford 那种「收到了，正在审」会把等待永远钉在该动的里，
    -- 而他为了让它闭嘴只能按【已处理】—— 那一按就把 10/23 的钟一起毁了。
    left join lateral (
      select max(m.created_at) as at
        from producer.pursuit_messages m
        left join lateral (
          select v.pursuit_id from public.v_pa_pursuit_mail v
           where v.id = m.id and v.on_this_line limit 1
        ) pm on true
       where c.opened = 'WAITING_REPLY'
         and m.kind = 'email' and m.role <> 'artist' and m.deleted_at is null
         and m.created_at > base.at and m.created_at <= now()
         and not exists (select 1 from producer.message_tags g where g.message_id = m.id)
         and ((c.subject_kind = 'pursuit'
               and coalesce(pm.pursuit_id, m.pursuit_id) = c.subject_id)
           or (c.subject_kind = 'contact' and m.contact_id = c.subject_id))
    ) back on true
  union all
  select subject_kind, subject_id,
         case when now() > meet_at + interval '1 hour' then 'DEBRIEF' else 'MEETING_SET' end,
         coalesce(gist, '约了见面'), null, at, meet_at, message_id, null::timestamptz
    from meeting
),
owe_meet as (
  select 'contact'::text as subject_kind, f.subject_id,
         'OWE_MEETING_NOTE'::text as state,
         '和「' || f.name || '」meeting 了，回复一下。' as what,
         null::text as why,
         f.last_meet_at as since_at,
         f.last_meet_at + interval '48 hours' as due_at,
         null::uuid as anchor_id, null::timestamptz as replied_at
    from public.v_pa_cue_facts f
   where f.subject_kind = 'contact'
     and f.last_meet_at is not null and not f.met_followed_up
     and not exists (
           select 1 from producer.pursuit_messages n
            where n.contact_id = f.subject_id and n.kind in ('note', 'decision')
              and n.deleted_at is null and n.created_at > f.last_meet_at)
  union all
  select 'pursuit', mm.pursuit_id, 'OWE_MEETING_NOTE',
         '「' || p.title || '」meeting 了，回复一下。',
         null, mm.at, mm.at + interval '48 hours', null, null::timestamptz
    from (select m.pursuit_id, max(m.created_at) as at
            from producer.pursuit_messages m
           where m.pursuit_id is not null and m.kind = 'meet' and m.deleted_at is null
           group by 1) mm
    join producer.pursuits p on p.id = mm.pursuit_id
   where not exists (
           select 1 from public.v_pa_pursuit_mail v
            where v.pursuit_id = mm.pursuit_id and v.on_this_line
              and v.kind = 'email' and v.role = 'artist' and v.created_at > mm.at)
     and not exists (
           select 1 from producer.pursuit_messages n
            where n.pursuit_id = mm.pursuit_id and n.kind in ('note', 'decision')
              and n.deleted_at is null and n.created_at > mm.at)
),
owe_thanks as (
  select 'contact'::text, i.id, 'OWE_THANKS'::text,
         '见到了你经「' || i.name || '」介绍认识的 '
           || string_agg('「' || c.name || '」', '、' order by ev.at) || '，跟他说一声谢谢。',
         null::text,
         max(ev.at), max(ev.at), null::uuid, null::timestamptz
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
select distinct on (y.subject_kind, y.subject_id)
       y.subject_kind, y.subject_id, y.state, y.what, y.why,
       y.since_at, y.due_at, y.zone, y.anchor_id,
       coalesce(p.title, c.name) as subject_name,
       y.replied_at
  from (
    select x.subject_kind, x.subject_id, x.state, x.what, x.why,
           x.since_at, x.due_at, x.replied_at,
           -- 到没到点按**当地的日子**比（0104 的规矩）。
           -- 0108 再加一档：**follow-up 提前一天进「该动的」** —— 他的节奏是
           -- 睡前处理、邮件预约第二天早上发；D-1 早上到点，晚上处理时草稿
           -- 已经在卡里，预约成 D 早上发正好踩点。
           -- 见面不提前：文案是「记得**今天**见面」，提前一天就成谎话了。
           case when (x.due_at at time zone tz.z)::date
                       <= (now() at time zone tz.z)::date
                       + case when x.state = 'WAITING_REPLY' then 1 else 0 end
                then 'due' else 'waiting' end as zone,
           x.anchor_id
      from (
        select * from tag_state
        union all select * from owe_meet
        union all select * from owe_thanks
      ) x
      cross join tz
  ) y
  left join producer.pursuits p on y.subject_kind = 'pursuit' and p.id = y.subject_id
  left join producer.contacts c on y.subject_kind = 'contact' and c.id = y.subject_id
 -- 暂停 = 「别烦我」：等待、到点、起草、气泡一起安静（0109，他拍的）。
 -- 标签一个不动 —— 恢复暂停的瞬间 state 现算长回来。
 where not (y.subject_kind = 'pursuit' and p.stage = 'paused')
 order by y.subject_kind, y.subject_id,
          (y.zone = 'due') desc,                        -- 到点的优先
          case when y.zone = 'due' then y.due_at end asc,  -- 都到点：急的先
          y.since_at desc;                              -- 都没到点：后发生的赢

grant select on public.v_pa_state to anon, authenticated, service_role;
