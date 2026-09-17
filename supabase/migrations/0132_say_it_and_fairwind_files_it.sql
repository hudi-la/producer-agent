-- Producer Agent — 你说一句，Fairwind 判该记成什么
--
-- 他 9/11 定的：记一笔按钮退场，你在聊天里说的每一句由 Fairwind 当场判成
-- 事件（[[STATE]]，笔的正文是你的原话）、记忆（[[MEMO]]，不算事件）或不记；
-- 见面复盘那格的双判去掉（DEBRIEF 下你说的话跟别的状态一样交给同一次回复判，
-- 见成了就报 met）。
--
-- 这份迁移三件事：
--   · pa_apply_state_move 加 p_text（原话）和 met（见成了 → meet 笔，48 小时信
--     和回谢介绍人照旧从 meet 笔长出来）；旧签名 drop 掉再建
--   · v_pa_state 关见面的判据多认「聊天里定的：met / done」，其余与 0124 一字不差
--   · pa_apply_memo / pa_undo_memo：记忆。线上是 kind='memo' 的笔 —— 不在
--     note|meet|decision 里，所以视图不把它当事件、pa_facts_to_judge 也不收；
--     人身上是 contacts.notes 末尾追加一段，旧值存进气泡 meta 好撤回
--   · pa_rewind_chat 连带撤 memo
--
-- 设计稿：docs/specs/2026-09-11-say-it-and-fairwind-files-it-design.md

