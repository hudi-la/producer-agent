-- Producer Agent — 到点的事，动一次，别重复动
--
-- timerPass 每 5 分钟扫一遍「到点了的」。两个问题它自己答不了，得库答：
--
--   一、**动过了吗** —— 起草/发问是往卡里写一条带 meta.timer.key 的消息。
--       key = state:subject:since 那天。同一个等待只动一次；等待换了
--       （新的 since_at）就是新的 key，可以再动。
--   二、**允不允许自动起草** —— 线都允许；人只对 Fairwind 开工
--       （2026-08-03）之后建的（设计稿第八节：老联系人的谢信、见面信
--       不自动起草，免得一夜之间冒出几十封 700 天前的草稿）。
--
-- 设计稿：docs/specs/2026-08-19-what-this-line-is-waiting-on-design.md 第五、八节

create or replace function public.pa_due_actions()
returns table (
  subject_kind text, subject_id uuid, state text, what text, why text,
  since_at timestamptz, due_at timestamptz, anchor_id uuid,
  subject_name text, days_over int, acted boolean, allowed boolean
) language sql security definer set search_path = public, producer as $$
  select s.subject_kind, s.subject_id, s.state, s.what, s.why,
         s.since_at, s.due_at, s.anchor_id,
         coalesce(p.title, c.name) as subject_name,
         greatest(0, (now()::date - s.due_at::date)) as days_over,
         exists (
           select 1 from producer.pursuit_messages pm
            where pm.deleted_at is null
              and pm.meta->'timer'->>'key' =
                  s.state || ':' || s.subject_id || ':' || (s.since_at)::date
         ) as acted,
         (s.subject_kind = 'pursuit'
          or exists (select 1 from producer.contacts c2
                      where c2.id = s.subject_id
                        and c2.created_at >= timestamptz '2026-08-03')) as allowed
    from public.v_pa_state s
    left join producer.pursuits p on s.subject_kind = 'pursuit' and p.id = s.subject_id
    left join producer.contacts c on s.subject_kind = 'contact' and c.id = s.subject_id
   where s.zone = 'due'
   order by s.due_at
$$;

revoke all on function public.pa_due_actions() from public;
grant execute on function public.pa_due_actions() to anon, authenticated, service_role;
