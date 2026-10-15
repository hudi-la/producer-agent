-- 0162 · 线上每人连自己的 Gmail(2026-10-06,设计稿 docs/specs/2026-10-06-hosted-gmail-design.md)
--
-- 托管版第一期邮件不开(0150 的 D9),缺的是三件事:令牌按人、回调走公网、收信循环按人。
-- 这支管库这一层:
--
--   一、member_settings 多两列:gmail_address、gmail_refresh_token。
--       跟模型 key 同一张表——本来就是「每人一份的凭据」,本来就不进备份包(0157)。
--   二、两支读函数带上它们:pa_member_secrets 给脑子全串;pa_member_settings 只说连没连、连的哪个。
--   三、pa_set_gmail(地址, 钥匙):连上 / 断开都走它。传空 = 断开。
--       连上顺手把 modules.mail 拨成 true,断开拨成 false——「连上 = 邮件开」,不让人先拨开关再去连。
--   四、pa_mail_due_all():脑子找活,谁连了 Gmail 且邮件开着。definer、只读、只授 service_role,
--       跟 0155 那两个同一个规矩(brain/local/privileges.test.js 白名单)。
--
-- 断开**不删**已经收进库的信——那是他的记录(绝不丢信息)。

alter table producer.member_settings add column if not exists gmail_address       text;
alter table producer.member_settings add column if not exists gmail_refresh_token text;

comment on column producer.member_settings.gmail_address       is '连上的 Gmail 地址(小写)。空 = 没连';
comment on column producer.member_settings.gmail_refresh_token is 'Google 给的长期钥匙,只给脑子(pa_member_secrets);页面永不回显';

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
    'gmail_address',     s.gmail_address,
    'gmail_connected',   s.gmail_refresh_token is not null,
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
    'provider',            s.provider,
    'api_key',             s.api_key,
    'oauth_token',         s.oauth_token,
    'openai_key',          s.openai_key,
    'gemini_key',          s.gemini_key,
    'model',               s.model,
    'model_cheap',         s.model_cheap,
    'lang',                s.lang,
    'judgments_enabled',   s.judgments_enabled,
    'modules',             s.modules,
    'mcp_token',           s.mcp_token,
    'onboarded',           s.onboarded,
    'gmail_address',       s.gmail_address,
    'gmail_refresh_token', s.gmail_refresh_token,
    'updated_at',          s.updated_at
  )
    from producer.member_settings s
   where s.owner = auth.uid()
$$;

create or replace function public.pa_set_gmail(p_address text, p_refresh_token text)
returns jsonb
language plpgsql
security invoker
set search_path = public, producer
as $$
declare
  a text := nullif(lower(btrim(coalesce(p_address, ''))), '');
  k text := nullif(btrim(coalesce(p_refresh_token, '')), '');
  on_ boolean;
begin
  if (a is null) <> (k is null) then raise exception '地址和钥匙要么都给(连上),要么都空(断开)'; end if;
  on_ := k is not null;

  insert into producer.member_settings default values
  on conflict (owner) do nothing;

  update producer.member_settings s
     set gmail_address       = a,
         gmail_refresh_token = k,
         modules             = coalesce(s.modules, '{}'::jsonb) || jsonb_build_object('mail', on_),
         updated_at          = now()
   where s.owner = auth.uid();

  return public.pa_member_settings();
end
$$;

create or replace function public.pa_mail_due_all()
returns table (owner uuid)
language sql
security definer
set search_path = producer, public
as $$
  select s.owner
    from producer.member_settings s
   where s.owner is not null
     and s.gmail_refresh_token is not null
     and coalesce(s.modules->>'mail', 'false') = 'true'
   order by s.owner;
$$;

comment on function public.pa_set_gmail(text, text) is '连上(地址+钥匙)/ 断开(都空)自己的 Gmail;顺手拨 modules.mail。invoker,只动自己那一行';
comment on function public.pa_mail_due_all() is '脑子找活:谁连了 Gmail 且邮件开着 (owner)。security definer,只授 service_role,只读。拿到 owner 后在那个人的身份下收信。';

revoke all on function public.pa_member_settings(), public.pa_member_secrets(), public.pa_set_gmail(text, text) from public, anon;
grant execute on function public.pa_member_settings(), public.pa_member_secrets(), public.pa_set_gmail(text, text) to authenticated, service_role;

revoke all on function public.pa_mail_due_all() from public, anon, authenticated;
grant execute on function public.pa_mail_due_all() to service_role;
