-- Producer Agent — 把 meta / tags 补进 Fairwind 的上下文
--
-- 病：履历那些「一条」的关键事实——学校名、机构、起止年份、地点、个展还是群展——
--     全都存在 works.meta 这个 jsonb 里，不是表上的列。界面读 meta（subInfo()），
--     所以「我的档案」里看得见；但 pa_brain_context 是一个字段一个字段点名要的，
--     meta 不在名单上，于是脑子那边整段履历只剩标题：
--
--       - [education] MFA · Art Program
--       - [credit] The Garden of Digital Delights
--
--     42 条 credit/education/job 的机构、年份、地点、类型，一个字都没进 prompt。
--     Fairwind 于是如实汇报「你档案里教育那栏空得有点厉害」——它没撒谎，它真看不见。
--
-- 药：名单上加 meta 和 tags。渲染在 brain/server.js 的 entriesBlock()。
--
-- 注意：create or replace 必须整段重写，不能只写差异——漏掉 security definer
-- 或 set search_path 会悄悄改掉权限模型，且不报错。下面是 0009 的原文 + 那一行。
-- 要回滚：把 0009_brain_rpc.sql 里的 pa_brain_context 重跑一遍。

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

-- 签名没变，Postgres 的 create or replace 会保留原有 ACL。这里重复一遍是零成本的保险：
-- 万一哪次签名真的动了，权限不会悄悄敞开。
revoke all on function public.pa_brain_context(uuid) from public, anon, authenticated;
grant execute on function public.pa_brain_context(uuid) to service_role;
