-- 0124 · 人也有小红点
-- 设计稿：docs/specs/2026-09-02-workspace-design.md（2026-09-03 那三条补充）
--
-- 机会线 2026-08-08 就有「Fairwind 说了话你还没读到」这个事实（0030 的
-- pursuit_seen + v_pa_pursuit_cards.unread）。人这一半一直没有——可人卡里
-- 同样有一条跟 Fairwind 的对话，它说了话你也一样会漏掉。
--
-- 「展开的卡片」那一排现在按红点自动摆卡（lib/desk.js 的 autoOpen）：
-- 没有这份事实，人就永远进不了那一排，而这不是设计选择，是缺一块数据。
--
-- 整个照抄 0030 的形状：独立的表（「我读没读过」是我和这张卡的关系，
-- 不是卡的属性）、时间只前进不后退、判据算在视图里（前端只读一个布尔）。

create table if not exists producer.contact_seen (
  contact_id uuid primary key references producer.contacts(id) on delete cascade,
  profile_id uuid not null references producer.profile(id),
  seen_at    timestamptz not null default now()
);

comment on table producer.contact_seen is
  '这个人的卡你读到哪儿了。跟卡走，不跟浏览器走——跟 pursuit_seen 同一套。';

create or replace function public.pa_mark_contact_seen(
  p_contact_id uuid,
  p_at         timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public, producer
as $$
declare pid uuid;
begin
  select id into pid from producer.profile limit 1;
  if pid is null then raise exception '库里没有 profile，contact_seen 挂不上人'; end if;

  insert into producer.contact_seen (contact_id, profile_id, seen_at)
  values (p_contact_id, pid, coalesce(p_at, now()))
  on conflict (contact_id) do update
    -- 只前进不后退：两个标签页并发、或补搬旧记录，都不该把已经读到的位置往回拨
    set seen_at = greatest(producer.contact_seen.seen_at, excluded.seen_at);
end
$$;

revoke all on function public.pa_mark_contact_seen(uuid, timestamptz) from public;
grant execute on function public.pa_mark_contact_seen(uuid, timestamptz) to anon, authenticated, service_role;

-- 视图补两列。其余列一个字不改（0032 那份原样抄下来）——
-- 少抄一列就是让界面上某一格突然空掉。
drop view if exists public.v_pa_contacts;
create view public.v_pa_contacts as
  select c.id, c.name, c.email, c.org, c.role, c.notes, c.channels,
         c.intro_by, c.intro_thanked_at,
         c.last_touch_at, c.last_touch_src, c.cadence_days,
         c.next_touch_at, c.next_touch_why,
         c.created_at, c.updated_at,
         -- 「Fairwind 说了话，你还没读到」。判据跟机会线那份一模一样：
         -- 最后一条是 producer 说的、不是建卡那份 brief、且晚于你上次读这张卡。
         -- 对方来信不直接点红点——收信时 Fairwind 会补一句告知，由那句来点。
         coalesce(
           last_msg.role = 'producer'
           and last_msg.kind is distinct from 'brief'
           and last_msg.created_at > coalesce(s.seen_at, c.created_at),
           false
         ) as unread,
         s.seen_at
    from producer.contacts c
    left join producer.contact_seen s on s.contact_id = c.id
    left join lateral (
      select m.role, m.kind, m.created_at
        from producer.pursuit_messages m
       where m.contact_id = c.id
       order by m.created_at desc
       limit 1
    ) last_msg on true;

grant select on public.v_pa_contacts to anon, authenticated, service_role;
