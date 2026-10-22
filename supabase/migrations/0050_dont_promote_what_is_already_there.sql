-- 搬信搬重了：SFCB 那 12 封里有 7 封本来就在对话表（0037 那次按地址重
-- 归属时进去的，挂在 SFCB 那条机会线上）。promote 把它们也搬了一遍，于是
-- 每封多出一行「没挂任何东西」的副本。
--
-- 0045 加的那条去重索引没挡住，而且**它没做错**：
--   (信, 线=X, 人=空)  和  (信, 线=空, 人=空)  本来就是两个不同的键。
-- 错在更前面一步——**已经在对话表里的信，根本不该出现在待搬清单里**。
--
-- 所以修在 pa_mail_promote：它是「还有什么要搬」的唯一来源，挡在这儿
-- 比在插入那一刻挡更早，也不用去动 pa_add_mail（那个口还有别的调用方，
-- 改它的语义风险大得多）。

-- ══ 一、先把刚插进去的那些副本清掉 ═════════════════════════════
--
-- 只删「双空 + 同一封信另有一行是有主的」这一种。判据写死成这三条，
-- 是为了不误伤任何一行本来就该无主待认领的信（0043 特意允许了那种）。
delete from producer.pursuit_messages dup
 where dup.gmail_message_id is not null
   and dup.pursuit_id is null
   and dup.contact_id is null
   and exists (
     select 1 from producer.pursuit_messages keep
      where keep.gmail_message_id = dup.gmail_message_id
        and keep.id <> dup.id
        and (keep.pursuit_id is not null or keep.contact_id is not null));

-- ══ 二、别再把已经在的信交出来搬 ═══════════════════════════════
create or replace function public.pa_mail_promote(p_email text)
returns jsonb
language sql security definer set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'gmail_message_id', h.gmail_message_id,
           'gmail_thread_id',  h.gmail_thread_id,
           'subject',          h.subject,
           'from_name',        h.from_name,
           'sent_at',          h.sent_at,
           'direction',        h.direction,
           'counterpart_email', h.counterpart_email) order by h.sent_at), '[]'::jsonb)
    from producer.mail_headers h
   where lower(h.counterpart_email) = lower(btrim(p_email))
     and h.promoted_at is null
     -- ↓ 对话表里已经有这封信了就别再搬。搬过去只会多一行没挂东西的副本。
     and not exists (select 1 from producer.pursuit_messages m
                      where m.gmail_message_id = h.gmail_message_id);
$$;

revoke all on function public.pa_mail_promote(text) from public, anon, authenticated;
grant execute on function public.pa_mail_promote(text) to service_role;

-- ══ 三、把「其实早就在对话表里」的信头也标成搬过了 ═══════════════
--
-- 不标的话它们每次都会被重新算进「待搬」，虽然现在挡住了，但那是白算。
update producer.mail_headers h set promoted_at = now()
 where h.promoted_at is null
   and exists (select 1 from producer.pursuit_messages m
                where m.gmail_message_id = h.gmail_message_id);
