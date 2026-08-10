-- Producer Agent — 一个人多个邮箱、多个人一个机构、机构自己也有信箱
--
-- 设计稿：docs/specs/2026-08-08-people-layer-design.md
--
-- ══ 这一刀在修什么 ═════════════════════════════════════════════
--
-- 0033 第 ① 步的判据是「这条线挂了谁，这条线的邮件就都是谁的」。
-- 那是**倒推，是猜**——而且猜错了。去 Gmail 逐条核对了 8 条 thread 32 封信：
--
--   对面地址                    封数   当时挂在   真相
--   urban-art@hotmail.com        10    Kirk      ✓
--   workshops@sfcb.org            7    Sarah     SFCB 的机构信箱，不是她
--   residency@culturehub.org      7    Mattie    CultureHub 的机构信箱，不是她
--   stacy@culturehub.org          4    Mattie    Stacy（旧地址）
--   sarah@sfcb.org                2    Sarah     ✓
--   sdsproduction@pm.me           1    Mattie    Stacy（新地址）
--   mattie@culturehub.org         1    Mattie    ✓
--
-- Mattie 名下 13 封只有 1 封真是她的。这不是丢信息，是**归错人**——
-- 页面上一切正常，只是 Stacy 的告别信长在别人卡上。归错比丢更难发现。
--
-- ══ 三条现实，结构得装得下 ═════════════════════════════════════
--   1. 一个人有多个邮箱，而且会换（Stacy: stacy@culturehub.org → sdsproduction@pm.me）
--   2. 多个人对应一个机构（Stacy / Mattie / Billy / Joo 都在 CultureHub）
--   3. 机构自己有信箱，署名是一组人（residency@ 署 "Mattie, Billy, and Joo"）
--      **它不是人。** 它的往来属于那条机会线，不属于任何一张名片。
--   4. 关系会过期：Stacy 2026-07 离开 CultureHub。旧事实不删，标上截止日期。

-- ══ 一、一个人的多个邮箱 ═══════════════════════════════════════
create table if not exists producer.contact_emails (
  id         uuid primary key default gen_random_uuid(),
  contact_id uuid not null references producer.contacts(id) on delete cascade,
  email      text not null,
  is_primary boolean not null default false,
  since      date,
  -- 停用日期。**不删行**——旧地址是历史往来的钥匙，删了那些信就再也认不回来。
  until      date,
  note       text,
  created_at timestamptz not null default now()
);
-- 一个地址只能属于一个人。这条是邮件归属的地基。
create unique index if not exists contact_emails_uniq
  on producer.contact_emails (lower(email));
create index if not exists contact_emails_cid on producer.contact_emails (contact_id);

comment on column producer.contact_emails.until is
  '停用日期。行不删——旧地址是历史往来的钥匙，删了那些信就再也认不回来';

-- ══ 二、机构信箱：**不是人** ═══════════════════════════════════
create table if not exists producer.org_mailboxes (
  id      uuid primary key default gen_random_uuid(),
  org     text not null,
  email   text not null,
  label   text,                       -- 「驻地组共享箱」
  notes   text,                       -- 「署名 Mattie, Billy, and Joo」
  created_at timestamptz not null default now()
);
create unique index if not exists org_mailboxes_uniq
  on producer.org_mailboxes (lower(email));

comment on table producer.org_mailboxes is
  '机构的共享信箱。它不是人，所以它的往来归那条机会线，不归任何一张名片——摆在某个人的名片上等于界面在撒谎';

-- ══ 三、谁在哪个机构，什么时候起、什么时候止 ═══════════════════
create table if not exists producer.contact_orgs (
  id         uuid primary key default gen_random_uuid(),
  contact_id uuid not null references producer.contacts(id) on delete cascade,
  org        text not null,
  role       text,
  since      date,
  -- 离开的日期。**旧的一行不删**——「她以前在 CultureHub」是真事，
  -- 而且正是它解释了为什么 stacy@culturehub.org 那四封信是她的。
  until      date,
  created_at timestamptz not null default now()
);
create index if not exists contact_orgs_cid on producer.contact_orgs (contact_id);
create unique index if not exists contact_orgs_uniq
  on producer.contact_orgs (contact_id, lower(org), coalesce(since, date '1900-01-01'));

