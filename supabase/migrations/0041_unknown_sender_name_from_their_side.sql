-- 补录：这条迁移线上已经跑过（20260810063619 / 0041_unknown_sender_name_from_their_side），当时没落成文件。
-- 此文件由 supabase_migrations.schema_migrations.statements 逐字 dump，不是事后重写的。

-- 「还不认识的地址」里那个署名取错了：它从最新一封取 from_name，
-- 可最新一封往往是**你自己发出去的**，于是页面上显示的是你自己的名字。
-- 只从对方发来的那些（role='org'）取署名——你要认的是对面那个人。
create or replace view public.v_pa_unknown_senders as
  select m.counterpart_email as email,
         count(*)                       as 封数,
         min(m.created_at)::date        as 第一次,
         max(m.created_at)::date        as 最近一次,
         count(*) filter (where m.role = 'org')    as 他发来的,
         count(*) filter (where m.role = 'artist') as 你发去的,
         (array_agg(m.meta->>'from_name' order by m.created_at desc)
            filter (where m.role = 'org' and m.meta->>'from_name' is not null))[1] as 信头署名,
         (array_agg(distinct p.title))[1:3] as 出现在哪些机会线
    from producer.pursuit_messages m
    left join producer.pursuits p on p.id = m.pursuit_id
   where m.gmail_message_id is not null
     and m.counterpart_email is not null
     and m.contact_id is null
     and not exists (select 1 from producer.org_mailboxes b
                      where lower(b.email) = lower(m.counterpart_email))
   group by m.counterpart_email
   order by 2 desc;
grant select on public.v_pa_unknown_senders to anon, authenticated, service_role;
