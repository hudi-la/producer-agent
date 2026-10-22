-- 卡上带文件：PDF / MD / Excel / 任何东西。
--
-- 0027 就建好了 producer.attachments（filename / mime / bytes / storage_key），
-- 注释写着「Supabase Storage；先可空」。一直空到现在：0 行、一个桶都没有，
-- 所以左栏那格「附件」永远不显示，就算显示也点不开。这道迁移把它接上。
--
-- 分两层，对应两种「拿到文件」的方式：
--   ① 你 —— 浏览器直传直下。走 anon，跟 pa_set_stage / pa_set_jot 同一套：
--      传文件是你在整理自己的卡，跟脑子开没开没关系，不该经过 sidecar。
--   ② Fairwind —— 它拿 service_role 从桶里读字节。**它没有写口**：
--      这道迁移里给它的只有「读上下文时看得见文件清单」，
--      往桶里写、往表里插一行的函数都只 grant 给 anon，它调不到。
--
-- 桶是私有的。前端拿签名 URL 打开，链接几十秒就过期——
-- 公开桶意味着谁猜中路径谁就能下你的合同。

-- ══ 一、桶 ══════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit)
values ('pursuit-files', 'pursuit-files', false, 52428800)   -- 50MB/份
on conflict (id) do nothing;

-- storage.objects 上的策略。范围写死在 bucket_id 上——
-- 别的桶（以后可能有）不在这条策略的射程里。
do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'pa_files_read') then
    create policy pa_files_read on storage.objects
      for select to anon, authenticated using (bucket_id = 'pursuit-files');
  end if;
  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'pa_files_write') then
    create policy pa_files_write on storage.objects
      for insert to anon, authenticated with check (bucket_id = 'pursuit-files');
  end if;
  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects'
                   and policyname = 'pa_files_drop') then
    create policy pa_files_drop on storage.objects
      for delete to anon, authenticated using (bucket_id = 'pursuit-files');
  end if;
end $$;

-- ══ 二、表：补一列「谁放进来的」════════════════════════════════
-- from_msg 只说得出「从某封信来」，说不出「你自己传的」和「不知道哪来的」的区别。
-- 一列一个意思（0019 那条教训）：来路是来路，挂在哪封信上是另一回事。
alter table producer.attachments
  add column if not exists source text not null default 'upload';   -- upload | mail

comment on column producer.attachments.source      is '这份文件怎么进来的：upload 你传的 / mail 邮件附件落地';
comment on column producer.attachments.storage_key is 'pursuit-files 桶里的路径。为空 = 只有登记没有字节（不该出现）';

-- ══ 三、你的手（anon）══════════════════════════════════════════
-- 先传字节拿到 key，再登记这一行。顺序反过来的话，登记成功但上传失败，
-- 卡上会出现一个点不开的鬼文件。
create or replace function public.pa_add_attachment(
  p_pursuit_id  uuid,
  p_filename    text,
  p_storage_key text,
  p_mime        text default null,
  p_bytes       bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'producer'
as $function$
declare row producer.attachments;
begin
  if p_filename is null or btrim(p_filename) = '' then raise exception '要有文件名'; end if;
  if p_storage_key is null or btrim(p_storage_key) = '' then raise exception '要有 storage_key'; end if;
  insert into producer.attachments (pursuit_id, filename, mime, bytes, storage_key, source)
  values (p_pursuit_id, btrim(p_filename), p_mime, p_bytes, p_storage_key, 'upload')
  returning * into row;
  return to_jsonb(row);
end;
$function$;

-- 删：先把 storage_key 交回给调用方，让它去桶里删字节，再删这一行。
-- 反过来做的话，行没了就再也不知道该删哪个对象，桶里留一具无名尸。
create or replace function public.pa_delete_attachment(p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'producer'
as $function$
declare k text;
begin
  delete from producer.attachments where id = p_id returning storage_key into k;
  if not found then raise exception '没有这份附件：%', p_id; end if;
  return k;
end;
$function$;

revoke all on function public.pa_add_attachment(uuid, text, text, text, bigint) from public;
revoke all on function public.pa_delete_attachment(uuid) from public;
grant execute on function public.pa_add_attachment(uuid, text, text, text, bigint) to anon, authenticated, service_role;
grant execute on function public.pa_delete_attachment(uuid) to anon, authenticated, service_role;

-- 读面补上新列。必须先 drop：create or replace view 只能改表达式，
-- 不能往中间插一列（会报「cannot change name of view column」）。
drop view if exists public.v_pa_attachments;
create view public.v_pa_attachments as
  select id, pursuit_id, filename, mime, bytes, storage_key, source, from_msg, created_at
    from producer.attachments;

grant select on public.v_pa_attachments to anon, authenticated, service_role;

-- ══ 四、Fairwind 的上下文里加一份文件清单 ══════════════════════
-- 只给清单（名字/类型/多大/哪来的），**不给内容**。
-- 内容要它自己按需去开（brain 里的 open_file 工具），理由：
-- 把每条线的每份文件都塞进上下文，既贵又吵，而且大部分时候用不上。
--
-- 照 0025 / 0027 的规矩：create or replace 必须整段重写——
-- 漏掉 security definer 或 search_path 会悄悄改掉权限模型且不报错。
create or replace function public.pa_brain_context(p_pursuit_id uuid)
returns jsonb
language sql
security definer
set search_path = public, producer
as $$
  select jsonb_build_object(
    'pursuit', (
      select to_jsonb(x) from (
        select p.*, w.title as work_title
        from producer.pursuits p
        left join producer.works w on w.id = p.work_id
        where p.id = p_pursuit_id
      ) x
    ),
    'messages', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created_at)
      from producer.pursuit_messages m where m.pursuit_id = p_pursuit_id
    ), '[]'::jsonb),
    'deliverables', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.sort, d.created_at)
      from producer.deliverables d where d.pursuit_id = p_pursuit_id
    ), '[]'::jsonb),
    'threads', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at)
      from producer.pursuit_threads t where t.pursuit_id = p_pursuit_id
    ), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'filename', a.filename, 'mime', a.mime,
        'bytes', a.bytes, 'storage_key', a.storage_key,
        'source', a.source, 'created_at', a.created_at
      ) order by a.created_at)
      from producer.attachments a where a.pursuit_id = p_pursuit_id
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'title', e.title, 'body', e.body, 'concern', e.concern,
        'year', e.year, 'medium', e.medium, 'site_path', e.site_path, 'box', e.box,
        'meta', e.meta, 'tags', e.tags
      ) order by e.kind, e.sort)
      from producer.works e
    ), '[]'::jsonb),
    'profile', (select to_jsonb(pr) from producer.profile pr limit 1)
  );
$$;

revoke all on function public.pa_brain_context(uuid) from public, anon, authenticated;
grant execute on function public.pa_brain_context(uuid) to service_role;
