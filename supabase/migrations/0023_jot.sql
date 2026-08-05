-- 卡上随手记的几个字。
--
-- 为什么不复用 notes：notes 是 scout 抓机会时写的英文备注（见 scout-prompt.md
-- 的字段映射，🟡关注 也标在那儿）。你自己想起来记一笔，跟机器写的备注不是
-- 一回事——今天刚在 next_touch_at 上吃过「一个字段装几种意思」的亏，不重蹈。
--
-- 刻意不做的：不加长度限制。「几个字」是用法，不是约束——哪天你想多写两句，
-- 不该被数据库拦住。

alter table producer.pursuits
  add column if not exists jot text;

comment on column producer.pursuits.jot is '你自己随手记的；和 scout 写的 notes 分开';

-- ── 读面：只多一列 jot，其余照抄 0021 ─────────────────────────
drop view if exists public.v_pa_pursuits;
create view public.v_pa_pursuits as
  select p.id, p.title, p.kind, p.org, p.location, p.url, p.funding, p.deadline,
         p.match_stars, p.why, p.notes, p.source, p.eligible, p.stage,
         p.work_id, p.task_id, p.created_at,
         p.next_touch_at, p.payoff, p.contact_id,
         p.opens_at, p.deadline_at, p.next_action, p.next_action_done_at, p.last_touch_at,
         p.jot,
         w.title as work_title,
         c.name  as contact_name,
         c.role  as contact_role,
         p.ball, p.ball_at,
         b.ball_auto,
         case when b.manual_holds then p.ball else b.ball_auto end as ball_eff
    from producer.pursuits p
    left join producer.works    w on w.id = p.work_id
    left join producer.contacts c on c.id = p.contact_id
    left join lateral (
      select m.role, m.created_at
        from producer.pursuit_messages m
       where m.pursuit_id = p.id
         and m.role in ('org','artist')
         and m.kind = 'email'
       order by m.created_at desc
       limit 1
    ) last_ext on true
    cross join lateral (
      select
        case
          when p.next_touch_at is not null and p.next_touch_at <= current_date then 'me'
          when last_ext.role = 'org'    then 'me'
          when last_ext.role = 'artist' then 'them'
          else null
        end as ball_auto,
        p.ball is not null
          and (
            p.ball_at is null
            or (
              (last_ext.created_at is null or last_ext.created_at <= p.ball_at)
              and (p.next_touch_at is null
                   or p.next_touch_at > current_date
                   or p.next_touch_at <= p.ball_at::date)
            )
          ) as manual_holds
    ) b;

grant select on public.v_pa_pursuits to anon, authenticated, service_role;

-- ── 写口 ──────────────────────────────────────────────────────
-- 和 pa_set_stage 同构：浏览器直连，能改的列写死在函数里。
-- 空字符串存成 null，免得「清空」留下一个看不见的空串。
create or replace function public.pa_set_jot(p_pursuit_id uuid, p_jot text)
returns void
language plpgsql
security definer
set search_path to 'public', 'producer'
as $function$
begin
  update producer.pursuits set jot = nullif(btrim(coalesce(p_jot, '')), '')
   where id = p_pursuit_id;
  if not found then raise exception 'no pursuit: %', p_pursuit_id; end if;
end;
$function$;

revoke all on function public.pa_set_jot(uuid, text) from public;
grant execute on function public.pa_set_jot(uuid, text) to anon, authenticated, service_role;
