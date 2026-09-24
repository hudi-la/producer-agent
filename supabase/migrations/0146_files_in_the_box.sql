-- Producer Agent — 盒子里能放文件了
--
-- 盒子(producer.works.box)一直是 jsonb,值全是文本(为什么是现在 / 隐线 / 备注……)。
-- 「丢进材料」在页面上一直是一行死文字。现在文件本体进 storage(本机模式 = <数据目录>/files/),
-- 清单记在 box.files:[{name, key, size, type, at}]。这支给一个能写 jsonb 值的口——
-- pa_set_entry_box 只收文本,列表塞进去会变成一串字。
create or replace function public.pa_set_entry_box_json(
  p_id    uuid,
  p_key   text,
  p_value jsonb
)
returns void
language plpgsql
security definer
set search_path = public, producer
as $$
declare k text;
begin
  if p_id is null then raise exception '要改哪一条？没给 id'; end if;
  k := btrim(coalesce(p_key, ''));
  if k = '' then raise exception '盒子里这一格得有个名字'; end if;
  update producer.works
     set box = case when p_value is null or p_value = 'null'::jsonb
                    then coalesce(box, '{}'::jsonb) - k
                    else coalesce(box, '{}'::jsonb) || jsonb_build_object(k, p_value) end
   where id = p_id;
  if not found then raise exception '库里没有这条（id=%）', p_id; end if;
end
$$;
revoke all on function public.pa_set_entry_box_json(uuid, text, jsonb) from public;
grant execute on function public.pa_set_entry_box_json(uuid, text, jsonb) to anon, authenticated, service_role;
