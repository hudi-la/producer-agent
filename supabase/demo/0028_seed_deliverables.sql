-- ⚠️ 示范内容，不是系统的一部分。整个 demo/ 装的是一位艺术家的公开作品集，
--    fork 下来请换成你自己的 —— 见 demo/README.md。
--
-- 下面这行是护栏（migration 0059）。这个库里要是真人的数据，整支在这里中止，
-- 一行都不会删。种子必须整支跑在一个事务里，护栏才拦得住后面的 truncate。
select producer.demo_guard();

-- 把两条真实的线上「要交出去的东西」立项。
--
-- 内容不是新编的：CultureHub 那段 88 词的项目陈述，是库里 2026-08-04 那条
-- kind='draft' 的消息原文搬过来的；挡住的理由是 8/5 那段对话谈出来的结论。
-- 这一支只做「立项」——把已经存在于对话里的东西，摆到它该待的位置上。
--
-- 按标题查 id，不写死 uuid（重跑安全：已存在同名产出就跳过）。

-- ══ Solitude：申请材料，现在全挡在「靶子朝谁」上 ══════════════
do $$
declare pid uuid; ref uuid; idea uuid;
begin
  select id into pid from producer.pursuits
   where title like 'Web Residency No.22%' limit 1;
  if pid is null then raise notice 'Solitude 那条线没找到，跳过'; return; end if;

  -- 挡住的理由要点得回中栏那句话：Fairwind 8/5 那条「靶子朝谁」
  select id into ref from producer.pursuit_messages
   where pursuit_id = pid and content like '%靶子朝谁%'
   order by created_at desc limit 1;

  -- ① 作品构想。它不是从档案里挑一件，是在这条线上长出来的一件新东西。
  select id into idea from producer.deliverables
   where pursuit_id = pid and title = '作品构想 · ECR 线上版';
  if idea is null then
    idea := (public.pa_upsert_deliverable(
      p_pursuit_id := pid, p_kind := 'idea', p_title := '作品构想 · ECR 线上版',
      p_source     := '源头是档案里的 Echo Chamber Realms',
      p_blocked_by := '还差最后一刀：靶子朝谁。朝木偶 = 一个设计得很好的互动功能；朝平台 = 一件真的动了手的作品。这两版没有一个字是共用的。',
      p_blocked_ref := ref, p_created_by := 'rule'
    )->>'id')::uuid;
  end if;

  -- ② 概念文本 1000–1500 字符，等 ① 定稿
  if not exists (select 1 from producer.deliverables where pursuit_id = pid and title = '概念文本') then
    perform public.pa_upsert_deliverable(
      p_pursuit_id := pid, p_kind := 'concept', p_title := '概念文本',
      p_rules := '{"chars":[1000,1500]}'::jsonb, p_depends_on := idea,
      p_due := date '2026-08-07', p_created_by := 'rule');
  end if;

  -- ③ 呈现形式说明 500 字符，等 ① 定稿
  if not exists (select 1 from producer.deliverables where pursuit_id = pid and title = '呈现形式说明') then
    perform public.pa_upsert_deliverable(
      p_pursuit_id := pid, p_kind := 'concept', p_title := '呈现形式说明',
      p_rules := '{"chars":[0,500]}'::jsonb, p_depends_on := idea,
      p_due := date '2026-08-07', p_created_by := 'rule');
  end if;

  -- ④ Bio 400 字符。正文空着——档案里那份英文 bio 得你自己确认了再往里放，
  --    我不替你写一版占位（写了你也得推翻）。
  if not exists (select 1 from producer.deliverables where pursuit_id = pid and title = 'Bio') then
    perform public.pa_upsert_deliverable(
      p_pursuit_id := pid, p_kind := 'bio', p_title := 'Bio',
      p_rules := '{"chars":[0,400]}'::jsonb, p_source := '我的档案',
      p_due := date '2026-08-07', p_created_by := 'rule');
  end if;

  -- ⑤ 作品集 PDF：规则层能数的东西（页数、大小）填在 meta 里，前端实时算
  if not exists (select 1 from producer.deliverables where pursuit_id = pid and title = '作品集 PDF') then
    perform public.pa_upsert_deliverable(
      p_pursuit_id := pid, p_kind := 'file', p_title := '作品集 PDF',
      p_rules := '{"pages":10,"mb":10}'::jsonb,
      p_due := date '2026-08-07', p_created_by := 'rule');
  end if;
end $$;

-- ══ CultureHub：谈成了，但两件事挂着 ═══════════════════════════
do $$
declare pid uuid; src uuid; txt text;
begin
  select id into pid from producer.pursuits where title like 'CultureHub%' limit 1;
  if pid is null then raise notice 'CultureHub 那条线没找到，跳过'; return; end if;

  -- ① 第一人称项目陈述：正文取自库里 8/4 那条 kind='draft' 的原文
  select id into src from producer.pursuit_messages
   where pursuit_id = pid and kind = 'draft' order by created_at desc limit 1;
  select substring(content from '"(Echo Chamber Realms II.*?)"') into txt
    from producer.pursuit_messages where id = src;

  if not exists (select 1 from producer.deliverables where pursuit_id = pid and title = '第一人称项目陈述') then
    perform public.pa_upsert_deliverable(
      p_pursuit_id := pid, p_kind := 'statement', p_title := '第一人称项目陈述',
      p_body := txt, p_rules := '{"words":[50,100]}'::jsonb,
      p_due := date '2026-08-11', p_source := '骨架取自申请稿，Fairwind 8/4 起草',
      p_source_msg := src, p_created_by := 'fairwind');
  end if;

  -- ② 营销素材 6 样。清单是 Mattie 8/3 那封信里原样列的。
  if not exists (select 1 from producer.deliverables where pursuit_id = pid and title = '营销素材 6 样') then
    perform public.pa_upsert_deliverable(
      p_pursuit_id := pid, p_kind := 'form', p_title := '营销素材 6 样',
      p_rules := '{"items":["公开用名","第三人称 bio 50–100 词","第一人称项目陈述 50–100 词","相关链接","3:2 头像 + 摄影署名","图片 alt 文本"]}'::jsonb,
      p_meta  := '{"done":["公开用名","第三人称 bio 50–100 词","相关链接"],"form_url":"https://docs.google.com/forms/d/18d_zmkt9ZTcYHBt8j148ts4HMIL_UPL1jpHaSbuc9lw/viewform"}'::jsonb,
      p_due := date '2026-08-11', p_source := 'Mattie 8/3 那封信', p_created_by := 'rule');
  end if;

  -- ③ 催 LOA。正文空着——要不要催、怎么措辞，是 8/7 那天的事。
  if not exists (select 1 from producer.deliverables where pursuit_id = pid and title = '催 Mattie · LOA 还没回') then
    perform public.pa_upsert_deliverable(
      p_pursuit_id := pid, p_kind := 'email', p_title := '催 Mattie · LOA 还没回',
      p_due := date '2026-08-07', p_source := '8/4 那封发出去还没回',
      p_created_by := 'rule');
  end if;

  -- ④ W-9 + Zelle：卡在合同上，明说卡在哪
  if not exists (select 1 from producer.deliverables where pursuit_id = pid and title = 'W-9 + Zelle') then
    perform public.pa_upsert_deliverable(
      p_pursuit_id := pid, p_kind := 'file', p_title := 'W-9 + Zelle',
      p_blocked_by := '合同第二节写的截止是 8 月 3 日——不管年份是 2025 还是 2026，字面上都已经过期了。等 Mattie 确认日期再签回传。',
      p_created_by := 'rule');
  end if;
end $$;
