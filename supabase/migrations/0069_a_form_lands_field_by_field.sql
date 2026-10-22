-- 「一张申请表进产出，一格一个闸」。
--
-- ══ 为什么必须逐格 ════════════════════════════════════════════
-- 申请表的实质就是「Artist statement: max 300 words」「Project description:
-- 1000–1500 characters」这种**逐格上限**。rules.js 早就会数这些（前端实时算，
-- 不花模型），缺的只是把闸拆到每一格上。
--
-- 整份产出一条闸接不住它：八格加起来没超，不等于每一格都没超；而网页表单
-- 是**逐格拒收**的。合成一条闸的下场是——你到提交前一刻才发现第三格多了
-- 40 个词，而那时候申请页面已经打开了。
--
-- ══ 为什么一张表是一份产出，不是八份 ══════════════════════════
-- 右栏那条规矩是「右边全是没定的，左边全是定了的，中间只有一个动作——定稿」。
-- 一张申请表是**一件事**：拆成八份就要定稿八次、左栏文件里散成八份，
-- 而且「这张表填完了没有」没有任何一处回答得了。
--
-- ══ 表结构一个字没改 ══════════════════════════════════════════
-- 规则（机构要什么）进 rules.fields，答案（你填了什么）进 meta.answers。
-- 这跟这张表上已有的两对是同一条分界线：
--   rules.items  ↔ meta.done      清单：要哪几样 / 备齐了哪几样
--   rules.pages  ↔ meta.pages     文件：限几页 / 实际几页
-- 所以不需要新列，也不需要新表。
--
-- ══ 一格的身份是题目，不是它排第几 ════════════════════════════
-- answers 按 key 存，key 由题目算出来（brain/form.js 的 fieldKey）。
-- 拿下标当 key 的话，Fairwind 重写一版时中间多插一道题，后面所有答案
-- 整体错位一格——而错位之后每一格看起来都「有内容」，你不逐条读完
-- 发现不了。这是「信息还在但看不见」的一种，比丢了更难查。
--
-- 照 0025 的规矩：create or replace 必须整段重写，漏掉 security definer
-- 或 search_path 会悄悄改掉权限模型且不报错。

-- ── 一、把对话里那张表收进产出 ────────────────────────────────
-- 跟 0068 收信同一个路子：形式判断归模型（这是一张填好的表），
-- 意图判断归你（这张要留下）。这支函数就是你点的那一下。
create or replace function public.pa_adopt_form(
  p_pursuit_id uuid  default null,
  p_contact_id uuid  default null,
  p_title      text  default '未命名表单',
  p_fields     jsonb default '[]'::jsonb,   -- [{key,q,words|chars,a}]
  p_meta       jsonb default '{}'::jsonb
) returns producer.deliverables
language plpgsql
security definer
set search_path = public, producer
as $$
declare
  r producer.deliverables;
  existing uuid;
  v_rules jsonb;
  v_answers jsonb;
