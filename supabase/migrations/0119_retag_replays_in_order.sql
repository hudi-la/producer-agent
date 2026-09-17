-- Producer Agent — 返工一封信的判断，它之后的信跟着重排
--
-- 真事（ASU，2026-08-22 修 Biayna 那条时埋下、8/23 被他抓到）：
-- 为了重判她 14:39 那封，把它的标签删了 —— 但他 14:43 的回信**已经
-- 判过了**；重判他那封时 state 看起来是 IDLE（她的标签正好不在），
-- 于是只答了「在等链接」、没答「回了那件事吗」。等她那封的标签补回来，
-- 「要回」重新开了，而他那封关不上它 —— 通知里挂着一条其实已经回过的
-- 「需要回复」。
--
-- 病根：**判断只在它当时的 state 下有效**。时间正序的管线天然满足这一点；
-- 手工返工不满足。所以返工必须连坐：删一封的标签，就把它之后同一条线/
-- 同一个人的标签全删 —— 它们会按时间正序重新排队，在正确的 state 下重判。

create or replace function public.pa_retag_from(p_message_id uuid)
returns int   -- 删了几条标签（含这封自己的）
language plpgsql security definer set search_path = public, producer as $$
declare v_at timestamptz; v_pursuit uuid; v_contact uuid; v_n int;
begin
  select m.created_at,
         coalesce((select v.pursuit_id from public.v_pa_pursuit_mail v
                    where v.id = m.id and v.on_this_line limit 1), m.pursuit_id),
         m.contact_id
    into v_at, v_pursuit, v_contact
    from producer.pursuit_messages m where m.id = p_message_id;
  if v_at is null then raise exception '没有这条消息：%', p_message_id; end if;

  with 同线之后的 as (
    select m.id from producer.pursuit_messages m
      left join lateral (
        select v.pursuit_id from public.v_pa_pursuit_mail v
         where v.id = m.id and v.on_this_line limit 1
      ) pm on true
     where m.created_at >= v_at and m.deleted_at is null
       and ((v_pursuit is not null and coalesce(pm.pursuit_id, m.pursuit_id) = v_pursuit)
         or (v_pursuit is null and v_contact is not null and m.contact_id = v_contact))
  ), 删 as (
    delete from producer.message_tags t
     using 同线之后的 x where t.message_id = x.id
    returning 1
  )
  select count(*) into v_n from 删;
  return v_n;
end $$;

revoke all on function public.pa_retag_from(uuid) from public;
grant execute on function public.pa_retag_from(uuid) to anon, authenticated, service_role;
