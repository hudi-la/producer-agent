-- 0161 · 进门第一页(orientation)走没走过(2026-10-03)
--
-- 托管版登录后先过一页:选语言(按浏览器猜,母语最快)、选模型来源填 key。可以跳过,跳过也算走过,
-- 之后在设置里补。走没走过记在 member_settings.onboarded;两支读函数带上它,写函数认这个键。
-- 顺手:两支读函数补 where s.owner = auth.uid()(跟 0159 一个道理,把「谁的行」说出来)。
alter table producer.member_settings add column if not exists onboarded boolean not null default false;

create or replace function public.pa_member_settings()
returns jsonb
language sql
stable
security invoker
set search_path = public, producer
as $$
  select jsonb_build_object(
    'provider',          s.provider,
    'api_key_set',       s.api_key     is not null,
    'api_key_hint',      coalesce(right(s.api_key, 6), ''),
    'oauth_token_set',   s.oauth_token is not null,
    'oauth_token_hint',  coalesce(right(s.oauth_token, 6), ''),
    'openai_key_set',    s.openai_key  is not null,
    'openai_key_hint',   coalesce(right(s.openai_key, 6), ''),
    'gemini_key_set',    s.gemini_key  is not null,
    'gemini_key_hint',   coalesce(right(s.gemini_key, 6), ''),
    'model',             s.model,
    'model_cheap',       s.model_cheap,
    'lang',              s.lang,
    'judgments_enabled', s.judgments_enabled,
    'modules',           s.modules,
    'mcp_token',         s.mcp_token,
    'onboarded',         s.onboarded,
    'updated_at',        s.updated_at
  )
    from producer.member_settings s
   where s.owner = auth.uid()
$$;
create or replace function public.pa_member_secrets()
returns jsonb
language sql
stable
security invoker
set search_path = public, producer
as $$
  select jsonb_build_object(
    'provider',          s.provider,
    'api_key',           s.api_key,
    'oauth_token',       s.oauth_token,
    'openai_key',        s.openai_key,
    'gemini_key',        s.gemini_key,
    'model',             s.model,
    'model_cheap',       s.model_cheap,
    'lang',              s.lang,
    'judgments_enabled', s.judgments_enabled,
    'modules',           s.modules,
    'mcp_token',         s.mcp_token,
    'onboarded',         s.onboarded,
    'updated_at',        s.updated_at
  )
    from producer.member_settings s
   where s.owner = auth.uid()
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
         lang              = case when p ? 'lang'        then coalesce(nullif(btrim(p->>'lang'), ''), 'en') else s.lang end,
         judgments_enabled = case when p ? 'judgments_enabled' and jsonb_typeof(p->'judgments_enabled') = 'boolean'
                                  then (p->>'judgments_enabled')::boolean else s.judgments_enabled end,
         modules           = case when p ? 'modules' and jsonb_typeof(p->'modules') = 'object'
                                  then p->'modules' else s.modules end,
         onboarded         = case when p ? 'onboarded' and jsonb_typeof(p->'onboarded') = 'boolean'
                                  then (p->>'onboarded')::boolean else s.onboarded end,
         updated_at        = now()
   where s.owner = auth.uid();

  return public.pa_member_settings();
end
$$;


revoke all on function public.pa_member_settings(), public.pa_member_secrets(), public.pa_set_member_settings(jsonb) from public, anon;
grant execute on function public.pa_member_settings(), public.pa_member_secrets(), public.pa_set_member_settings(jsonb) to authenticated, service_role;
