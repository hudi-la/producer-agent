-- 0159 · 改自己那一行的语句都写明 where owner = auth.uid()(2026-10-03,公司的库上第一次写设置就撞上)
--
-- 真 Supabase 的 API 连接(authenticator 角色)挂着 safeupdate:没有 WHERE 的 UPDATE / DELETE 一律拒绝,
-- 报「UPDATE requires a WHERE clause」。0140 起有几支函数是「不带 where,invoker + RLS 本身就把更新
-- 限定在你那一行」写的——PGlite 没有 safeupdate,全绿;真库上一调就炸。
--
-- 这五支全部补上 where owner = auth.uid():意思一个字没变(RLS 之下本来就只有这一行),
-- 只是把「谁的行」说出来。以后改自己那一行的 pa_*,一律这么写。
--
--   pa_set_profile、pa_set_voice(0140)
--   pa_set_member_settings、pa_rotate_mcp_token(0150)
--   pa_backup_import 的 wipe 分支(0157)

create or replace function public.pa_set_profile(p_name text default null, p_website text default null, p_data jsonb default null)
returns void
language plpgsql
security invoker
set search_path = public, producer
as $$
begin
  update producer.profile
     set name       = coalesce(nullif(btrim(p_name), ''), name),
         website    = coalesce(nullif(btrim(p_website), ''), website),
         data       = case when p_data is null then data
                           else coalesce(data, '{}'::jsonb) || p_data end,
         updated_at = now()
   where owner = auth.uid();
  if not found then raise exception '库里没有 profile'; end if;
end
$$;

create or replace function public.pa_set_voice(p_agent_name text default null, p_persona text default null, p_letter_rule text default null, p_form_rule text default null, p_judge_rule text default null)
returns void
language plpgsql
security invoker
set search_path = public, producer
as $$
begin
  update producer.voice
     set agent_name  = case when p_agent_name  is null then agent_name  else nullif(btrim(p_agent_name),  '') end,
         persona     = case when p_persona     is null then persona     else nullif(btrim(p_persona),     '') end,
         letter_rule = case when p_letter_rule is null then letter_rule else nullif(btrim(p_letter_rule), '') end,
         form_rule   = case when p_form_rule   is null then form_rule   else nullif(btrim(p_form_rule),   '') end,
         judge_rule  = case when p_judge_rule  is null then judge_rule  else nullif(btrim(p_judge_rule),  '') end,
         updated_at  = now()
   where owner = auth.uid();
end
$$;

create or replace function public.pa_set_member_settings(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, producer
as $$
begin
  p := coalesce(p, '{}'::jsonb);
  if jsonb_typeof(p) <> 'object' then raise exception '设置得是一个对象'; end if;

  -- 没行就先落一行(owner 走列默认值;没登录时 owner 为空,主键当场拦下)
  insert into producer.member_settings default values
  on conflict (owner) do nothing;

  update producer.member_settings s
     set provider          = case when p ? 'provider'    then coalesce(nullif(btrim(p->>'provider'), ''), 'claude-key') else s.provider end,
         api_key           = case when p ? 'api_key'     then nullif(btrim(p->>'api_key'), '')     else s.api_key     end,
         oauth_token       = case when p ? 'oauth_token' then nullif(btrim(p->>'oauth_token'), '') else s.oauth_token end,
         openai_key        = case when p ? 'openai_key'  then nullif(btrim(p->>'openai_key'), '')  else s.openai_key  end,
         gemini_key        = case when p ? 'gemini_key'  then nullif(btrim(p->>'gemini_key'), '')  else s.gemini_key  end,
         model             = case when p ? 'model'       then nullif(btrim(p->>'model'), '')       else s.model       end,
         model_cheap       = case when p ? 'model_cheap' then nullif(btrim(p->>'model_cheap'), '') else s.model_cheap end,
         lang              = case when p ? 'lang'        then coalesce(nullif(btrim(p->>'lang'), ''), 'zh') else s.lang end,
         judgments_enabled = case when p ? 'judgments_enabled' and jsonb_typeof(p->'judgments_enabled') = 'boolean'
                                  then (p->>'judgments_enabled')::boolean else s.judgments_enabled end,
         modules           = case when p ? 'modules' and jsonb_typeof(p->'modules') = 'object'
                                  then p->'modules' else s.modules end,
         updated_at        = now()
   where s.owner = auth.uid();

  return public.pa_member_settings();
end
$$;

create or replace function public.pa_rotate_mcp_token()
returns text
language plpgsql
security invoker
set search_path = public, producer
as $$
declare t text;
begin
  insert into producer.member_settings default values
  on conflict (owner) do nothing;
  update producer.member_settings s
     set mcp_token = producer.new_mcp_token(), updated_at = now()
   where s.owner = auth.uid()
  returning s.mcp_token into t;
  return t;
end
$$;

create or replace function public.pa_backup_import(p jsonb, p_wipe boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = public, producer
as $$
declare
  order_ text[];
  t text;
  cols text;
  ctes text[] := '{}';
  outs text[] := '{}';
  counts jsonb := '{}'::jsonb;
  wiped  jsonb := '{}'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception '备份内容不是一个对象'; end if;
  order_ := producer.backup_table_order();

  if p_wipe then
    foreach t in array order_ loop
      ctes := ctes || format('d_%s as (delete from producer.%I where owner = auth.uid() returning 1)', t, t);
      outs := outs || format('%L, (select count(*) from d_%s)', t, t);
    end loop;
    execute format('with %s select jsonb_build_object(%s)', array_to_string(ctes, ', '), array_to_string(outs, ', ')) into wiped;
    ctes := '{}'; outs := '{}';
  end if;

  foreach t in array order_ loop
    if not (p ? t) or jsonb_typeof(p -> t) <> 'array' or jsonb_array_length(p -> t) = 0 then continue; end if;
    -- 列清单 = 表上的列 ∩ 备份行里出现过的键,去掉 owner(让默认值盖)
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
      from pg_attribute a
     where a.attrelid = format('producer.%I', t)::regclass
       and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attname <> 'owner'
       and a.attname in (select distinct k from jsonb_array_elements(p -> t) r(value), jsonb_object_keys(r.value) k);
    if cols is null then continue; end if;
    ctes := ctes || format('i_%s as (insert into producer.%I (%s) select %s from jsonb_populate_recordset(null::producer.%I, $1 -> %L) on conflict do nothing returning 1)', t, t, cols, cols, t, t);
    outs := outs || format('%L, (select count(*) from i_%s)', t, t);
  end loop;
  if cardinality(ctes) > 0 then
    execute format('with %s select jsonb_build_object(%s)', array_to_string(ctes, ', '), array_to_string(outs, ', ')) into counts using p;
  end if;

  return jsonb_build_object('tables', counts, 'wiped', wiped);
end
$$;

-- 授权原样(0137 的规矩:invoker,不给 anon)
revoke all on function public.pa_set_profile(text, text, jsonb), public.pa_set_voice(text, text, text, text, text),
               public.pa_set_member_settings(jsonb), public.pa_rotate_mcp_token(), public.pa_backup_import(jsonb, boolean) from public, anon;
grant execute on function public.pa_set_profile(text, text, jsonb), public.pa_set_voice(text, text, text, text, text),
                          public.pa_set_member_settings(jsonb), public.pa_rotate_mcp_token(), public.pa_backup_import(jsonb, boolean) to authenticated, service_role;