create or replace view public.v_pa_state
with (security_invoker = off) as
with tz as (
  -- 时区直接读表，不调 producer.app_tz()：security_invoker=off 只把**表**
  -- 按 owner 查，函数还是按调用者跑 —— anon 调 producer 的函数会炸。
  select coalesce((select p.data->>'tz' from producer.profile p limit 1),
                  'America/Los_Angeles') as z
),
owned as (
  select t.*, m.created_at as at, m.kind as anchor_kind,
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
                   or r.situation = '已处理按钮'
                   -- 0125：聊天里定的「见成了」「不用管了」也关见面
                   or r.situation like '聊天里定的：met%' or r.situation like '聊天里定的：done%'))
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
         back.at as replied_at,
         -- 对方最后一封来信之后你连着发的信数减一 = follow up 次数（0117，算法见文件头）
         case when c.opened = 'WAITING_REPLY' then base.n else 0 end as followups
    from current_open c
    left join lateral (
      select greatest(c.at, coalesce(max(m.created_at) filter (where m.created_at > c.at), c.at)) as at,
             -- 对方最后一封来信之后你连着发了几封，减一 = follow up 次数（见文件头）
             -- 0124：**只有笔开的等待**才从笔那天起数（聊天里定的「换法子」：
             -- 换了法子之后发的第一封是新的原信，不是第四次催）。
             -- 信开的等待照 0117 数对方最后一封来信之后你连着发的全部 ——
             -- 0123 错把它也从锚那封起数，Arboretum 三封没回被数成「第 1 次」。
             greatest(0, count(m.id) filter (where m.created_at > coalesce(theirs.at, '-infinity')
                                               and (c.anchor_kind = 'email' or m.created_at >= c.at))::int - 1) as n
        from producer.pursuit_messages m
        left join lateral (
          select v.pursuit_id from public.v_pa_pursuit_mail v
           where v.id = m.id and v.on_this_line limit 1
        ) pm on true
        cross join lateral (
          select max(q.created_at) as at from producer.pursuit_messages q
          left join lateral (
            select v.pursuit_id from public.v_pa_pursuit_mail v
             where v.id = q.id and v.on_this_line limit 1
          ) qpm on true
           where q.kind = 'email' and q.role <> 'artist' and q.deleted_at is null
             and q.created_at <= now()
             and ((c.subject_kind = 'pursuit'
                   and coalesce(qpm.pursuit_id, q.pursuit_id) = c.subject_id)
               or (c.subject_kind = 'contact' and q.contact_id = c.subject_id))
        ) theirs
       where c.opened = 'WAITING_REPLY'
         and m.kind = 'email' and m.role = 'artist' and m.deleted_at is null
         and m.created_at <= now()   -- 预约的信到点才算
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
         coalesce(gist, '约了见面'), null, at, meet_at, message_id, null::timestamptz, 0
    from meeting
),
owe_meet as (
  select 'contact'::text as subject_kind, f.subject_id,
         'OWE_MEETING_NOTE'::text as state,
         '和「' || f.name || '」meeting 了，回复一下。' as what,
         null::text as why,
         f.last_meet_at as since_at,
         f.last_meet_at + interval '48 hours' as due_at,
         null::uuid as anchor_id, null::timestamptz as replied_at, 0 as followups
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
         null, mm.at, mm.at + interval '48 hours', null, null::timestamptz, 0
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
         max(ev.at), max(ev.at), null::uuid, null::timestamptz, 0
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
       y.replied_at, y.followups
  from (
    select x.subject_kind, x.subject_id, x.state, x.what, x.why,
           x.since_at, x.due_at, x.replied_at, x.followups,
           -- 到没到点按**当地的日子**比（0104 的规矩）。
           -- 0108 再加一档：**follow-up 提前一天进「该动的」** —— 他的节奏是
           -- 睡前处理、邮件预约第二天早上发；D-1 早上到点，晚上处理时草稿
           -- 已经在卡里，预约成 D 早上发正好踩点。
           -- 见面不提前：文案是「记得**今天**见面」，提前一天就成谎话了。
           case when (x.due_at at time zone tz.z)::date
                       <= (now() at time zone tz.z)::date
                       + case when x.state = 'WAITING_REPLY' then 1 else 0 end
                then case when x.state = 'WAITING_REPLY' and x.followups >= 2
                          then 'stopped' else 'due' end
                else 'waiting' end as zone,
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

-- ══ 事件：带原话、多一种 met ═══════════════════════════════════════
drop function if exists public.pa_apply_state_move(text, uuid, text, text, text, text, date, text, boolean, text, uuid);

create or replace function public.pa_apply_state_move(
  p_kind        text,
  p_subject     uuid,
  p_move        text,                      -- resolved|wait|reschedule|park|needs_reply|meeting|met|done
  p_why         text,
  p_line        text,
  p_awaiting    text        default null,
  p_due         date        default null,
  p_meet_at     text        default null,
  p_needs_reply boolean     default null,
  p_reply_why   text        default null,
  p_src_msg     uuid        default null,
  p_text        text        default null   -- 他刚说的那句：笔的正文（0125）
) returns uuid
language plpgsql security definer set search_path = public, producer
as $$
declare
  v_note     uuid;
  v_today    date := producer.today_local();
  v_days     int;
  v_awaiting text;
  v_resolves boolean := null;
  v_res_why  text := null;
  v_needs    boolean := null;
  v_rwhy     text := null;
  v_meet     text := null;
  v_what     text;
  v_kind     text := 'decision';
begin
  if p_kind not in ('pursuit', 'contact') then raise exception 'p_kind 只认 pursuit|contact'; end if;
  if p_move not in ('resolved','wait','reschedule','park','needs_reply','meeting','met','done') then
    raise exception '不认识的拨法：%', p_move;
  end if;
  if coalesce(btrim(p_why), '') = '' then raise exception '拨提醒得说凭什么（why 是空的）'; end if;
  if coalesce(btrim(p_line), '') = '' then raise exception '小卡那行字是空的'; end if;
  if p_kind = 'pursuit' and not exists (select 1 from producer.pursuits where id = p_subject) then
    raise exception '没有这条线：%', p_subject;
  end if;
  if p_kind = 'contact' and not exists (select 1 from producer.contacts where id = p_subject) then
    raise exception '没有这个人：%', p_subject;
  end if;

  if p_move in ('wait', 'reschedule', 'park') then
    if p_due is null then raise exception '% 得有到点日', p_move; end if;
    v_days := p_due - v_today;
    if v_days <= 0 then raise exception '到点日（%）得在今天（%）之后', p_due, v_today; end if;
  end if;

  case p_move
    when 'resolved' then
      v_resolves := true; v_res_why := btrim(p_why);
      if p_needs_reply then
        if coalesce(btrim(p_reply_why), '') = '' then raise exception '「要回」得说凭什么'; end if;
        v_needs := true; v_rwhy := btrim(p_reply_why);
      end if;
    when 'wait' then
      if coalesce(btrim(p_awaiting), '') = '' then raise exception 'wait 得说在等什么'; end if;
      v_resolves := true; v_res_why := btrim(p_why); v_awaiting := btrim(p_awaiting);
    when 'reschedule' then
      select s.what into v_what from public.v_pa_state s
       where s.subject_kind = p_kind and s.subject_id = p_subject and s.state = 'WAITING_REPLY';
      if v_what is null then raise exception '没有在等的事可改期'; end if;
      v_resolves := true; v_res_why := btrim(p_why); v_awaiting := v_what;
    when 'park' then
      v_resolves := true; v_res_why := btrim(p_why); v_awaiting := '先放着：' || btrim(p_why);
    when 'needs_reply' then
      if coalesce(btrim(p_reply_why), '') = '' then raise exception 'needs_reply 得说凭什么'; end if;
      v_needs := true; v_rwhy := btrim(p_reply_why);
    when 'meeting' then
      if coalesce(btrim(p_meet_at), '') = '' then raise exception 'meeting 得有时间'; end if;
      v_meet := p_meet_at;
    when 'met' then
      -- 见成了：是一条 meet 笔（0097 的两支 —— 48 小时信、回谢介绍人 —— 从它长出来）
      v_kind := 'meet'; v_resolves := true; v_res_why := btrim(p_why);
    when 'done' then
      v_resolves := true; v_res_why := btrim(p_why);
  end case;

  insert into producer.pursuit_messages (pursuit_id, contact_id, role, kind, content, meta)
  values (case when p_kind = 'pursuit' then p_subject end,
          case when p_kind = 'contact' then p_subject end,
          'note', v_kind,
          coalesce(nullif(btrim(p_text), ''), '聊天里定的：' || btrim(p_line)),
          jsonb_build_object('state_move', jsonb_build_object(
            'move', p_move, 'why', btrim(p_why), 'line', btrim(p_line),
            'src_msg', p_src_msg)))
  returning id into v_note;

  -- 人身上的 meet 笔要把「上次碰」记成今天（跟 pa_add_contact_message 的 meet 一样）
  if p_kind = 'contact' and v_kind = 'meet' then
    update producer.contacts set last_touch_at = producer.today_local(), last_touch_src = 'meet'
     where id = p_subject;
  end if;

  perform public.pa_tag_message(
    v_note, '聊天里定的：' || p_move,
    v_resolves, v_res_why, v_needs, v_rwhy,
    v_awaiting, case when v_awaiting is not null then v_days end,
    v_meet, btrim(p_line), 'fairwind-chat');

  if p_src_msg is not null then
    update producer.pursuit_messages
       set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{state_move}',
                    coalesce(meta->'state_move', '{}'::jsonb)
                    || jsonb_build_object('applied', true, 'note_id', v_note))
     where id = p_src_msg;
  end if;

  return v_note;
end $$;

revoke all on function public.pa_apply_state_move(text, uuid, text, text, text, text, date, text, boolean, text, uuid, text) from public, anon, authenticated;
grant execute on function public.pa_apply_state_move(text, uuid, text, text, text, text, date, text, boolean, text, uuid, text) to service_role;

-- ══ 记忆 ═══════════════════════════════════════════════════════════
create or replace function public.pa_apply_memo(
  p_kind    text,          -- 'pursuit' | 'contact'
  p_subject uuid,
  p_to      text,          -- 'line' | 'person'
  p_text    text,
  p_src_msg uuid default null
) returns uuid
language plpgsql security definer set search_path = public, producer
as $$
declare v_note uuid; v_prev text; v_t text := btrim(p_text);
begin
  if p_kind not in ('pursuit', 'contact') then raise exception 'p_kind 只认 pursuit|contact'; end if;
  if coalesce(v_t, '') = '' then raise exception '要记的那句是空的'; end if;
  if p_to = 'person' then
    if p_kind <> 'contact' then raise exception '跟线聊时说的人的事进线的 memo，不猜是哪个人'; end if;
    select notes into v_prev from producer.contacts where id = p_subject;
    if not found then raise exception '没有这个人：%', p_subject; end if;
    update producer.contacts
       set notes = case when coalesce(btrim(v_prev), '') = '' then v_t else v_prev || E'\n' || v_t end
     where id = p_subject;
    if p_src_msg is not null then
      update producer.pursuit_messages
         set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{memo}',
                      coalesce(meta->'memo', '{}'::jsonb)
                      || jsonb_build_object('applied', true, 'prev_notes', v_prev))
       where id = p_src_msg;
    end if;
    return null;
  elsif p_to = 'line' then
    if p_kind = 'pursuit' and not exists (select 1 from producer.pursuits where id = p_subject) then
      raise exception '没有这条线：%', p_subject;
    end if;
    if p_kind = 'contact' and not exists (select 1 from producer.contacts where id = p_subject) then
      raise exception '没有这个人：%', p_subject;
    end if;
    -- kind='memo'：不在 note|meet|decision 里 → 不是事件、不进判断队列
    insert into producer.pursuit_messages (pursuit_id, contact_id, role, kind, content, meta)
    values (case when p_kind = 'pursuit' then p_subject end,
            case when p_kind = 'contact' then p_subject end,
            'note', 'memo', v_t,
            jsonb_build_object('memo', jsonb_build_object('src_msg', p_src_msg)))
    returning id into v_note;
    if p_src_msg is not null then
      update producer.pursuit_messages
         set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{memo}',
                      coalesce(meta->'memo', '{}'::jsonb)
                      || jsonb_build_object('applied', true, 'note_id', v_note))
       where id = p_src_msg;
    end if;
    return v_note;
  else
    raise exception 'p_to 只认 line|person，收到 %', p_to;
  end if;
