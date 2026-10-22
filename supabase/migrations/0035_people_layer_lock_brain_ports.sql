-- Producer Agent — 补锁：Fairwind 那三个写口不该对浏览器开着
--
-- 0034 犯的错：**Postgres 建函数时默认把 EXECUTE 给 PUBLIC**。
-- 只写 `grant execute ... to service_role` 不会把默认那份收回来，
-- 于是三个本该只给 brain 的口，anon（浏览器里那把 key）也调得动：
--
--   · pa_add_contact_email          —— 能伪造邮件记录，带任意 gmail_message_id
--   · pa_upsert_contact_deliverable —— 能凭空往库里塞草稿
--   · pa_touch_contact_thread       —— 能乱盖同步时间戳
--
-- 0027 那批（pa_add_email / pa_upsert_deliverable / pa_touch_thread / pa_link_thread）
-- 全都写了 revoke，一个没漏。是这一刀把那条线破了，不是原来就松。
--
-- 教训写在这儿：**新加 security definer 函数，先 revoke 再 grant，两句一起写。**
-- 只写 grant 等于什么都没锁——而且不报错，查 proacl 也看不出来（默认那份是隐式的），
-- 只有 has_function_privilege('anon', …) 问得出真话。

revoke all on function public.pa_add_contact_email(uuid, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.pa_add_contact_email(uuid, text, text, text, text, jsonb, timestamptz)
  to service_role;

revoke all on function public.pa_upsert_contact_deliverable(uuid, uuid, text, text, text, jsonb, text, date, jsonb, int)
  from public, anon, authenticated;
grant execute on function public.pa_upsert_contact_deliverable(uuid, uuid, text, text, text, jsonb, text, date, jsonb, int)
  to service_role;

revoke all on function public.pa_touch_contact_thread(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.pa_touch_contact_thread(uuid, text, text)
  to service_role;

-- 下面这几个是**你自己的动作**，走浏览器直连 anon，本来就该开着——
-- 跟 0009 里 pa_set_stage / pa_set_ball 一个道理。列在这儿是为了说清
-- 「哪些开着是故意的」，免得下次有人看到 anon 能调就以为又漏了：
--   · pa_upsert_contact        改自己的名片
--   · pa_add_contact_message   你说的话 / 你记的一笔
--   · pa_claim_contact_thread  你认领一条往来
--   · pa_contact_checkin       你打卡「聊过了」
--   · pa_mark_intro_thanked    你回谢了介绍人
