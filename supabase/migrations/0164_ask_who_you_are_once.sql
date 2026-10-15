-- 0164 · 「只看自己的行」每次查询只问一次你是谁(2026-10-07)
--
-- ── 病 ─────────────────────────────────────────────────────────
--
-- 他的 🔔 在线上一直说「连上了但查询报错」。不是没提醒:v_pa_state 以他的身份
-- 要跑 9.8 秒,authenticated 的 statement_timeout 是 8 秒,被掐了。
-- 同一张视图在个人版(没有 RLS)跑 3 秒。
--
-- 0137 / 0150 / 0151 的 own_rows 写的是 `owner = auth.uid()`。auth.uid() 不是常量,
-- 规划器在每一行上各调一次;v_pa_state 里那几层 lateral 把行数翻了好几倍,
-- 每行都去解一遍 JWT。Supabase 官方的写法是 `owner = (select auth.uid())`——
-- 包成子查询,一次查询只算一次(initPlan)。
--
-- ── 刀法 ───────────────────────────────────────────────────────
--
-- producer 里**今天挂着 own_rows 的每张表**,按目录循环,删了照原样重建,只换这一处。
-- 谁能看哪几行一点不变:同一个 owner,同一个 auth.uid(),只是少算几百万次。
-- owner 的索引 0137 已经建了,这里不再动。

do $$
declare t record;
begin
  for t in select tablename from pg_policies
            where schemaname = 'producer' and policyname = 'own_rows'
  loop
    execute format('drop policy own_rows on producer.%I', t.tablename);
    execute format('create policy own_rows on producer.%I for all to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()))', t.tablename);
  end loop;
end $$;