end $$;

revoke all on function public.pa_apply_memo(text, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.pa_apply_memo(text, uuid, text, text, uuid) to service_role;

create or replace function public.pa_undo_memo(p_src_msg uuid)
returns uuid
language plpgsql security definer set search_path = public, producer
as $$
declare b producer.pursuit_messages; v_note uuid;
begin
  select * into b from producer.pursuit_messages where id = p_src_msg;
  if not found or b.meta->'memo' is null or (b.meta->'memo'->>'applied') is distinct from 'true' then
    raise exception '这条气泡没记过什么';
  end if;
  if (b.meta->'memo'->>'undone') = 'true' then raise exception '已经撤过了'; end if;

  if b.meta->'memo' ? 'note_id' then
    v_note := (b.meta->'memo'->>'note_id')::uuid;
    update producer.pursuit_messages set deleted_at = now() where id = v_note and deleted_at is null;
  else
    -- 人的关系记忆：长回旧值（旧值可能是 null）
    update producer.contacts set notes = b.meta->'memo'->>'prev_notes' where id = b.contact_id;
  end if;
  update producer.pursuit_messages
     set meta = jsonb_set(meta, '{memo}', (meta->'memo') || '{"undone": true}'::jsonb)
   where id = p_src_msg;
  return v_note;
end $$;

revoke all on function public.pa_undo_memo(uuid) from public;
grant execute on function public.pa_undo_memo(uuid) to anon, authenticated, service_role;

-- ══ 回退聊天：memo 也一起撤 ═══════════════════════════════════════
-- 照 0123 整段抄，多了 memo 那两段。
create or replace function public.pa_rewind_chat(p_msg_id uuid)
returns int
language plpgsql
security definer
set search_path = public, producer
as $$
declare
  a producer.pursuit_messages;
  n int;
  gone uuid[];
  r record;
begin
  select * into a from producer.pursuit_messages where id = p_msg_id;
  if not found then
    raise exception '库里没有这条（id=%）', p_msg_id;
  end if;
  if a.deleted_at is not null then
    raise exception '这条已经撤过了';
  end if;
  if a.role <> 'artist' or coalesce(a.kind, 'message') <> 'message' then
    raise exception '只能从你自己说的一句话往后撤（这条是 role=% kind=%）', a.role, a.kind;
  end if;

  -- 先把要删的气泡里、记进关系记忆的那些长回去（气泡删了 meta 就翻不到了，所以先做）
  for r in
    select m.id, m.contact_id, m.meta->'memo'->>'prev_notes' as prev
      from producer.pursuit_messages m
     where m.pursuit_id is not distinct from a.pursuit_id
       and m.contact_id is not distinct from a.contact_id
       and (m.created_at, m.id) >= (a.created_at, a.id)
       and m.deleted_at is null and m.role = 'producer'
       and (m.meta->'memo'->>'applied') = 'true'
       and (m.meta->'memo'->>'undone') is distinct from 'true'
       and not (m.meta->'memo' ? 'note_id')
     order by m.created_at desc, m.id desc     -- 最晚追加的最先长回，旧值才对得上
  loop
    update producer.contacts set notes = r.prev where id = r.contact_id;
  end loop;

  with d as (
    update producer.pursuit_messages m
       set deleted_at = now()
     where m.pursuit_id is not distinct from a.pursuit_id
       and m.contact_id is not distinct from a.contact_id
       and (m.created_at, m.id) >= (a.created_at, a.id)
       and m.deleted_at is null
       and m.role in ('artist', 'producer')
       and coalesce(m.kind, 'message') = 'message'
    returning m.id
  )
  select coalesce(array_agg(id), '{}') into gone from d;
  n := coalesce(array_length(gone, 1), 0);

  -- 被删气泡拨过的提醒：笔软删、标签删掉（0123）
  delete from producer.message_tags t
   using producer.pursuit_messages k
   where t.message_id = k.id and k.kind in ('decision', 'meet') and k.deleted_at is null
     and (k.meta->'state_move'->>'src_msg')::uuid = any(gone);
  update producer.pursuit_messages k
     set deleted_at = now()
   where k.kind in ('decision', 'meet') and k.deleted_at is null
     and (k.meta->'state_move'->>'src_msg')::uuid = any(gone);
  -- 被删气泡记的 memo 笔（0125）
  update producer.pursuit_messages k
     set deleted_at = now()
   where k.kind = 'memo' and k.deleted_at is null
     and (k.meta->'memo'->>'src_msg')::uuid = any(gone);

  return n;
end
$$;

revoke all on function public.pa_rewind_chat(uuid) from public;
grant execute on function public.pa_rewind_chat(uuid) to anon, authenticated, service_role;

-- ══ 撤口也得认 met 落的 meet 笔 ═══════════════════════════════════
-- （演练时撞出来的：0123 的撤口只找 kind='decision'）
create or replace function public.pa_undo_state_move(p_src_msg uuid)
returns uuid
language plpgsql security definer set search_path = public, producer
as $$
declare v_note uuid;
begin
  select id into v_note from producer.pursuit_messages
   where kind in ('decision', 'meet') and deleted_at is null
     and meta->'state_move'->>'src_msg' = p_src_msg::text
   order by created_at desc limit 1;
  if v_note is null then raise exception '没有可撤的（这条气泡没拨过提醒，或已经撤了）'; end if;

  delete from producer.message_tags where message_id = v_note;
  update producer.pursuit_messages set deleted_at = now() where id = v_note;
  update producer.pursuit_messages
     set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{state_move}',
                  coalesce(meta->'state_move', '{}'::jsonb) || '{"undone": true}'::jsonb)
   where id = p_src_msg;
  return v_note;
end $$;

revoke all on function public.pa_undo_state_move(uuid) from public;
grant execute on function public.pa_undo_state_move(uuid) to anon, authenticated, service_role;
