-- Producer Agent — 每人的设置进库(托管版 D6 / D13)
--
-- 2026-10-02,托管的 Fairwind。一个脑子伺候所有人之后,「用哪家模型、哪把 key、
-- 什么语言、开了哪些模块、MCP 令牌是哪串」不能再住在进程的 env 里——它们是
-- **每个人一份**的。这支建 producer.member_settings:一人一行,owner 就是主键。
--
-- ── key 怎么出门 ──────────────────────────────────────────────
-- 设置页不该再看见整把 key(设计稿 D6):pa_member_settings 只回显末 6 位 + 一个
-- 「设了没」的布尔。脑子替这个人调模型时要全串,走 pa_member_secrets——它也是
-- invoker,行级权限只给本人那一行,所以「全串」仍然只有自己(和替自己干活的脑子)拿得到。
--
-- ── mcp_token 的随机源 ────────────────────────────────────────
-- 云端有 pgcrypto,gen_random_bytes(24) 是正经的 CSPRNG;PGlite 没有这个扩展。
-- producer.new_mcp_token() 先试 gen_random_bytes,没有就退到 md5(random()||clock_timestamp())
-- 拼成同样 48 位十六进制。本机版的令牌只在回环上用,退路够用;线上拿到的永远是前者。
--
-- ── 函数体里不写 auth.uid() ────────────────────────────────────
-- 跟 0140 的 pa_set_profile 一个规矩:invoker + RLS 本身就把读写限定在「你的那一行」,
-- owner 由列默认值盖上。「什么算你的行」只在表的 policy 上定义一次,函数不再抄一遍。
-- (顺带:PGlite 的前言没给 authenticated 开 auth schema 的门,函数体里直呼 auth.uid()
-- 在本机会报 permission denied;表的 policy / 列默认值是预先解析好的,不受影响。)
--
-- 0137 之后重定义 pa_* 的迁移不得写 security definer——这支全是 invoker;anon 一律不授。
-- handle_new_user 是触发器,照旧 definer(它得越过 RLS 替新账号落户)。

-- 一、令牌
create or replace function producer.new_mcp_token()
returns text
language plpgsql
volatile
set search_path = producer, public, extensions
as $$
begin
  begin
    return encode(gen_random_bytes(24), 'hex');
  exception when undefined_function then
    return left(md5(random()::text || clock_timestamp()::text) || md5(clock_timestamp()::text || random()::text), 48);
  end;
end
$$;

-- 二、表
create table if not exists producer.member_settings (
  owner             uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  provider          text not null default 'claude-key',
  api_key           text,
  oauth_token       text,
  openai_key        text,
  gemini_key        text,
  model             text,
  model_cheap       text,
  lang              text not null default 'zh',
  judgments_enabled boolean not null default true,
  modules           jsonb not null default '{"profile":true,"pursuits":true,"mail":false}'::jsonb,
  mcp_token         text not null default producer.new_mcp_token(),
  updated_at        timestamptz not null default now()
);

alter table producer.member_settings enable row level security;
drop policy if exists own_rows on producer.member_settings;
create policy own_rows on producer.member_settings
  for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

revoke all on producer.member_settings from public, anon;
grant select, insert, update, delete on producer.member_settings to authenticated, service_role;

-- 已经住进来的账号补一行(新账号由 handle_new_user 建)
insert into producer.member_settings (owner)
select id from auth.users
on conflict (owner) do nothing;

-- 三、遮罩版:设置页读这个
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
    'updated_at',        s.updated_at
  )
    from producer.member_settings s
   limit 1
$$;
revoke all on function public.pa_member_settings() from public, anon;
grant execute on function public.pa_member_settings() to authenticated, service_role;

-- 四、全串:脑子替这个人调模型时读。RLS 只给本人那一行。
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
    'updated_at',        s.updated_at
  )
    from producer.member_settings s
   limit 1
$$;
revoke all on function public.pa_member_secrets() from public, anon;
grant execute on function public.pa_member_secrets() to authenticated, service_role;

-- 五、改设置:只动 p 里带了的键;秘密给空串 = 清掉;mcp_token 不从这儿改(走 pa_rotate_mcp_token)。
--     返回遮罩版。
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
         updated_at        = now();

  return public.pa_member_settings();
end
$$;
revoke all on function public.pa_set_member_settings(jsonb) from public, anon;
grant execute on function public.pa_set_member_settings(jsonb) to authenticated, service_role;

-- 六、换 MCP 令牌:返回新的那串
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
  returning s.mcp_token into t;
  return t;
end
$$;
revoke all on function public.pa_rotate_mcp_token() from public, anon;
grant execute on function public.pa_rotate_mcp_token() to authenticated, service_role;

-- 七、注册即入住:0147 那版全文照抄,只多最后一句 insert member_settings
create or replace function producer.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = producer, public
as $$
begin
  insert into producer.profile (owner) values (new.id) on conflict do nothing;
  insert into producer.voice   (owner) values (new.id) on conflict do nothing;
  insert into producer.tasks   (name, type, schedule, sort, owner, prompt, run_every, run_weekday, run_hour, next_run_at)
  values ('每周找机会', 'scout_aggregators', 'weekly', 10, new.id,
$p$你是这位艺术家的机会跟踪助理，每周跑一次：按下面的画像找适合 ta 的机会——驻地、资助、公开征集、群展、奖项——把新的加进关注表。造哪几张卡由系统按「够不够得着」决定，不用你挑。

== 画像（筛选标准就是这个，没写的别替 ta 假设）==
{{画像}}

== 怎么找 ==
- 用 WebSearch / WebFetch。从画像出发拟关键词：常住地 + 类型 + 年份（例如「<常住地> artist residency open call <年份>」）、媒介或创作方向 + grant / open call、ta 的身份能申请的资助。
- 每条都点进官方页核实：现在开不开放、真实截止、要什么材料。只有聚合站转载、找不到官方页的不算。
- 当前没开放但值得等的也报，注明预计开放时间。
- 触犯画像里「排除规则」的直接跳过；明显 vanity（高报名费 + 含糊奖项、要为领奖付钱、没有独立官网）放进 skipped 并写清原因。

（这一段是出厂默认。你可以在这里加上自己常看的来源、偏好的地区、想排除的类型——改完下次跑就按你的来。）$p$,
          'week', 1, 8, producer.task_next_run('week', 1, 8, now()))
  on conflict do nothing;
  insert into producer.member_settings (owner) values (new.id) on conflict do nothing;
  return new;
end
$$;
