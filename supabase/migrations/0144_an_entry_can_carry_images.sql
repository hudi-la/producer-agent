-- Producer Agent — 给一条档案挂图片和网站路径
--
-- 2026-09-24，workshop-edition。works.images / site_path 两列一直只有种子在写，没有函数入口。
-- MCP 那扇门（Claude Code 读学员的网站往档案里填）要能把作品图的链接一起带进来。
-- 0137 之后重定义 pa_* 的迁移不得写 security definer——这支是 invoker，行级权限照管。

create or replace function public.pa_set_entry_images(p_id uuid, p_images text[] default null, p_site_path text default null)
returns void
language plpgsql
security invoker
set search_path = public, producer
as $$
begin
  update producer.works
     set images    = coalesce(p_images, images),
         site_path = coalesce(p_site_path, site_path),
         updated_at = now()
   where id = p_id;
  if not found then
    raise exception '库里没有这条（id=%）', p_id;
  end if;
end
$$;

revoke all on function public.pa_set_entry_images(uuid, text[], text) from public, anon;
grant execute on function public.pa_set_entry_images(uuid, text[], text) to authenticated, service_role;
