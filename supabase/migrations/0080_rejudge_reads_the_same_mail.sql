-- Producer Agent — 重判读的往来，得跟事实视图是同一批信
--
-- 取一批对象的近况交给模型重判。走 public 的 security definer：
-- producer schema 没进 Exposed schemas（0074 那次的教训）。
--
-- ══ 写这一支时当场撞到的坑 ═════════════════════════════════════
--
-- 第一版用 `m.pursuit_id = n.i` 直接取这条线的信。真跑下来，重判给
-- Paperbark 定了 8/24，出处抄的是 7/9 那句话 —— 可 8/17 Sarah 已经明说
-- "I think we should plan on 2027 … I would expect to hear from me around
-- the end of the month"。**模型没看见那封。**
--
-- 病根：很多信是靠班底 / 串登记**推导**挂到线上的，pursuit_id 是空的
-- （v_pa_pursuit_mail.on_this_line，0052/0053/0055 建的）。Sarah 那条线
-- 最近 8 封里 8/16 和 8/17 两封全被漏掉，模型只看到 8/03 为止。
--
-- v_pa_cue_facts 用推导，这个 RPC 用直接字段 —— **同一件事两种口径**，
-- 又一次。改完之后重判给出 2026-09-28，出处是她那句原话。
--
-- 设计稿：docs/specs/2026-08-19-rejudge-design.md

create or replace function public.pa_subjects_for_rejudge(p_kinds text[], p_ids uuid[])
returns jsonb
language sql
security definer
set search_path = public, producer
as $$
  with 点名 as (
    select unnest(p_kinds) as k, unnest(p_ids) as i
  ), 这条线上的 as (
    -- 跟 v_pa_cue_facts 同一个口径：on_this_line 的推导，不是 m.pursuit_id
    select 'pursuit'::text as k, v.pursuit_id as i,
           m.created_at, m.role, m.body_raw, m.content, v.who
      from public.v_pa_pursuit_mail v
      join producer.pursuit_messages m on m.id = v.id and m.deleted_at is null
     where v.on_this_line and v.kind in ('email','note','meet','decision')
    union all
    select 'contact', m.contact_id, m.created_at, m.role, m.body_raw, m.content,
           coalesce(c.name, m.counterpart_email)
      from producer.pursuit_messages m
      left join producer.contacts c on c.id = m.contact_id
     where m.contact_id is not null and m.deleted_at is null
       and m.kind in ('email','note','meet','decision')
  ), 往来 as (
    -- 每个对象最近 8 封。够看懂「现在到哪一步了」，又不至于把提示词撑爆。
    select n.k, n.i, jsonb_agg(jsonb_build_object(
             'at',   to_char(x.created_at, 'YYYY-MM-DD'),
             'who',  x.who,
             'dir',  case when x.role = 'org' then 'in' else 'out' end,
             'text', left(coalesce(x.body_raw, x.content, ''), 700)
           ) order by x.created_at) as mails
      from 点名 n
      join lateral (
        select * from 这条线上的 z
         where z.k = n.k and z.i = n.i
         order by z.created_at desc limit 8) x on true
     group by n.k, n.i
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',        n.k || ':' || n.i,
           'what',      coalesce(p.title, c.name, '（无名）'),
           'who',       coalesce(p.contact_name, c.name),
           -- **阶段也是判断的一部分**：已经在「发出&提交」的，说明你做完了
           'stage',     case p.stage
                          when 'pending'  then '新机会'  when 'matching' then '匹配项目'
                          when 'writing'  then '一起写'  when 'sent'     then '发出&提交'
                          when 'replying' then '进行中'  when 'won'      then '谈成'
                          when 'paused'   then '搁置'    else null end,
           'touch',     coalesce(pp.next_touch_at, c.next_touch_at),
           'touch_why', coalesce(pp.next_touch_why, c.next_touch_why),
           'action',    case when pp.next_action_done_at is null
                              and pp.next_action_void_at is null then pp.next_action end,
           'mails',     coalesce(t.mails, '[]'::jsonb)
         )), '[]'::jsonb)
    from 点名 n
    left join 往来 t on t.k = n.k and t.i = n.i
    left join public.v_pa_pursuits p on n.k = 'pursuit' and p.id = n.i
    left join producer.pursuits pp   on n.k = 'pursuit' and pp.id = n.i
    left join producer.contacts c    on n.k = 'contact' and c.id = n.i
$$;

comment on function public.pa_subjects_for_rejudge(text[], uuid[]) is
  '一批对象的近况。往来走 on_this_line 推导 —— 跟 v_pa_cue_facts 同一个口径，不用 m.pursuit_id';

grant execute on function public.pa_subjects_for_rejudge(text[], uuid[]) to service_role;

-- 顺手的一支：pa_suspect_drafts —— 0075 认草稿时用来点名嫌疑行的。
-- 留着，以后再怀疑有草稿混进来，还是从它开始。
create or replace function public.pa_suspect_drafts()
returns table (gmail_message_id text)
language sql
security definer
set search_path = public, producer
as $$
  select h.gmail_message_id from producer.mail_headers h
   where h.direction = 'out' and (h.subject is null or h.subject = '')
     and not h.is_draft
   order by h.sent_at
$$;
grant execute on function public.pa_suspect_drafts() to service_role;
