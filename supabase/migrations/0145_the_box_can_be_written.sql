-- 2026-09-25 学员版:这支跟作者分支上的 0129_the_box_can_be_written 内容一样(pa_set_entry_box),
-- 编号按这条线往后排。以后合并时两支都留着也没事:create or replace 跑两遍等于一遍。
-- 盒子终于能在页面上补了。
--
-- 病：档案页上那行「+ 补一条 / 丢进材料」是一个没有任何点击处理的 <div>——
-- 一行死文字，从头到尾就没能用过。而盒子里已经有的那些（guardrail、
-- proven_first_email、two_lists…）在页面上也只是摆着的纯文字，改不了。
--
-- 也就是说：**盒子只能开 SQL 写。** 而盒子恰恰是最该随手补的东西——
-- 它是「网站装不下」的那一层，是他判断怎么开口、写「为什么是我」时的弹药
-- （brain/prompt.js 的 entriesBlock 把它整段喂给 Fairwind）。
--
-- 0065 那支 pa_set_entry 只认 meta，碰不到 box。这儿单开一支，规矩跟它一样：
--
--   **合并，不替换。** 只补「为什么是现在」不该把「隐线」一起抹掉。
--   代价是删不掉键，只能把值设成空 —— 而空值界面上本来就不显示
--   （Library 的 boxEntries 会滤掉），所以看得见的效果就是没了。
--
-- 给 anon：这是他自己的手，跟 pa_set_entry / pa_add_entry 一路。

create or replace function public.pa_set_entry_box(
  p_id    uuid,
  p_key   text,
  p_value text
)
returns void
language plpgsql
security definer
set search_path = public, producer
as $$
declare k text;
begin
  if p_id is null then
    raise exception '要补哪一条？没给 id';
  end if;

  k := btrim(coalesce(p_key, ''));
  if k = '' then
    raise exception '这一条得有个名字（为什么是现在 / 想触达 / 隐线 / 材料 / 备注……）';
  end if;

  update producer.works
     set box = coalesce(box, '{}'::jsonb) || jsonb_build_object(k, coalesce(p_value, ''))
   where id = p_id;

  if not found then raise exception '库里没有这条（id=%）', p_id; end if;
end
$$;

revoke all on function public.pa_set_entry_box(uuid, text, text) from public;
grant execute on function public.pa_set_entry_box(uuid, text, text) to anon, authenticated, service_role;
