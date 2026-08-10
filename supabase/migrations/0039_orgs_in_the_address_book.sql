-- 补录：这条迁移线上已经跑过（20260810062526 / 0039_orgs_in_the_address_book），当时没落成文件。
-- 此文件由 supabase_migrations.schema_migrations.statements 逐字 dump，不是事后重写的。

-- 机构也进通讯录
--
-- 「机构信箱不是人」是对的，但通讯录装的是**你会写信的对象**，不是只装人。
-- residency@culturehub.org 来回七封，它当然该在通讯录里有一条。
--
-- 而且机构条目能回答一件人条目回答不了的事：**这里有谁，谁已经走了。**
-- CultureHub 那条会告诉你「Mattie（现在）· Stacy（到 2026-07 为止）」——
-- 这正是 Stacy 那四封旧信为什么归她的原因，摆在机构上一眼就看明白。

create or replace view public.v_pa_orgs as
with names as (
  select distinct org from producer.contact_orgs
  union
  select distinct org from producer.org_mailboxes
)
select n.org,
       -- 机构自己的共享信箱（可能不止一个）
       coalesce((select jsonb_agg(jsonb_build_object(
                          'email', b.email, 'label', b.label, 'notes', b.notes)
                          order by b.email)
                   from producer.org_mailboxes b where b.org = n.org), '[]'::jsonb) as mailboxes,
       -- 这里有谁。走了的不删，带 until —— 旧关系解释了旧往来。
       coalesce((select jsonb_agg(jsonb_build_object(
                          'contact_id', o.contact_id, 'name', c.name,
                          'role', o.role, 'since', o.since, 'until', o.until)
                          order by (o.until is not null), c.name)
                   from producer.contact_orgs o
                   join producer.contacts c on c.id = o.contact_id
                  where o.org = n.org), '[]'::jsonb) as people,
       (select count(*) from producer.contact_orgs o where o.org = n.org and o.until is null) as people_now,
       (select count(*) from producer.contact_orgs o where o.org = n.org and o.until is not null) as people_past,
       -- 走共享信箱的往来
       (select count(*) from producer.pursuit_messages m
         where m.gmail_message_id is not null
           and exists (select 1 from producer.org_mailboxes b
                        where b.org = n.org and lower(b.email) = lower(m.counterpart_email))) as mail_count,
       (select max(m.created_at)::date from producer.pursuit_messages m
         where m.gmail_message_id is not null
           and exists (select 1 from producer.org_mailboxes b
                        where b.org = n.org and lower(b.email) = lower(m.counterpart_email))) as last_touch_at,
       -- 挂着哪几条机会线：走共享箱的信所在的线 + 这里的人挂着的线
       coalesce((select jsonb_agg(distinct jsonb_build_object('id', p.id, 'title', p.title, 'stage', p.stage))
                   from producer.pursuits p
                  where exists (select 1 from producer.pursuit_messages m
                                 where m.pursuit_id = p.id
                                   and exists (select 1 from producer.org_mailboxes b
                                                where b.org = n.org
                                                  and lower(b.email) = lower(m.counterpart_email)))
                     or exists (select 1 from producer.contact_orgs o
                                 where o.contact_id = p.contact_id and o.org = n.org)),
                '[]'::jsonb) as pursuits
  from names n;

grant select on public.v_pa_orgs to anon, authenticated, service_role;

comment on view public.v_pa_orgs is
  '机构在通讯录里的条目。通讯录装的是「你会写信的对象」，不是只装人——共享信箱来回几封信，它就该有一条。机构条目还答一件人条目答不了的事：这里有谁，谁已经走了';