begin
  -- 0033 给 deliverables 立的所有者约束：要么挂线，要么挂人。先在这儿拦一道，
  -- 好让报错说人话——交给表约束的话你看到的是 deliverables_owner_chk 违反。
  if (p_pursuit_id is null) = (p_contact_id is null) then
    raise exception '要么挂在一条机会线上，要么挂在一个人身上，不能都给也不能都不给';
  end if;

  if jsonb_typeof(p_fields) is distinct from 'array' or jsonb_array_length(p_fields) = 0 then
    raise exception '一格都没有的表收进来是一张点了没反应的卡';
  end if;

  -- 规则和答案在这儿分家：rules 留题目和闸，meta.answers 留答案本身。
  select
    jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'key', f->>'key', 'q', f->>'q', 'words', f->'words', 'chars', f->'chars'))),
    jsonb_object_agg(f->>'key', coalesce(f->>'a', ''))
    into v_rules, v_answers
    from jsonb_array_elements(p_fields) f
   where coalesce(btrim(f->>'key'), '') <> '' and coalesce(btrim(f->>'q'), '') <> '';

  if v_rules is null then
    raise exception '这些格子一个都没有题目，认不出是一张表';
  end if;

  -- 同一个所有者、同一个表名 → 覆盖那一份，不堆第二份。
  -- 理由跟 0066（重说）一样：草稿的「最新一版」只有一个。
  -- 按标题认，是因为一条线上可能同时有两张表（申请表 + 预算表）。
  select id into existing
    from producer.deliverables
   where kind = 'form' and status = 'draft' and title = p_title
     and pursuit_id is not distinct from p_pursuit_id
     and contact_id is not distinct from p_contact_id
   order by created_at desc
   limit 1;

  if existing is null then
    insert into producer.deliverables
      (pursuit_id, contact_id, kind, title, body, rules, meta, created_by, status)
    values (p_pursuit_id, p_contact_id, 'form', p_title, null,
            jsonb_build_object('fields', v_rules),
            coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('answers', v_answers),
            'fairwind', 'draft')
    returning * into r;
  else
    -- **你写了字的格子优先。**
    --
    -- 这是这支函数里最要紧的一句。你在右栏把某一格改好了，然后回中栏
    -- 让 Fairwind 重写一版、再收一次——如果新的一版直接盖掉，你刚才那
    -- 二十分钟就没了，而且**没有任何提示**。所以合并的方向是：
    -- 新答案只填你还空着的格子，你已经写了字的格子一个都不动。
    --
    -- ── 为什么要把空串挑掉，不能直接 v_answers || 旧的 ──────────
    -- jsonb 的 || 是「右边赢」，而**被你清空过的格子在旧的里面是一个
    -- 值为空串的键**——它照样赢。于是那一格会永远空着：Fairwind 重写
    -- 多少版都填不进来，而界面上它跟「还没写」长得一模一样，你只会
    -- 觉得这个功能时灵时不灵。（写这支函数时就是这么错的，测出来的。）
    update producer.deliverables
       set rules = jsonb_build_object('fields', v_rules),
           meta  = coalesce(meta, '{}'::jsonb) || coalesce(p_meta, '{}'::jsonb)
                     || jsonb_build_object('answers',
                          v_answers || coalesce(
                            (select jsonb_object_agg(k, v)
                               from jsonb_each_text(coalesce(meta->'answers', '{}'::jsonb)) e(k, v)
                              where btrim(v) <> ''), '{}'::jsonb))
     where id = existing
    returning * into r;
  end if;

  return r;
end $$;

-- 这是**你的手**（点「收进产出」），所以给 anon。不给的话就得绕一趟 brain，
-- 而脑子没开的时候你连收都收不了——跟 0068 同一条理由。
revoke all on function public.pa_adopt_form(uuid, uuid, text, jsonb, jsonb) from public;
grant execute on function public.pa_adopt_form(uuid, uuid, text, jsonb, jsonb)
  to anon, authenticated, service_role;

comment on function public.pa_adopt_form(uuid, uuid, text, jsonb, jsonb) is
  '把对话里那张填好的表收成一份 kind=form 的产出。规则进 rules.fields、答案进 meta.answers；同名的表覆盖，但你已经改过的格子不动。';

-- ── 二、你在页面上改某一格 ────────────────────────────────────
-- pa_edit_deliverable 只改 title/body，接不住 meta.answers。
--
-- 为什么是「一格一支」而不是整包写回：右栏是自动存的（停手 700ms 写一次）。
-- 整包写回的话，你在第三格打字那一刻会把第五格的内容也写一遍——而第五格
-- 可能正是另一次自动存刚写进去的新值，于是它被一份旧快照盖掉。
-- 只写一格就没有这个窗口。
create or replace function public.pa_set_answer(
  p_id uuid, p_key text, p_text text
)
returns void
language plpgsql
security definer
set search_path = public, producer
as $$
declare st text;
begin
  if coalesce(btrim(p_key), '') = '' then
    raise exception '改哪一格？没给 key';
  end if;

  select status into st from producer.deliverables where id = p_id;
  if not found then raise exception 'no deliverable: %', p_id; end if;
  -- 跟 pa_edit_deliverable 一样：定稿的改不动，要先取消定稿。
  if st = 'final' then raise exception '已定稿，先取消定稿再改'; end if;

  update producer.deliverables
     -- 空串是**清空这一格**，不是「不动」。写错了想删掉是正常需求，
     -- 沿用 profile 那套「空 = 不动」的话，清空就永远做不到（见 0065）。
     set meta = coalesce(meta, '{}'::jsonb)
                || jsonb_build_object('answers',
                     coalesce(meta->'answers', '{}'::jsonb)
                       || jsonb_build_object(p_key, coalesce(p_text, '')))
   where id = p_id;
end $$;

revoke all on function public.pa_set_answer(uuid, text, text) from public;
grant execute on function public.pa_set_answer(uuid, text, text)
  to anon, authenticated, service_role;

comment on function public.pa_set_answer(uuid, text, text) is
  '改申请表里的一格。一格一支，不整包写回——右栏是自动存的，整包写会让你在这一格打字时用旧快照盖掉另一格。';
