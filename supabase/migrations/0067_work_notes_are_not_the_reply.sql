-- 把 8 条回复里的「工作稿」从正文挪进 meta。
--
-- 病根在 brain 的 think()：它把一次「想」里**每一轮**的 text 块无差别攒起来 join。
-- 可 maxTurns 是 20 配着联网工具，中间那些轮次产出的不是回答，是工作稿——
-- "I'll start by loading the web tools."、"Let me fetch it."、还有整段整段的
-- 英文中间报告。它们全被拼进了落库的回复，于是 ①界面上是一大坨不该给她看的英文
-- ②这坨东西还每轮都被重新塞进 prompt（UCSB 那条一条就 31,925 字符）。
--
-- 代码那边已经治了（brain/reply.js 的 foldReply：动工具之前说的话都是工作稿）。
-- 这道迁移治的是治好之前落下的那 8 条 —— 156 条 producer 消息里就这 8 条。
--
-- 切法：每条给一个**锚点**，就是回答的第一行。锚点之前是工作稿，之后是回答。
-- 锚点是人眼一条一条核对出来的，并且都验证过在正文里**只出现一次**。
-- 切这一刀的是 Postgres 自己，在库里那份原文上切——不是拿一份副本去覆盖，
-- 所以不存在「我这边的拷贝跟库里差一个字符」这种事。
--
-- 原文整条进 meta.raw，一个字都没销毁。切错了一句 SQL 还原：
--   update producer.pursuit_messages
--      set content = meta->>'raw', meta = meta - 'raw' - 'notes' - 'repaired'
--    where meta ? 'raw';
--
-- 工作稿为什么不删：里面是真查到的东西（URL、原文、核实记录），只是不该摆在
-- 她眼前，也不该每轮重付一遍。跟 0031 那条「记号不能拼进 content」同一个道理。

begin;

-- ON::View 驻留 · brief · 1310 → 回答约 1275 字符
update producer.pursuit_messages
   set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
                'raw',      content,
                'notes',    btrim(left(content, position('**ON::View / ARTS Southeast（Savannah, GA）— 讲懂**' in content) - 1)),
                'repaired', '2026-08-15'
              ),
       content = btrim(substr(content, position('**ON::View / ARTS Southeast（Savannah, GA）— 讲懂**' in content)))
 where id = '15a4c01c-ca96-4b9c-a7e6-016e00ccfb95'::uuid
   and meta->>'raw' is null                        -- 跑第二遍不会再切一刀
   and position('**ON::View / ARTS Southeast（Savannah, GA）— 讲懂**' in content) > 1;           -- 锚点找不到就整条跳过，不乱动

-- ASU · Design, Environment and the Arts PhD · · message · 11785 → 回答约 946 字符
update producer.pursuit_messages
   set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
                'raw',      content,
                'notes',    btrim(left(content, position('查回来了，有一条我得先纠正自己——这是我第二次说重话了，所以这次把证据强度也一起给你。' in content) - 1)),
                'repaired', '2026-08-15'
              ),
       content = btrim(substr(content, position('查回来了，有一条我得先纠正自己——这是我第二次说重话了，所以这次把证据强度也一起给你。' in content)))
 where id = '2afd00e0-f92c-46a5-9e9f-3a418b3f4a1c'::uuid
   and meta->>'raw' is null                        -- 跑第二遍不会再切一刀
   and position('查回来了，有一条我得先纠正自己——这是我第二次说重话了，所以这次把证据强度也一起给你。' in content) > 1;           -- 锚点找不到就整条跳过，不乱动

-- UCSB · Media Arts and Technology PhD · 2027  · message · 31925 → 回答约 4227 字符
update producer.pursuit_messages
   set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
                'raw',      content,
                'notes',    btrim(left(content, position('我把两个人都挖了一遍，先说一件会改这条线性质的事——**我自己打开页面核实过，不是转述。**' in content) - 1)),
                'repaired', '2026-08-15'
              ),
       content = btrim(substr(content, position('我把两个人都挖了一遍，先说一件会改这条线性质的事——**我自己打开页面核实过，不是转述。**' in content)))
 where id = 'd72a5b4e-3f4a-4c73-8f40-77d39c82eca0'::uuid
   and meta->>'raw' is null                        -- 跑第二遍不会再切一刀
   and position('我把两个人都挖了一遍，先说一件会改这条线性质的事——**我自己打开页面核实过，不是转述。**' in content) > 1;           -- 锚点找不到就整条跳过，不乱动