-- ══ 四、把现有四个人的邮箱和机构填进去 ═════════════════════════
-- 都是核对过的事实，不是猜的。
insert into producer.contact_emails (contact_id, email, is_primary, since, until, note)
select c.id, x.email, x.prim, x.since, x.until, x.note
  from producer.contacts c
  join (values
    ('Kirk Pedersen',        'urban-art@hotmail.com', true,  null,               null,               null),
    ('Sarah',                'sarah@sfcb.org',        true,  date '2026-07-30',  null,               '7/30 通完电话后她改用个人邮箱，之前一直走 workshops@ 共享箱'),
    ('Mattie',               'mattie@culturehub.org', true,  null,               null,               '她有个人邮箱和 Calendly；驻地那条线多数走 residency@ 共享箱'),
    ('Stacy Dawson Stearns', 'sdsproduction@pm.me',   true,  date '2026-07-02',  null,               '离开 CultureHub 后换的新地址'),
    ('Stacy Dawson Stearns', 'stacy@culturehub.org',  false, null,               date '2026-07-02',  '已失效。她 2026-07 离开 CultureHub，告别信就是从这个地址发的')
  ) as x(who, email, prim, since, until, note) on x.who = c.name
 where not exists (select 1 from producer.contact_emails e where lower(e.email) = lower(x.email));

insert into producer.contact_orgs (contact_id, org, role, since, until)
select c.id, x.org, x.role, x.since, x.until
  from producer.contacts c
  join (values
    ('Kirk Pedersen',        'ZERO+ Publishing',              'Director（出版人 + 策展）',      null, null),
    ('Sarah',                'San Francisco Center for the Book', 'Workshops / programming',  null, null),
    ('Mattie',               'CultureHub',                    'Residency program',              null, null),
    ('Stacy Dawson Stearns', 'CultureHub',                    'LA Director',                   null, date '2026-07-02'),
    ('Stacy Dawson Stearns', '独立',                           null,                            date '2026-07-02', null)
  ) as x(who, org, role, since, until) on x.who = c.name
 where not exists (select 1 from producer.contact_orgs o
                    where o.contact_id = c.id and lower(o.org) = lower(x.org));

insert into producer.org_mailboxes (org, email, label, notes)
select * from (values
  ('CultureHub', 'residency@culturehub.org', '驻地组共享箱', '署名一直是「Mattie, Billy, and Joo」三人组。它不是一个人'),
  ('San Francisco Center for the Book', 'workshops@sfcb.org', '工作坊共享箱', 'Sarah 7/30 之后改用个人邮箱')
) as x(org, email, label, notes)
 where not exists (select 1 from producer.org_mailboxes b where lower(b.email) = lower(x.email));

-- ══ 五、按真实地址重新归属那 32 封 ═════════════════════════════
-- 地址是从 Gmail 信头逐条核对来的（8 条 thread，一封不多不少）。
-- 机构信箱那 14 封 contact_id 清空——它们仍然一封不落地挂在机会线上，
-- 只是不再假装属于某个人。
with truth(gid, 对面) as (values
  ('19dc07abede2c858','stacy@culturehub.org'),   ('19dcc20fdb1d27cd','stacy@culturehub.org'),
  ('19f2026fdd9ffcfd','stacy@culturehub.org'),   ('19f217cc721bdc63','stacy@culturehub.org'),
  ('19f2419748d85ee8','sdsproduction@pm.me'),
  ('19f90ab6a69dd42f','residency@culturehub.org'),('19fb38ac2c5fdd7b','residency@culturehub.org'),
  ('19fb619aa155a6b5','residency@culturehub.org'),('19fc9343646e7b69','residency@culturehub.org'),
  ('19fcad8ffe30b472','residency@culturehub.org'),('19fd37ce59d4725c','residency@culturehub.org'),
  ('19fd8f83501ba4df','residency@culturehub.org'),
  ('19f922be6352994c','mattie@culturehub.org'),
  ('19f1556aa2e995a8','workshops@sfcb.org'),     ('19f1a1c08c171ecd','workshops@sfcb.org'),
  ('19f1aeb7206a534c','workshops@sfcb.org'),     ('19f487f1635f0370','workshops@sfcb.org'),
  ('19f49312c2a36309','workshops@sfcb.org'),     ('19f4d11d41fe6a28','workshops@sfcb.org'),
  ('19f4ecdc2f6a0a6d','workshops@sfcb.org'),
  ('19fb51f7bcc90fdf','sarah@sfcb.org'),         ('19fba3685a834210','sarah@sfcb.org'),
  ('19ef0ff5d5a29f73','urban-art@hotmail.com'),  ('19ef103f4e965837','urban-art@hotmail.com'),
  ('19ef2bc1b143e572','urban-art@hotmail.com'),  ('19efdd64bbedfd80','urban-art@hotmail.com'),
  ('19f09d042f101ce7','urban-art@hotmail.com'),  ('19f10eda7856fc7f','urban-art@hotmail.com'),
  ('19f3464a342cc26f','urban-art@hotmail.com'),  ('19f3fcbbfca14a5c','urban-art@hotmail.com'),
  ('19fc543bffe117da','urban-art@hotmail.com'),  ('19fcae122a2f6622','urban-art@hotmail.com'))
