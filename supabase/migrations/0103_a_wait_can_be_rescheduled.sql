-- Producer Agent — 等待的到点日可以改
--
-- 真事（Arboretum，2026-08-20）：默认判了「等 5 天」，可你和 Fairwind
-- 在卡里聊定了「周四再催」—— 这个结论没有任何口子可落。今天碰巧就是
-- 周四所以自愈了；不巧的话，到点行会一直挂着催你，而你明明已经安排了。
--
-- 口子开在标签上：等待锚在一封信的标签里（awaiting + wait_days），
-- 改到点日 = 按新日子重算 wait_days。不整个 upsert（那会把没送的字段
-- 抹成 null），只动 wait_days，并把「谁改的、凭什么」记进账。

create or replace function public.pa_reschedule_wait(
  p_anchor uuid,          -- v_pa_state.anchor_id：等待锚着的那条标签
  p_due date,             -- 新的到点日（当地的日子）
  p_why text default null -- 凭什么改（「跟 Fairwind 说好周四再催」）
) returns void
language plpgsql security definer set search_path = public, producer
as $$
declare v_at date; v_days int;
begin
  select (m.created_at at time zone producer.app_tz())::date into v_at
    from producer.message_tags t
    join producer.pursuit_messages m on m.id = t.message_id
   where t.message_id = p_anchor and t.awaiting is not null;
  if v_at is null then
    raise exception '这条不是一个在等的标签：%', p_anchor;
  end if;

  v_days := p_due - v_at;
  if v_days <= 0 then
    raise exception '新到点日（%）得在起点（%）之后', p_due, v_at;
  end if;

  update producer.message_tags
     set wait_days = v_days,
         situation = situation || '｜你改的到点日 → ' || p_due
                     || coalesce('（' || nullif(btrim(p_why), '') || '）', ''),
         tagged_at = now(), tagged_by = 'user'
   where message_id = p_anchor;
end $$;

revoke all on function public.pa_reschedule_wait(uuid, date, text) from public;
grant execute on function public.pa_reschedule_wait(uuid, date, text)
  to anon, authenticated, service_role;
