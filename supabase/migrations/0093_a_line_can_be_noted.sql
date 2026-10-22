-- Producer Agent — 机会线也能「记一笔」
--
-- 病：联系人卡片有「记一笔」（pa_add_contact_message），机会线卡片没有
--     —— 只有 jot 那个卡上便签，不进时间线。于是电话里说定的事、交出去的
--     表单，系统永远不知道，「这条线在等什么」就关不掉。
--
-- 药：跟人卡同一个形状的 RPC。NOTE 是转移表里的一个 event（设计稿第二节），
--     线上没入口，表就缺一列。
--
-- 设计稿：docs/specs/2026-08-19-what-this-line-is-waiting-on-design.md

create or replace function public.pa_add_pursuit_note(
  p_pursuit_id uuid, p_text text, p_kind text default 'note'
) returns producer.pursuit_messages
language plpgsql security definer set search_path = public as $fn$
declare r producer.pursuit_messages;
begin
  if coalesce(btrim(p_text), '') = '' then
    raise exception '空的笔不记 —— 一个说不出内容的日期正是「上次碰」原来那么难用的原因';
  end if;
  if p_kind not in ('note', 'meet', 'decision') then
    raise exception '记一笔只认 note|meet|decision，收到 %', p_kind;
  end if;
  if not exists (select 1 from producer.pursuits where id = p_pursuit_id) then
    raise exception '没有这条线：%', p_pursuit_id;
  end if;

  insert into producer.pursuit_messages (pursuit_id, role, kind, content)
  values (p_pursuit_id, 'note', p_kind, btrim(p_text))
  returning * into r;

  -- 「碰」不用在这儿写：v_pa_cue_facts 的 jot 那一支本来就数线上的
  -- note/meet/decision（0079），所以这一笔落库的瞬间线就「脏」了，
  -- 下一轮 judgePass 自然重判。算出来的，不是存的。
  -- （pa_recompute_touch 对 pursuit 是刻意的 no-op —— 别调，调了是装样子。）
  return r;
end $fn$;

revoke all on function public.pa_add_pursuit_note(uuid, text, text) from public;
grant execute on function public.pa_add_pursuit_note(uuid, text, text)
  to anon, authenticated, service_role;
