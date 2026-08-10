-- 补录：这条迁移线上已经跑过（20260810064642 / 0042_address_book_digest），当时没落成文件。
-- 此文件由 supabase_migrations.schema_migrations.statements 逐字 dump，不是事后重写的。

-- 通讯录的一页纸摘要，喂给 Fairwind 认人用。
-- 它得看得见你已经有谁、各自有哪些邮箱，才判断得出「这是某人的新邮箱」
-- 还是「这是个新人」。名字像但机构和事情都对不上的，多半是两个人。
create or replace function public.pa_address_book_digest()
returns jsonb language sql security definer set search_path = public, producer as $fn$
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'org', c.org,
      'emails', coalesce((select jsonb_agg(e.email order by e.until nulls first, e.is_primary desc)
                            from producer.contact_emails e where e.contact_id = c.id), '[]'::jsonb),
      'orgs', coalesce((select jsonb_agg(o.org || coalesce(' · ' || o.role, '') ||
                                 case when o.until is not null then '（到 ' || o.until || ' 为止）' else '' end)
                          from producer.contact_orgs o where o.contact_id = c.id), '[]'::jsonb),
      'mailboxes', '[]'::jsonb
    ) as x from producer.contacts c
    union all
    select jsonb_build_object('name', b.org || ' 的共享箱', 'org', b.org,
                              'emails', '[]'::jsonb, 'orgs', '[]'::jsonb,
                              'mailboxes', jsonb_build_array(b.email))
      from producer.org_mailboxes b
  ) t;
$fn$;
revoke all on function public.pa_address_book_digest() from public, anon, authenticated;
grant execute on function public.pa_address_book_digest() to service_role;
