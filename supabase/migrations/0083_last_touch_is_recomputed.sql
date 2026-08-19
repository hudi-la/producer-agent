-- Producer Agent — 「上次碰」得重算，不能写一次就不管
--
-- 病：三张名片上写着「上次碰」的日子，可你从没真联系过那个人 ——
--     tatec1@sfusd.edu（2026-02-09）、clau2iaross@gmail.com（2025-04-21）、
--     Lindsey White（2025-04-24），名下各只有一条消息，**那一条就是草稿**，
--     真信零封。
--     Karolyn Heimes 是草稿（5/02）顶掉了真信（4/29）。
--     Steven Lam 是那封定时发送（8/25，还没到）顶掉了真信（8/17）。
--
-- 病根：contacts.last_touch_at 由 pa_add_mail 写一次，**之后再也不重算**。
--     草稿当时被当成真信收了进来，它写下的日期就永久留在名片上 ——
--     哪怕后来我们认出那是草稿、把信标掉了，这个日期一动不动。
--
--     「存下来的东西会跟事实分叉，算出来的不会」（cues.js 开头那句），
--     又一次。
--
-- 药：给它一个重算的口子，并且**挂到重判管线上**（0078 的执行点）。
--     以后每次重判一个对象，顺手把「上次碰」按真信重算一遍。
--
-- 上游：0082（账本认标签之后，「哪些是真信」才有权威答案）

create or replace function public.pa_recompute_touch(p_kind text, p_id uuid)
returns date
language plpgsql
security definer
set search_path = public, producer
as $$
declare d date;
begin
  -- 只有人有这一栏。线上的「上次碰」在别处算。
  if p_kind <> 'contact' then return null; end if;

  -- **只认真信**：kind='email' 已经排掉了 gmail_draft（0075/0081/0082）。
  -- 日期按你住的地方算，跟 pa_add_mail 写的时候一致，不然会差一天。
  select max((m.created_at at time zone producer.app_tz())::date) into d
    from producer.pursuit_messages m
   where m.contact_id = p_id and m.kind = 'email' and m.deleted_at is null;

  -- 你自己打的卡 / 记的一笔比信更晚的话，保留那个 —— 它不是从信推出来的，
  -- 是你亲手记的，重算不该把它抹掉。
  if exists (select 1 from producer.contacts c
              where c.id = p_id and c.last_touch_src in ('checkin','meet')
                and c.last_touch_at > coalesce(d, date '1900-01-01')) then
    return null;
  end if;

  update producer.contacts
     set last_touch_at = d,
         -- 一封真信都没有 → 「你碰过他」这句话本身是假的，一起清掉。
         -- 清的是一个假事实，不是信 —— 信一封都没动。
         last_touch_src = case when d is null then null else 'email' end
   where id = p_id;
  return d;
end $$;

grant execute on function public.pa_recompute_touch(text, uuid)
  to anon, authenticated, service_role;

-- 现在全库重算一次。
do $$
declare r record;
begin
  for r in select id from producer.contacts loop
    perform public.pa_recompute_touch('contact', r.id);
  end loop;
end $$;
