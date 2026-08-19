-- Producer Agent — 摘要不是原文
--
-- 病：对话里的信框，有的写着中文梗概、**而且没有「展开原文」**，
--     有的写着英文原文、有「展开原文」。同一个框两种行为，从外面看不出为什么。
--
-- 病根：库里有两种信。
--   · `body_raw` = Gmail 取回来的原文
--   · `content`  = 有时候是人写的中文摘要
--   21 封老信**只有摘要，body_raw 是空的**。而框里写的是
--   `body_raw || content` —— 于是摘要直接顶上来冒充原文，
--   又因为它没有更长的原文可展开，「展开原文」那个按钮也不出现。
--
-- 药，两条：
--
--   一、**把原文取回来。** 那 21 封在 Gmail 里全都还在（逐封核过），
--       messages.get(format=full) 取正文回填。现在全库 805 封信每一封都有原文。
--
--   二、**以后再有，框上说出来。** 前端：没有 body_raw 就打一个
--       「摘要 · 原文没存下来」的标，绝不让摘要冒充原文。
--       （见 src/components/PursuitFocus.jsx 的 Letter）
--
-- 这两支函数留着，以后再发现缺原文的，从它们走。

create or replace function public.pa_letters_missing_body()
returns jsonb
language sql security definer set search_path = public, producer as $$
  select coalesce(jsonb_agg(m.gmail_message_id), '[]'::jsonb)
    from producer.pursuit_messages m
   where m.kind='email' and m.deleted_at is null and m.body_raw is null
     and m.gmail_message_id is not null
$$;

create or replace function public.pa_fill_body(p_gmail_message_id text, p_body text)
returns boolean
language plpgsql security definer set search_path = public, producer as $$
begin
  -- 空正文不写：宁可这一封继续标着「原文没存下来」，
  -- 也不要拿一个空字符串把「有原文」这件事装出来。
  if coalesce(btrim(p_body), '') = '' then return false; end if;
  update producer.pursuit_messages
     set body_raw = p_body
   where gmail_message_id = p_gmail_message_id and body_raw is null;
  return found;
end $$;

grant execute on function public.pa_letters_missing_body() to service_role;
grant execute on function public.pa_fill_body(text, text) to service_role;
