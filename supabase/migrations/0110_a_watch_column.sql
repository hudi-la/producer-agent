-- Producer Agent — 「持续关注」：可能以后有用的，放最后一列
--
-- 他要的（2026-08-20）：看板最后加一列，放「可能在之后有用的东西」。
-- 放进去的卡**之后再考虑如何行为** —— 这一刀只开列，不定行为：
-- 它的信照常归它（attribute 的线名单里有它），state 照常算（不像
-- paused 那样静音）。等他用出感觉，再定要不要静音、要不要定期回访。

create or replace function public.pa_set_stage(p_pursuit_id uuid, p_stage text)
returns void
language plpgsql security definer set search_path to 'public', 'producer'
as $function$
begin
  if p_stage not in ('pending','matching','writing','sent','replying','won','paused','watch') then
    raise exception 'bad stage: %', p_stage;
  end if;
  update producer.pursuits set stage = p_stage, stage_at = now() where id = p_pursuit_id;
  if not found then
    raise exception 'no pursuit: %', p_pursuit_id;
  end if;
end;
$function$;

-- ── 0110 补（同一天，他抓的）：加列没扫全 ──────────────────────
-- 「持续关注」当时只加进了 Pipeline 的 STAGES，卡抽屉顶上那个下拉
-- （PursuitFocus 的 STAGE_ORDER/STAGE_LABELS）、brain 的 cast.js LIVE
-- 名单、pa_subjects_for_rejudge 的栏名 CASE 全漏了。教训还是那条：
-- **改判据先扫再改** —— stage 名单在五处，不是一处。
-- （pa_subjects_for_rejudge 的修正直接在库上做了，全文见函数本体；
--   nextAction 的「交出去了」和 Pipeline 的「该有动静的」是**有意**
--   不含 watch 的，注释写在各自代码里。）
