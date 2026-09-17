-- Producer Agent — 预约信发出去之后，标签要补核
--
-- 病：预约发送的信入队时就触发过 messageAdded（收信增量只听这个），
--     真发出那一刻只是标签 SCHEDULED → SENT（labelAdded 事件），
--     增量听不见 —— 于是它的标签审计永远补不上，「每封信头都核过
--     Gmail 标签」那条自查从它发出那天起常红。
--     真例：给 Brooke 那封 8/20 10:03 的信。
--
-- 药：给收信循环一个小队列 —— 「时间已过、还没核过标签」的信，
--     每轮去 Gmail 拿一次标签写进审计（pa_mail_headers_upsert 顺手写，
--     0087 的机制）。补核过一次就从队列消失。

create or replace function public.pa_unaudited_sent()
returns table (gmail_message_id text)
language sql security definer set search_path = public, producer as $$
  select h.gmail_message_id
    from producer.mail_headers h
   where h.sent_at <= now()
     and h.sent_at > now() - interval '14 days'   -- 老信的核对归 0082 那套全量审计
     and not exists (select 1 from producer.mail_label_audit a
                      where a.gmail_message_id = h.gmail_message_id)
   limit 20
$$;

revoke all on function public.pa_unaudited_sent() from public;
grant execute on function public.pa_unaudited_sent() to anon, authenticated, service_role;