update producer.pursuit_messages m
   set contact_id = (select e.contact_id from producer.contact_emails e
                      where lower(e.email) = t.对面),      -- 机构信箱查不到 → null
       meta = coalesce(m.meta, '{}'::jsonb) || jsonb_build_object('counterpart', t.对面)
  from truth t
 where m.gmail_message_id = t.gid;

-- 「上次碰」跟着重算：归属变了，日期当然也变。来源仍是 email。
update producer.contacts c
   set last_touch_at = x.d, last_touch_src = 'email'
  from (select contact_id, max(created_at)::date as d
          from producer.pursuit_messages
         where contact_id is not null and gmail_message_id is not null
         group by contact_id) x
 where c.id = x.contact_id;
-- 重算之后一封信都没有的人，把那个日期清掉——留着就是一个来路不明的数字
update producer.contacts c set last_touch_at = null, last_touch_src = null
 where c.last_touch_src = 'email'
   and not exists (select 1 from producer.pursuit_messages m
                    where m.contact_id = c.id and m.gmail_message_id is not null);

-- ══ 六、自校验 ═════════════════════════════════════════════════
do $$
declare n_mail int; n_person int; n_org int; n_lost int;
begin
  select count(*) into n_mail from producer.pursuit_messages where gmail_message_id is not null;
  select count(*) into n_person from producer.pursuit_messages
   where gmail_message_id is not null and contact_id is not null;
  select count(*) into n_org from producer.pursuit_messages m
   where m.gmail_message_id is not null and m.contact_id is null
     and exists (select 1 from producer.org_mailboxes b where lower(b.email) = m.meta->>'counterpart');
  -- 没有主人、也不是机构信箱的，就是真的漏了
  select count(*) into n_lost from producer.pursuit_messages m
   where m.gmail_message_id is not null and m.pursuit_id is null and m.contact_id is null;

  if n_person + n_org <> n_mail then
    raise exception '对不上：% 封信里 % 封归了人、% 封归了机构信箱，剩下的没着落', n_mail, n_person, n_org;
  end if;
  if n_lost > 0 then
    raise exception '有 % 封信既没有人也没有机会线 —— 无主', n_lost;
  end if;
  raise notice '✓ % 封：% 封归到人，% 封是机构信箱（留在机会线上）', n_mail, n_person, n_org;
end $$;

-- ══ 七、读面 ═══════════════════════════════════════════════════
create or replace view public.v_pa_contact_emails as
  select id, contact_id, email, is_primary, since, until, note from producer.contact_emails;
grant select on public.v_pa_contact_emails to anon, authenticated, service_role;

create or replace view public.v_pa_contact_orgs as
  select id, contact_id, org, role, since, until from producer.contact_orgs;
grant select on public.v_pa_contact_orgs to anon, authenticated, service_role;

create or replace view public.v_pa_org_mailboxes as
  select id, org, email, label, notes from producer.org_mailboxes;
grant select on public.v_pa_org_mailboxes to anon, authenticated, service_role;
