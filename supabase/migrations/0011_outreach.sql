-- Producer Agent — 主动外联（cold outreach）所需的最小三样
--
-- 背景：前十条机会线全是 scout 找来的 open call（有截止、有申请表、别人开的口子）。
-- 主动外联是另一种形状：没有截止、没有申请表、机会是你造的。
-- 它死于跟进，不死于第一封信——Gmail 里有实证：2026-02 那批发出去后，
-- LACHSA 回了「circle back next semester」、Ruth Asawa SOTA 回了「there is interest」，
-- 两条都因为没人记得该在什么时候再碰一次而飘掉了。
--
-- 所以这刀只补三样，不多补：
--   1. contacts      —— 信是发给人的，不是发给机构的。人才是会复利的资产。
--   2. next_touch_at —— 外联唯一的引擎。没有截止逼你时，只有它逼你。
--   3. payoff        —— 用户的判据：要么给钱，要么给圈子，两样都不给的不发。
--                       每张卡必须回答这一句，不能含糊过去（2026-02 那批就是含糊掉的）。
--
-- 刻意没做的：没有为外联新增 stage。现有九格先凑合用，
-- 让 next_touch_at 承担「球在谁那边」（≤ 今天 = 该你动了）。
-- 等这两条线真跑一轮，stage 该长什么样会由经历说出来，而不是现在拍脑袋。

-- ── 人 ─────────────────────────────────────────────────────────
create table if not exists producer.contacts (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  email      text,
  org        text,
  role       text,                                   -- 他在机构里管什么（决定他能不能拍板）
  notes      text,                                   -- 关系记忆：怎么认识的、他关心什么、上次聊到哪
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists contacts_email_uniq on producer.contacts (lower(email)) where email is not null;

drop trigger if exists contacts_touch on producer.contacts;
create trigger contacts_touch before update on producer.contacts
  for each row execute function producer.touch_updated_at();

-- ── 机会线上的三个新字段 ───────────────────────────────────────
alter table producer.pursuits
  add column if not exists contact_id    uuid references producer.contacts(id) on delete set null,
  add column if not exists next_touch_at date,
  add column if not exists payoff        text;       -- paid | access | both（neither 的根本不建卡）

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pursuits_payoff_chk') then
    alter table producer.pursuits
      add constraint pursuits_payoff_chk check (payoff is null or payoff in ('paid','access','both'));
  end if;
end $$;

create index if not exists pursuits_next_touch_idx on producer.pursuits (next_touch_at)
  where next_touch_at is not null;

-- ── 读面：视图带上新字段 + 联系人 ──────────────────────────────
-- 注意：不能用 create or replace——列顺序变了，Postgres 会拒绝改列名。
drop view if exists public.v_pa_pursuits;
create view public.v_pa_pursuits as
  select p.id, p.title, p.kind, p.org, p.location, p.url, p.funding, p.deadline,
         p.match_stars, p.why, p.notes, p.source, p.eligible, p.stage,
         p.work_id, p.task_id, p.created_at,
         p.next_touch_at, p.payoff, p.contact_id,
         w.title as work_title,
         c.name  as contact_name,
         c.role  as contact_role
    from producer.pursuits p
    left join producer.works    w on w.id = p.work_id
    left join producer.contacts c on c.id = p.contact_id;

grant select on public.v_pa_pursuits to anon, authenticated;

-- 联系人有 email/notes（关系记忆里有私人内容），先只开给 authenticated，anon 不给。
drop view if exists public.v_pa_contacts;
create view public.v_pa_contacts as
  select id, name, org, role, notes, created_at from producer.contacts;

grant select on public.v_pa_contacts to authenticated;
revoke all on public.v_pa_contacts from anon;