-- 教学提案 · BAVC Media · brief · 1527 → 回答约 1470 字符
update producer.pursuit_messages
   set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
                'raw',      content,
                'notes',    btrim(left(content, position('核实完了，跟卡上判断一致，但多挖出两件有用的事和一个需要你确认的坑。' in content) - 1)),
                'repaired', '2026-08-15'
              ),
       content = btrim(substr(content, position('核实完了，跟卡上判断一致，但多挖出两件有用的事和一个需要你确认的坑。' in content)))
 where id = 'd8cbe63b-929d-4da1-864a-5931d3c12b65'::uuid
   and meta->>'raw' is null                        -- 跑第二遍不会再切一刀
   and position('核实完了，跟卡上判断一致，但多挖出两件有用的事和一个需要你确认的坑。' in content) > 1;           -- 锚点找不到就整条跳过，不乱动

-- 冷邮件 · Chinese Culture Center of SF · brief · 1647 → 回答约 1511 字符
update producer.pursuit_messages
   set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
                'raw',      content,
                'notes',    btrim(left(content, position('查完了，结论跟卡上写的不一样，先说这个。' in content) - 1)),
                'repaired', '2026-08-15'
              ),
       content = btrim(substr(content, position('查完了，结论跟卡上写的不一样，先说这个。' in content)))
 where id = '0a0745fc-1146-4c46-b030-af7cd5288bf7'::uuid
   and meta->>'raw' is null                        -- 跑第二遍不会再切一刀
   and position('查完了，结论跟卡上写的不一样，先说这个。' in content) > 1;           -- 锚点找不到就整条跳过，不乱动

-- Artist talk / 单次工作坊 · CalArts（用现有关系） · brief · 1898 → 回答约 1782 字符
update producer.pursuit_messages
   set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
                'raw',      content,
                'notes',    btrim(left(content, position('**CalArts artist talk / 单次工作坊 — 讲懂了**' in content) - 1)),
                'repaired', '2026-08-15'
              ),
       content = btrim(substr(content, position('**CalArts artist talk / 单次工作坊 — 讲懂了**' in content)))
 where id = '3e3fad26-7b8e-4c6f-9d84-672b62246cbb'::uuid
   and meta->>'raw' is null                        -- 跑第二遍不会再切一刀
   and position('**CalArts artist talk / 单次工作坊 — 讲懂了**' in content) > 1;           -- 锚点找不到就整条跳过，不乱动

-- 冷邮件 · CODAME ART+TECH · brief · 1559 → 回答约 1270 字符
update producer.pursuit_messages
   set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
                'raw',      content,
                'notes',    btrim(left(content, position('查完了，卡上的判断得推翻一半。' in content) - 1)),
                'repaired', '2026-08-15'
              ),
       content = btrim(substr(content, position('查完了，卡上的判断得推翻一半。' in content)))
 where id = 'e4e27f22-6755-4823-a777-679cdf916c2f'::uuid
   and meta->>'raw' is null                        -- 跑第二遍不会再切一刀
   and position('查完了，卡上的判断得推翻一半。' in content) > 1;           -- 锚点找不到就整条跳过，不乱动

-- 驻留 · FCCW（Feminist Center for Creative Work） · brief · 1533 → 回答约 1485 字符
update producer.pursuit_messages
   set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
                'raw',      content,
                'notes',    btrim(left(content, position('查清楚了，这张卡上的判断有一处要改。' in content) - 1)),
                'repaired', '2026-08-15'
              ),
       content = btrim(substr(content, position('查清楚了，这张卡上的判断有一处要改。' in content)))
 where id = '3f2dbde8-983b-4f78-8292-53062ece3dd9'::uuid
   and meta->>'raw' is null                        -- 跑第二遍不会再切一刀
   and position('查清楚了，这张卡上的判断有一处要改。' in content) > 1;           -- 锚点找不到就整条跳过，不乱动

-- ── 对账 ────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from producer.pursuit_messages
   where meta->>'repaired' = '2026-08-15';
  if n <> 8 then
    raise exception '该修 8 条，实际 % 条 —— 有锚点没对上，整道回滚', n;
  end if;

  -- 一个字都没丢：新正文必须是原文的一段，且原文必须更长。
  select count(*) into n from producer.pursuit_messages
   where meta->>'repaired' = '2026-08-15'
     and not (position(content in meta->>'raw') > 0
              and length(meta->>'raw') > length(content));
  if n <> 0 then
    raise exception '% 条的新正文不是原文的子串，说明切坏了', n;
  end if;

  -- 正文不该再以工作稿开头。
  select count(*) into n from producer.pursuit_messages
   where meta->>'repaired' = '2026-08-15'
     and content ~ '^(I''ll |Let me |Now |Found |Excellent|I have enough)';
  if n <> 0 then
    raise exception '还有 % 条正文以工作稿开头', n;
  end if;
end $$;

commit;
