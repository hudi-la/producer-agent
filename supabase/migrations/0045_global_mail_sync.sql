-- Producer Agent — 全局邮件同步：信头全量进货，判定按地址走
--
-- 设计稿：docs/specs/2026-08-10-global-mail-sync-design.md
--
-- ══ 这一刀在修什么 ═══════════════════════════════════════════════
--
-- 65 条机会线里只有 3 条登记过 thread，其余 62 条在邮件这一层是瞎的。
-- 根因是个死结：一条线拿 thread 只有两条路（在系统里起草过、或库里已有
-- 带 gmail_message_id 的信可以反查），而手动发的信两条都不占——
-- 反查需要库里先有信，信要进库先得有 thread。
--
-- 「还不认识的地址」现在是 0 条。那不是干净，是从来没有信进来过。
--
-- 药方不在归属层：pa_add_mail 判断一封信是谁的，早就完全按 counterpart_email
-- 查 contact_emails / org_mailboxes，跟 thread 没有半点关系。缺的只是进货口。
--
-- ══ 三张表，一个原则 ═══════════════════════════════════════════
--
-- **信头和消息是两张表。** 这是这一刀最要紧的结构判断。
--
-- pursuit_messages 是**对话**表：界面渲染它、pa_brain_context 把它喂给模型、
-- v_pa_unknown_senders 从它算待认地址。往里灌三万条订阅通知，上面每一样
-- 都会被毒死。
--
-- 所以生的账本另开一张（mail_headers）：机械抓来的信头，全量、完整、
-- 不加判断。一条信头**被提拔**进 pursuit_messages 的时机只有一个——
-- 它的地址被你认领了。提拔的时候才去拉正文、才让模型写摘要。
--
-- 好处是这一刀不用碰归属层一行代码：pa_add_mail / pa_claim_email /
-- v_pa_unknown_senders 原样留着，只是终于有信喂给它们了。

