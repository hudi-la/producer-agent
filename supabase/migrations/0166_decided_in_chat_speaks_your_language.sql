-- 0166 · 「聊天里定的：…」这个前缀按人的语言写(2026-10-08)
--
-- 聊天里拨了提醒,pa_apply_state_move 记一笔「聊天里定的：<那一行>」,时间线和卡上原样显示。
-- 前缀写死成中文,英文学员看到的是半句中文。现在看这个人 member_settings.lang:en 就写「Decided in chat: 」。
-- 那一行本身(moveLine)由脑子按语言写(brain/stateMove.js)。别的逐字照抄线上现在的定义。
-- invoker + RLS:member_settings 只看得见自己那一行,所以 limit 1 就是「我」的语言。

create or replace function public.pa_apply_state_move(p_kind text, p_subject uuid, p_move text, p_why text, p_line text, p_awaiting text DEFAULT NULL::text, p_due date DEFAULT NULL::date, p_meet_at text DEFAULT NULL::text, p_needs_reply boolean DEFAULT NULL::boolean, p_reply_why text DEFAULT NULL::text, p_src_msg uuid DEFAULT NULL::uuid, p_text text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'producer'
AS $function$
declare
  v_note     uuid;
  v_today    date := producer.today_local();
  v_days     int;
  v_awaiting text;
  v_resolves boolean := null;
  v_res_why  text := null;
  v_needs    boolean := null;
  v_rwhy     text := null;
  v_meet     text := null;
  v_what     text;
  v_kind     text := 'decision';
begin
  if p_kind not in ('pursuit', 'contact') then raise exception 'p_kind 只认 pursuit|contact'; end if;
  if p_move not in ('resolved','wait','reschedule','park','needs_reply','meeting','met','done') then
    raise exception '不认识的拨法：%', p_move;
  end if;
  if coalesce(btrim(p_why), '') = '' then raise exception '拨提醒得说凭什么（why 是空的）'; end if;
  if coalesce(btrim(p_line), '') = '' then raise exception '小卡那行字是空的'; end if;
  if p_kind = 'pursuit' and not exists (select 1 from producer.pursuits where id = p_subject) then
    raise exception '没有这条线：%', p_subject;
  end if;
  if p_kind = 'contact' and not exists (select 1 from producer.contacts where id = p_subject) then
    raise exception '没有这个人：%', p_subject;
  end if;

  if p_move in ('wait', 'reschedule', 'park') then
    if p_due is null then raise exception '% 得有到点日', p_move; end if;
    v_days := p_due - v_today;
    if v_days <= 0 then raise exception '到点日（%）得在今天（%）之后', p_due, v_today; end if;
  end if;

  case p_move
    when 'resolved' then
      v_resolves := true; v_res_why := btrim(p_why);
      if p_needs_reply then
        if coalesce(btrim(p_reply_why), '') = '' then raise exception '「要回」得说凭什么'; end if;
        v_needs := true; v_rwhy := btrim(p_reply_why);
      end if;
    when 'wait' then
      if coalesce(btrim(p_awaiting), '') = '' then raise exception 'wait 得说在等什么'; end if;
      v_resolves := true; v_res_why := btrim(p_why); v_awaiting := btrim(p_awaiting);
    when 'reschedule' then
      select s.what into v_what from public.v_pa_state s
       where s.subject_kind = p_kind and s.subject_id = p_subject and s.state = 'WAITING_REPLY';
      if v_what is null then raise exception '没有在等的事可改期'; end if;
      v_resolves := true; v_res_why := btrim(p_why); v_awaiting := v_what;
    when 'park' then
      v_resolves := true; v_res_why := btrim(p_why); v_awaiting := '先放着：' || btrim(p_why);
    when 'needs_reply' then
      if coalesce(btrim(p_reply_why), '') = '' then raise exception 'needs_reply 得说凭什么'; end if;
      v_needs := true; v_rwhy := btrim(p_reply_why);
    when 'meeting' then
      if coalesce(btrim(p_meet_at), '') = '' then raise exception 'meeting 得有时间'; end if;
      v_meet := p_meet_at;
    when 'met' then
      -- 见成了：是一条 meet 笔（0097 的两支 —— 48 小时信、回谢介绍人 —— 从它长出来）
      v_kind := 'meet'; v_resolves := true; v_res_why := btrim(p_why);
    when 'done' then
      v_resolves := true; v_res_why := btrim(p_why);
  end case;

  insert into producer.pursuit_messages (pursuit_id, contact_id, role, kind, content, meta)
  values (case when p_kind = 'pursuit' then p_subject end,
          case when p_kind = 'contact' then p_subject end,
          'note', v_kind,
          coalesce(nullif(btrim(p_text), ''), (case when (select s.lang from producer.member_settings s limit 1) = 'en' then 'Decided in chat: ' else '聊天里定的：' end) || btrim(p_line)),
          jsonb_build_object('state_move', jsonb_build_object(
            'move', p_move, 'why', btrim(p_why), 'line', btrim(p_line),
            'src_msg', p_src_msg)))
  returning id into v_note;

  -- 人身上的 meet 笔要把「上次碰」记成今天（跟 pa_add_contact_message 的 meet 一样）
  if p_kind = 'contact' and v_kind = 'meet' then
    update producer.contacts set last_touch_at = producer.today_local(), last_touch_src = 'meet'
     where id = p_subject;
  end if;

  perform public.pa_tag_message(
    v_note, (case when (select s.lang from producer.member_settings s limit 1) = 'en' then 'Decided in chat: ' else '聊天里定的：' end) || p_move,
    v_resolves, v_res_why, v_needs, v_rwhy,
    v_awaiting, case when v_awaiting is not null then v_days end,
    v_meet, btrim(p_line), 'fairwind-chat');

  if p_src_msg is not null then
    update producer.pursuit_messages
       set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{state_move}',
                    coalesce(meta->'state_move', '{}'::jsonb)
                    || jsonb_build_object('applied', true, 'note_id', v_note))
     where id = p_src_msg;
  end if;

  return v_note;
end $function$;
