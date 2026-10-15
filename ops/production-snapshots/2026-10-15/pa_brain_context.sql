CREATE OR REPLACE FUNCTION public.pa_brain_context(p_pursuit_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'public', 'producer'
AS $function$
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
      from producer.pursuit_messages m
      where m.deleted_at is null
        and exists (select 1 from producer.pursuits p where p.id = p_pursuit_id)
        and (m.pursuit_id = p_pursuit_id or exists (
          select 1 from public.v_pa_pursuit_mail v
          where v.pursuit_id = p_pursuit_id and v.on_this_line
            and v.kind = 'email' and v.id = m.id
        ))
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
    'voice', (select to_jsonb(v) from producer.voice v limit 1),
    'profile', (select to_jsonb(pr) from producer.profile pr limit 1)
  );
$function$
