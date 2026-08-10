-- 补录：这条迁移线上已经跑过（20260810062841 / 0040_expose_counterpart_email），当时没落成文件。
-- 此文件由 supabase_migrations.schema_migrations.statements 逐字 dump，不是事后重写的。

-- 0038 给表加了 counterpart_email，忘了追加到读面 —— 前端一查就 400。
-- create or replace 只能在末尾追加列，前面的列名/顺序一个都没动。
create or replace view public.v_pa_pursuit_messages as
  select id, pursuit_id, role, kind, content, meta, created_at,
         gmail_message_id, body_raw, contact_id, counterpart_email
    from producer.pursuit_messages;
grant select on public.v_pa_pursuit_messages to anon, authenticated, service_role;
