-- 档案里的条目：在页面上改。
--
-- 在这之前 v_pa_entries 只 grant 了 select —— 那 60 条作品/履历是只读的，
-- 想改一个作品的描述就得开 SQL。而这些条目是 Fairwind 判断匹配、写「为什么是我」、
-- 填申请字段的全部弹药：改不动，等于每次改一个字都要绕一趟数据库。
--
-- 照 0025 的规矩：create or replace 必须整段重写，漏掉 security definer
-- 或 search_path 会悄悄改掉权限模型且不报错。
--
-- ── 空值语义：跟 pa_set_profile **故意不一样** ──────────────────────
--   pa_set_profile：空字符串 = 不动（名字、网址清空了没有意义）
--   这一支：        null = 不动，空字符串 = 清空
--
-- 为什么要不一样：描述写错了想删掉是正常需求。如果沿用 profile 那套，
-- 「清空」就永远做不到，只能塞一个空格进去装作空的。
--
-- 于是 coalesce 在这儿正好是对的：coalesce(null, body) 留旧值，
-- coalesce('', body) 得到 ''，就是清空。不用额外分支。
--
-- ── 标题为什么不许清空 ────────────────────────────────────────────
-- title 是表上的 not null，更要紧的是：档案页的列表按标题认条目。
-- 一条没名字的作品在页面上是一行空白 —— 它没消失，但你再也点不到它。
-- 这属于「信息还在但看不见」，所以在这儿直接拒绝，让界面把话说给人听，
-- 而不是静悄悄忽略（静悄悄忽略的话，人会以为存上了）。

create or replace function public.pa_set_entry(
  p_id     uuid,
  p_title  text  default null,
  p_body   text  default null,
  p_medium text  default null,
  p_year   text  default null,
  p_meta   jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, producer
as $$
begin
  if p_id is null then
    raise exception '要改哪一条？没给 id';
  end if;

  -- 传了标题但传的是空 —— 拦在这儿，别让它变成一行点不到的空白
  if p_title is not null and btrim(p_title) = '' then
    raise exception '条目得有名字，标题不能清空';
  end if;

  update producer.works
     set title  = coalesce(nullif(btrim(p_title), ''), title),
         body   = coalesce(p_body, body),
         medium = coalesce(p_medium, medium),
         year   = coalesce(p_year, year),
         -- meta 是合并不是替换：只改「机构」不该把「年份」「地点」一起抹掉。
         -- 代价是删不掉键，只能把值设成空——而空值在界面上本来就不显示
         -- （src/data/schema.js 的 subInfo 会把空的滤掉），所以看得见的效果就是没了。
         meta   = case when p_meta is null then meta
                       else coalesce(meta, '{}'::jsonb) || p_meta end
   where id = p_id;

  -- updated_at 不用手动动：0001 那支的 works_touch 触发器管着。

  if not found then raise exception '库里没有这条（id=%）', p_id; end if;
end
$$;

revoke all on function public.pa_set_entry(uuid, text, text, text, text, jsonb) from public;
grant execute on function public.pa_set_entry(uuid, text, text, text, text, jsonb) to anon, authenticated, service_role;