-- ══ 〇、先补那个去重的洞（必须在开闸之前）═══════════════════════
--
-- 现有两个唯一索引：
--   pm_gmail_uniq         (pursuit_id, gmail_message_id) where gmail_message_id is not null
--   pm_gmail_contact_uniq (contact_id,  gmail_message_id) where contact_id is not null
--
-- Postgres 里 NULL 彼此不相等。一封**既没挂线、也没认出人**的信——恰恰是
-- 全局同步会大量产生的那种——两个索引一个都管不住它。pa_add_mail 的
-- on conflict do nothing 形同虚设，每跑一轮就重复插一份。
--
-- 把 NULL 折成一个真值再做唯一。库里现在没有重复行（查过），收紧是安全的。
create unique index if not exists pm_gmail_owner_uniq
  on producer.pursuit_messages (
    gmail_message_id,
    coalesce(pursuit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(contact_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where gmail_message_id is not null;

comment on index producer.pm_gmail_owner_uniq is
  '双 NULL 那种「待认领」的信也要去重。旧的两个索引在 pursuit_id/contact_id 都空时都不生效，全局同步一开就会每轮重复插';

-- ══ 一、我的信箱 ═══════════════════════════════════════════════
--
-- 现在只有一个地址，但结构从第一天起就按 N 个做。
--
-- 不是为了将来好看：「对面是谁」的判据是**「不是我任何一个地址的那一方」**。
-- 先按单地址建库、等几万封信躺进去之后再加 CalArts 那个机构邮箱，
-- 每一封的归属都得重算一遍。二十行的事现在做，比那时候便宜得多。
create table if not exists producer.mail_accounts (
  id             uuid primary key default gen_random_uuid(),
  address        text not null,
  label          text,                                  -- '主号' / 'CalArts'
  provider       text not null default 'gmail',
  -- 上次同步到哪。Gmail 的 history.list 从这儿往后拉，首次全量之后就再也
  -- 不用遍历信箱了。pursuit_threads 上那列同名字段 2026-08-05 就建好了，
  -- 一直是 null——因为 claude.ai 的连接器给不出 historyId。设计是对的，
  -- 是水管配不上。
  history_id     text,
  last_synced_at timestamptz,
  backfilled_at  timestamptz,                           -- null = 还没全量回填过
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
create unique index if not exists mail_accounts_addr_uniq
  on producer.mail_accounts (lower(address));

comment on column producer.mail_accounts.history_id is
  'Gmail historyId：上次同步到哪。首次全量回填之前先记下当时的值，宁可下轮多拉一点也不能漏';

-- 播种：档案里那个地址就是主号。档案没填就先不播，别编一个假地址出来。
insert into producer.mail_accounts (address, label)
select lower(btrim(p.data->>'email')), '主号'
  from producer.profile p
 where coalesce(btrim(p.data->>'email'), '') <> ''
on conflict do nothing;

-- ══ 二、生的账本：信头全量落地 ═════════════════════════════════
--
-- 只有信头，没有正文。信头很便宜（一封几百字节），几万封也就几十 MB，
-- 而且是机械抓来的——不过模型，不做判断，不筛不漏。
--
-- 正文按需拉：你认领了那个地址，才去拉他名下那几封的正文。
create table if not exists producer.mail_headers (
  gmail_message_id  text primary key,
  account_id        uuid not null references producer.mail_accounts(id) on delete cascade,
  gmail_thread_id   text not null,
  from_email        text not null,
  from_name         text,
  to_emails         text[] not null default '{}',
  cc_emails         text[] not null default '{}',
  subject           text,
  sent_at           timestamptz not null,
  -- 对面那个地址：不是我**任何一个**地址的那一方。这一栏是归属的唯一判据,
  -- 跟 pa_add_mail 用的是同一个东西——0033 把 Stacy 的告别信记到别人卡上，
  -- 就是因为当时的判据是「这条线挂了谁，信就都是谁的」。
  counterpart_email text not null,
  direction         text not null,                      -- 'in' 他发来 | 'out' 我发去
  -- 群发标记：信头里就看得出来的那些（List-Unsubscribe / Precedence: bulk /
  -- no-reply@…）。第一层漏斗全靠它，零成本判掉绝大多数订阅和通知。
  bulk              boolean not null default false,
  promoted_at       timestamptz,                        -- 已经进 pursuit_messages 了
  created_at        timestamptz not null default now(),
  constraint mail_headers_dir_chk check (direction in ('in', 'out'))
);
create index if not exists mail_headers_cp_idx
  on producer.mail_headers (lower(counterpart_email));
create index if not exists mail_headers_thread_idx
  on producer.mail_headers (gmail_thread_id);
create index if not exists mail_headers_acct_idx
  on producer.mail_headers (account_id, sent_at desc);

comment on table producer.mail_headers is
  '生的账本：Gmail 信头全量，机械抓来不加判断。地址被认领之后才提拔进 pursuit_messages（那才是对话表）';

-- ══ 三、每个地址的判定 ═════════════════════════════════════════
--
-- 判断的单位是**地址**，不是邮件。地址比邮件少两个数量级，而且判一次
-- 永远算数——pa_claim_email 已经是这个语义：认领一个地址，它名下所有
-- 历史往来当场归位。
create table if not exists producer.address_verdicts (
  email       text primary key,                         -- 小写
  verdict     text not null,                            -- person | bulk | machine | unsure
  business    boolean,                                  -- 跟这摊事有关吗（unsure 时可空）
  why         text,                                     -- 人话理由，给人看的
  name        text,
  org         text,
  role        text,
  decided_by  text not null,                            -- rule | fairwind | you
  decided_at  timestamptz not null default now(),
  greeted_at  timestamptz,                              -- 端到他面前过了，别重复打扰
  constraint av_verdict_chk check (verdict in ('person', 'bulk', 'machine', 'unsure')),
  constraint av_by_chk      check (decided_by in ('rule', 'fairwind', 'you'))
);
create index if not exists address_verdicts_open_idx
  on producer.address_verdicts (verdict, business)
  where greeted_at is null;

comment on column producer.address_verdicts.decided_by is
  'you = 你翻的案。这种行任何自动判定都不许覆盖——闸在 pa_verdict_upsert 里，不是嘱咐';

-- ══ 四、端口：brain 那边 ═══════════════════════════════════════
--
-- 照 0035 立的规矩：写口一律 service_role，浏览器够不到。

-- 播种/更新一个信箱。
create or replace function public.pa_mail_account_upsert(
  p_address text,
  p_label   text default null
)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare a producer.mail_accounts;
begin
  insert into producer.mail_accounts as m (address, label)
  values (lower(btrim(p_address)), p_label)
  on conflict (lower(address)) do update set label = coalesce(excluded.label, m.label)
  returning * into a;
  return to_jsonb(a);
end $$;

-- 批量塞信头。一次 500 条，走 jsonb 数组——一条一条 RPC 的话，两万封
-- 就是两万次往返，回填要跑一整天。
--
-- on conflict do nothing：同一封信重复抓到就跳过。这也是增量同步能安心
-- 多拉一点的底气（回填前先记 historyId，宁可下轮重叠也不能漏）。
create or replace function public.pa_mail_headers_upsert(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare n_ins int;
begin
  with incoming as (
    select
      r->>'gmail_message_id'                                    as gmail_message_id,
      (r->>'account_id')::uuid                                  as account_id,
      r->>'gmail_thread_id'                                     as gmail_thread_id,
      lower(btrim(r->>'from_email'))                            as from_email,
      nullif(btrim(coalesce(r->>'from_name', '')), '')          as from_name,
      coalesce(array(select lower(btrim(x #>> '{}')) from jsonb_array_elements(coalesce(r->'to_emails', '[]'::jsonb)) x), '{}') as to_emails,
      coalesce(array(select lower(btrim(x #>> '{}')) from jsonb_array_elements(coalesce(r->'cc_emails', '[]'::jsonb)) x), '{}') as cc_emails,
      nullif(btrim(coalesce(r->>'subject', '')), '')            as subject,
      (r->>'sent_at')::timestamptz                              as sent_at,
      lower(btrim(r->>'counterpart_email'))                     as counterpart_email,
      r->>'direction'                                           as direction,
      coalesce((r->>'bulk')::boolean, false)                    as bulk
    from jsonb_array_elements(p_rows) r
  ), ok as (
    -- 缺关键字段的整行不写。宁可这一封没进来，也不要它进来之后归错人。
    select * from incoming
     where gmail_message_id is not null and gmail_message_id <> ''
       and counterpart_email like '%@%'
       and direction in ('in', 'out')
       and sent_at is not null
  ), ins as (
    insert into producer.mail_headers (
      gmail_message_id, account_id, gmail_thread_id, from_email, from_name,
      to_emails, cc_emails, subject, sent_at, counterpart_email, direction, bulk)
    select gmail_message_id, account_id, gmail_thread_id, from_email, from_name,
           to_emails, cc_emails, subject, sent_at, counterpart_email, direction, bulk
      from ok
    on conflict (gmail_message_id) do nothing
    returning 1
  )
  select count(*) into n_ins from ins;

  return jsonb_build_object(
    'given',   jsonb_array_length(p_rows),
    'written', n_ins,
    'skipped', jsonb_array_length(p_rows) - n_ins);
end $$;

-- 记「同步到哪了」。
create or replace function public.pa_mail_cursor(
  p_account_id  uuid,
  p_history_id  text,
  p_backfilled  boolean default false
)
returns void
language sql security definer set search_path to 'public'
as $$
  update producer.mail_accounts
     set history_id    = coalesce(p_history_id, history_id),
         last_synced_at = now(),
         backfilled_at = case when p_backfilled then now() else backfilled_at end
   where id = p_account_id;
$$;

-- ══ 五、第一、二层漏斗：纯 SQL，零成本 ═════════════════════════
--
-- 只判**明摆着不是人**的那些。person / business 那种判断留给第三层——
-- 一个地方做人的判断，才说得清是谁判的、判错了改哪儿。
--
-- 两条都不碰的：
--   · decided_by = 'you' —— 你翻过的案，自动判定永远不许覆盖
--   · 已经在通讯录 / 机构信箱里的 —— 那些早有答案了
create or replace function public.pa_mail_rule_pass()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare n_machine int := 0; n_bulk int := 0;
begin
  -- 一、机器地址：信头上的名字就写着「别回我」。
  with cand as (
    select distinct h.counterpart_email as email
      from producer.mail_headers h
     where h.counterpart_email ~* '^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounce|postmaster|automated)[@+.]'
        or h.counterpart_email ~* '@(bounce|em|mailer|reply)\.'
  ), w as (
    insert into producer.address_verdicts as t (email, verdict, business, why, decided_by)
    select c.email, 'machine', false, '地址本身就写着别回它', 'rule'
      from cand c
     where not exists (select 1 from producer.contact_emails e where lower(e.email) = c.email)
       and not exists (select 1 from producer.org_mailboxes b where lower(b.email) = c.email)
    on conflict (email) do update
       set verdict = excluded.verdict, business = excluded.business,
           why = excluded.why, decided_by = 'rule', decided_at = now()
     where t.decided_by <> 'you'
    returning 1
  ) select count(*) into n_machine from w;

  -- 二、群发源：他发来的每一封都带群发信头，而且**你一封都没回过**。
  --
  -- 「你没回过」这条很要紧。你回过的一律不自动判掉——哪怕它长得像
  -- 订阅源。判错一个真人的代价，比多留几个订阅在待判队列里大得多。
  with per as (
    select h.counterpart_email as email,
           count(*) filter (where h.direction = 'in')                as n_in,
           count(*) filter (where h.direction = 'in' and h.bulk)     as n_bulk,
           count(*) filter (where h.direction = 'out')               as n_out
      from producer.mail_headers h
     group by h.counterpart_email
  ), cand as (
    select email from per where n_out = 0 and n_in > 0 and n_bulk = n_in
  ), w as (
    insert into producer.address_verdicts as t (email, verdict, business, why, decided_by)
    select c.email, 'bulk', false, '每封都带群发信头，你一封都没回过', 'rule'
      from cand c
     where not exists (select 1 from producer.contact_emails e where lower(e.email) = c.email)
       and not exists (select 1 from producer.org_mailboxes b where lower(b.email) = c.email)
    on conflict (email) do update
       set verdict = excluded.verdict, business = excluded.business,
           why = excluded.why, decided_by = 'rule', decided_at = now()
     where t.decided_by <> 'you'
    returning 1
  ) select count(*) into n_bulk from w;

  return jsonb_build_object(
    'machine', n_machine,
    'bulk',    n_bulk,
    'left',    (select count(*) from (
                  select distinct h.counterpart_email e from producer.mail_headers h) x
                 where not exists (select 1 from producer.address_verdicts v where v.email = x.e)
                   and not exists (select 1 from producer.contact_emails c where lower(c.email) = x.e)
                   and not exists (select 1 from producer.org_mailboxes b where lower(b.email) = x.e)));
end $$;

-- ══ 六、第三层要判的地址卡 ═════════════════════════════════════
--
-- 送给模型的不是邮件，是一张卡：地址、署名、最近几个主题行、来往封数、
-- 首末日期。约 150 token，五十张一批。
--
-- 排序：**你写过信给他的排最前**。那是最强的正面信号，也是最不能判错的
-- 一批——他们几乎都是真关系。
create or replace function public.pa_address_candidates(p_limit int default 50)
returns jsonb
language sql security definer set search_path to 'public'
as $$
  select coalesce(jsonb_agg(c), '[]'::jsonb) from (
    select jsonb_build_object(
      'email',    h.counterpart_email,
      'name',     (array_agg(h.from_name order by h.sent_at desc)
                     filter (where h.direction = 'in' and h.from_name is not null))[1],
      'domain',   split_part(h.counterpart_email, '@', 2),
      'in',       count(*) filter (where h.direction = 'in'),
      'out',      count(*) filter (where h.direction = 'out'),
      'bulk',     count(*) filter (where h.bulk),
      'first',    min(h.sent_at)::date,
      'last',     max(h.sent_at)::date,
      'subjects', (array_agg(h.subject order by h.sent_at desc) filter (where h.subject is not null))[1:5]
    ) as c
    from producer.mail_headers h
    where not exists (select 1 from producer.address_verdicts v where v.email = h.counterpart_email)
      and not exists (select 1 from producer.contact_emails e where lower(e.email) = h.counterpart_email)
      and not exists (select 1 from producer.org_mailboxes b where lower(b.email) = h.counterpart_email)
    group by h.counterpart_email
    order by count(*) filter (where h.direction = 'out') desc, count(*) desc
    limit greatest(p_limit, 1)
  ) t;
$$;

-- 写一条判定。**decided_by='you' 的行只有 'you' 能覆盖**——闸在这儿，
-- 不在提示词里。翻过案的地址，模型再跑一百轮也动不了它。
create or replace function public.pa_verdict_upsert(
  p_email      text,
  p_verdict    text,
  p_business   boolean default null,
  p_why        text default null,
  p_name       text default null,
  p_org        text default null,
  p_role       text default null,
  p_decided_by text default 'fairwind'
)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare em text; v producer.address_verdicts; locked boolean;
begin
  em := lower(btrim(p_email));
  if em !~ '@' then raise exception '不像个地址：%', p_email; end if;

  select (decided_by = 'you') into locked from producer.address_verdicts where email = em;
  if coalesce(locked, false) and p_decided_by <> 'you' then
    select * into v from producer.address_verdicts where email = em;
    return jsonb_build_object('written', false, 'why', '这条你翻过案，自动判定不许覆盖',
                              'verdict', to_jsonb(v));
  end if;

  insert into producer.address_verdicts as t
         (email, verdict, business, why, name, org, role, decided_by, decided_at)
  values (em, p_verdict, p_business, p_why, p_name, p_org, p_role, p_decided_by, now())
  on conflict (email) do update
     set verdict = excluded.verdict, business = excluded.business, why = excluded.why,
         name = coalesce(excluded.name, t.name),
         org  = coalesce(excluded.org,  t.org),
         role = coalesce(excluded.role, t.role),
         decided_by = excluded.decided_by, decided_at = now()
  returning * into v;
  return jsonb_build_object('written', true, 'verdict', to_jsonb(v));
end $$;

-- 端到他面前过了就打个戳，下次别重复打扰。
create or replace function public.pa_mail_greeted(p_emails text[])
returns int
language sql security definer set search_path to 'public'
as $$
  with w as (
    update producer.address_verdicts
       set greeted_at = now()
     where email = any (select lower(btrim(x)) from unnest(p_emails) x)
       and greeted_at is null
    returning 1
  ) select count(*)::int from w;
$$;

-- 认领之后：把这个地址名下所有还没提拔的信头交出来，brain 拿去拉正文。
create or replace function public.pa_mail_promote(p_email text)
returns jsonb
language sql security definer set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'gmail_message_id', h.gmail_message_id,
           'gmail_thread_id',  h.gmail_thread_id,
           'subject',          h.subject,
           'from_name',        h.from_name,
           'sent_at',          h.sent_at,
           'direction',        h.direction,
           'counterpart_email', h.counterpart_email) order by h.sent_at), '[]'::jsonb)
    from producer.mail_headers h
   where lower(h.counterpart_email) = lower(btrim(p_email))
     and h.promoted_at is null;
$$;

create or replace function public.pa_mail_promoted(p_ids text[])
returns int
language sql security definer set search_path to 'public'
as $$
  with w as (
    update producer.mail_headers set promoted_at = now()
     where gmail_message_id = any (p_ids) and promoted_at is null
    returning 1
  ) select count(*)::int from w;
$$;

-- ══ 七、读面：浏览器直连 ═══════════════════════════════════════

-- 等你点头的：它判定是业务相关的真人，还没进通讯录，也还没端给过你。
create or replace view public.v_pa_greetable as
  select v.email, v.name, v.org, v.role, v.why, v.decided_by, v.decided_at,
         s.n_in, s.n_out, s.first_at, s.last_at, s.subjects
    from producer.address_verdicts v
    join lateral (
      select count(*) filter (where h.direction = 'in')  as n_in,
             count(*) filter (where h.direction = 'out') as n_out,
             min(h.sent_at)::date as first_at,
             max(h.sent_at)::date as last_at,
             (array_agg(h.subject order by h.sent_at desc) filter (where h.subject is not null))[1:3] as subjects
        from producer.mail_headers h
       where lower(h.counterpart_email) = v.email
    ) s on true
   where v.verdict = 'person'
     and coalesce(v.business, false)
     and v.greeted_at is null
     and not exists (select 1 from producer.contact_emails e where lower(e.email) = v.email)
   order by s.n_out desc, s.last_at desc;

-- 档案柜：判掉的一个都不删，全在这儿，可搜可翻案。
--
-- 这一页不是待办清单——你不需要清空它。它存在的意义是：万一它冤枉了
-- 一个真人，你搜得到、翻得了案。AI 静默判掉一个真人，跟丢了没有区别。
create or replace view public.v_pa_verdict_archive as
  select v.email, v.verdict, v.business, v.why, v.name, v.org,
         v.decided_by, v.decided_at, v.greeted_at,
         s.n, s.n_in, s.n_out, s.first_at, s.last_at, s.subject
    from producer.address_verdicts v
    join lateral (
      select count(*) as n,
             count(*) filter (where h.direction = 'in')  as n_in,
             count(*) filter (where h.direction = 'out') as n_out,
             min(h.sent_at)::date as first_at,
             max(h.sent_at)::date as last_at,
             (array_agg(h.subject order by h.sent_at desc) filter (where h.subject is not null))[1] as subject
        from producer.mail_headers h
       where lower(h.counterpart_email) = v.email
    ) s on true;

-- 同步现状：给界面报「回填到哪了、上次收信是什么时候」。
create or replace view public.v_pa_mail_accounts as
  select a.id, a.address, a.label, a.active, a.backfilled_at, a.last_synced_at,
         (a.history_id is not null) as has_cursor,
         (select count(*) from producer.mail_headers h where h.account_id = a.id) as headers
    from producer.mail_accounts a;

-- ══ 八、锁面 ═══════════════════════════════════════════════════
--
-- 跟 0035 一个规矩：写口只给 service_role（brain 拿着 service key，
-- 浏览器拿的是 anon）。唯一的例外是 pa_verdict_upsert——翻案是你的手，
-- 得让浏览器直连，跟 pa_set_final / pa_set_stage 同一套。
revoke all on function public.pa_mail_account_upsert(text, text) from public, anon, authenticated;
revoke all on function public.pa_mail_headers_upsert(jsonb) from public, anon, authenticated;
revoke all on function public.pa_mail_cursor(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.pa_mail_rule_pass() from public, anon, authenticated;
revoke all on function public.pa_address_candidates(int) from public, anon, authenticated;
revoke all on function public.pa_mail_promote(text) from public, anon, authenticated;
revoke all on function public.pa_mail_promoted(text[]) from public, anon, authenticated;
revoke all on function public.pa_mail_greeted(text[]) from public, anon, authenticated;
revoke all on function public.pa_verdict_upsert(text, text, boolean, text, text, text, text, text) from public, anon, authenticated;

grant execute on function public.pa_mail_account_upsert(text, text) to service_role;
grant execute on function public.pa_mail_headers_upsert(jsonb) to service_role;
grant execute on function public.pa_mail_cursor(uuid, text, boolean) to service_role;
grant execute on function public.pa_mail_rule_pass() to service_role;
grant execute on function public.pa_address_candidates(int) to service_role;
grant execute on function public.pa_mail_promote(text) to service_role;
grant execute on function public.pa_mail_promoted(text[]) to service_role;
grant execute on function public.pa_mail_greeted(text[]) to service_role;
grant execute on function public.pa_verdict_upsert(text, text, boolean, text, text, text, text, text)
  to anon, authenticated, service_role;

grant select on public.v_pa_greetable        to anon, authenticated, service_role;
grant select on public.v_pa_verdict_archive  to anon, authenticated, service_role;
grant select on public.v_pa_mail_accounts    to anon, authenticated, service_role;
