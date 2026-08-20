-- Producer Agent — 不带时区的时间，按你住的地方解释
--
-- 病：judge 的格子让模型给「当地时间」（YYYY-MM-DDTHH:mm，不带时区），
--     可 pa_tag_message 的参数是 timestamptz —— 裸字符串一进来就被按
--     **UTC** 解释。真例：Biayna 9/11 中午 12 点的见面，存成了 12:00+00，
--     洛杉矶显示早上 5 点；DEBRIEF（见面后 1 小时切换）会在早上 6 点
--     就问「今天见面怎么样」——比见面本身早六个小时。
--
-- 药：参数改 text，裸的按 producer.app_tz() 解释；带时区的原样过。
--     跟 0061「日期按当地算」同一个道理。

drop function if exists public.pa_tag_message(uuid,text,boolean,text,boolean,text,text,int,timestamptz,text,text);

create or replace function public.pa_tag_message(
  p_message_id  uuid,
  p_situation   text,
  p_resolves     boolean default null,
  p_resolves_why text    default null,
  p_needs_reply  boolean default null,
  p_reply_why    text    default null,
  p_awaiting     text    default null,
  p_wait_days    int     default null,
  p_meet_at      text    default null,   -- 原来是 timestamptz；裸字符串会被当 UTC
  p_gist         text    default null,
  p_by           text    default 'fairwind'
) returns void
language plpgsql security definer set search_path to 'public'
as $$
declare v_meet timestamptz;
begin
  if p_message_id is null then raise exception '标签得有锚：message_id 是空的'; end if;
  if coalesce(btrim(p_situation), '') = '' then
    raise exception '标签得说清是哪一格问出来的：situation 是空的';
  end if;

  if coalesce(btrim(p_meet_at), '') = '' then
    v_meet := null;
  elsif p_meet_at ~ '(Z|[+-]\d{2}:?\d{2})\s*$' then
    v_meet := p_meet_at::timestamptz;                                  -- 带时区：原样
  else
    v_meet := (p_meet_at::timestamp) at time zone producer.app_tz();   -- 裸的：按当地
  end if;

  insert into producer.message_tags as t (
    message_id, situation, resolves, resolves_why, needs_reply, reply_why,
    awaiting, wait_days, meet_at, gist, tagged_by
  ) values (
    p_message_id, btrim(p_situation),
    p_resolves, nullif(btrim(coalesce(p_resolves_why, '')), ''),
    p_needs_reply, nullif(btrim(coalesce(p_reply_why, '')), ''),
    nullif(btrim(coalesce(p_awaiting, '')), ''), p_wait_days,
    v_meet, nullif(btrim(coalesce(p_gist, '')), ''),
    coalesce(nullif(btrim(coalesce(p_by, '')), ''), 'fairwind')
  )
  on conflict (message_id) do update set
    situation    = excluded.situation,
    resolves     = excluded.resolves,
    resolves_why = excluded.resolves_why,
    needs_reply  = excluded.needs_reply,
    reply_why    = excluded.reply_why,
    awaiting     = excluded.awaiting,
    wait_days    = excluded.wait_days,
    meet_at      = excluded.meet_at,
    gist         = excluded.gist,
    tagged_at    = now(),
    tagged_by    = excluded.tagged_by;
end $$;

revoke all on function public.pa_tag_message(uuid,text,boolean,text,boolean,text,text,int,text,text,text) from public;
grant execute on function public.pa_tag_message(uuid,text,boolean,text,boolean,text,text,int,text,text,text) to anon, authenticated, service_role;

-- 已经存错的那一条（Biayna 9/11 见面被按 UTC 存成 12:00+00）点名纠正。
-- 全库此刻只有这一条带 meet_at 的标签 —— 不写启发式的兜底，兜底会误伤。
update producer.message_tags
   set meet_at = timestamp '2026-09-11 12:00' at time zone producer.app_tz()
 where message_id = '81f8ae28-9278-415e-8861-d42467afcac5'
   and meet_at = timestamptz '2026-09-11 12:00+00';
