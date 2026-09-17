-- Producer Agent — 看板不再搬运两段长文
--
-- 实测（2026-08-21）：看板一次下载 161,277 字节，其中 `why`（匹配理由）和
-- `notes`（关系记忆）两段长文占了一半——而**看板的卡片一个字都不显示它们**，
-- 全前端只有 PursuitFocus 那一处用到（已 grep 全仓核实）。
-- 72 张卡每次都把两段长文搬一遍，只为了你可能点开其中一张。
--
-- 为什么不直接从 v_pa_pursuits 里删这两列：v_pa_cue_facts 依赖它，
-- 而 v_pa_cue_facts 上面还压着 v_pa_state 那一串。为砍两列去级联重建
-- 状态机的视图，不划算也不安全。所以另开一个卡片视图，原视图一个字不动。
--
-- 列名从库里现读，不手打：手打的列清单迟早跟视图分叉，而分叉的症状是
-- 「后来加的字段在看板上不出现」。以后给 v_pa_pursuits 加了列，
-- 重跑一次 producer.wire_card_view() 就对上了。

create or replace function producer.wire_card_view()
returns text
language plpgsql
as $$
declare cols text; n int;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position), count(*)
    into cols, n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'v_pa_pursuits'
     and column_name not in ('why', 'notes');

  if cols is null then raise exception 'v_pa_pursuits 不在，卡片视图没法建'; end if;

  -- drop 而不是 create or replace：列数变了的话 replace 会报错
  drop view if exists public.v_pa_pursuit_cards;
  execute format('create view public.v_pa_pursuit_cards as select %s from public.v_pa_pursuits', cols);
  execute 'grant select on public.v_pa_pursuit_cards to anon, authenticated, service_role';

  return format('卡片视图 %s 列（原视图去掉 why / notes 两列长文）', n);
end
$$;

select producer.wire_card_view();

-- 看板订阅的是卡片视图。它跟 v_pa_pursuits 落在同一批真实表上，
-- 所以「表 → 区」的推导结果不变；登记它只是让注册表反映前端真正在读什么。
insert into producer.pulse_areas (area, view_name)
values ('board', 'public.v_pa_pursuit_cards')
on conflict do nothing;

select producer.pulse_wire();
