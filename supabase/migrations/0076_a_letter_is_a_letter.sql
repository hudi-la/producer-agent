-- Producer Agent — 一封信就是一封信，别有两个名字
--
-- 病：同一类东西被写成了两类。
--
--   带 gmail id、有对面地址、role 是 org/artist、在信头账本里 —— 四项全同的
--   832 封真信，803 封叫 'message'，29 封叫 'email'。
--
-- 而**所有读它的代码，心里想的都是「email = 一封信」**：
--   · PursuitFocus.jsx:124  往来里那个「· 邮件」角标
--   · PursuitFocus.jsx:481  找「最后一封信」
--   · PursuitFocus.jsx:513  三栏布局的判据
--   · Dossier.jsx:138       名片上「往来」数几封
--   · brain/server.js:1009  消化时读哪几封
--
-- 反过来，**没有任何一处**把 'message' 当成「不是信」。
--
-- 所以写错的是写的那一方：pa_add_mail 写死了 'message'，从 0038 起
-- 0045 / 0050 / 0052 / 0061 一路原样抄下来，五支迁移没有一行注释解释过为什么。
-- 不是定下来的，是抄下来的。
--
-- 后果：那 803 封真信在上面五处**全都不算数**。你收到的信里，
-- 「· 邮件」角标一个都不显示，名片上「往来」的数字只数得到 29。
--
-- ══ 为什么改库而不是改筛的那一句 ═════════════════════════════════
--
-- 因为病在存的那一头：同一类东西存成了两类。改筛的那一句只能让**这一个**
-- 读者绕过去，另外五处照旧瞎着，而且下一个来读的人还会再踩一次。
--
-- 0019 那支迁移记着同一种病的另一半：「next_touch_at 一个字段被拿来装四种
-- 意思，所以卡上那句话经常是错的」。一个字段装两种意思，和一种东西挂两个
-- 标签，是同一件事的两面。
--
-- 上游：0075（先把草稿摘出去 —— 那 7 条不是信，不能一起并进来）

-- ══ 一、以后写对 ═══════════════════════════════════════════════
--
-- 整段重写，不写差异 —— 0025 的规矩：漏掉 security definer 或 search_path
-- 会悄悄改掉权限模型，且不报错。下面是 0061 的原文，只动 'message' → 'email'。
create or replace function public.pa_add_mail(
  p_gmail_message_id text, p_counterpart text, p_role text, p_content text,
  p_pursuit_id uuid default null, p_body_raw text default null,
  p_meta jsonb default '{}'::jsonb, p_created_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r producer.pursuit_messages; ins boolean := false; cid uuid; is_org boolean; cp text;
begin
  if p_role not in ('org', 'artist') then
    raise exception 'email 的 role 只能是 org|artist，收到 %', p_role;
  end if;
  cp := lower(btrim(p_counterpart));
  if cp = '' or cp is null then
    raise exception '对面地址不能为空——没有它就没法判断这封信是谁的，而猜就是 0033 犯的错';
  end if;
  if coalesce(btrim(p_gmail_message_id), '') = '' then
    raise exception 'gmail_message_id 不能为空——没有它就没法去重';
  end if;

  select e.contact_id into cid from producer.contact_emails e where lower(e.email) = cp;
  select true into is_org from producer.org_mailboxes b where lower(b.email) = cp;

  insert into producer.pursuit_messages
    (pursuit_id, contact_id, counterpart_email, role, kind, content, body_raw,
     gmail_message_id, meta, created_at)
  -- 'email'，不是 'message'。见开头。
  values (p_pursuit_id, cid, cp, p_role, 'email', p_content, p_body_raw,
          p_gmail_message_id, coalesce(p_meta, '{}'::jsonb), coalesce(p_created_at, now()))
  on conflict do nothing
  returning * into r;

  if found then ins := true; else
    select * into r from producer.pursuit_messages
     where gmail_message_id = p_gmail_message_id
       and (contact_id is not distinct from cid or pursuit_id is not distinct from p_pursuit_id)
     limit 1;
  end if;

  if cid is not null then
    update producer.contacts
       set last_touch_at = greatest(coalesce(last_touch_at, date '1900-01-01'),
             (coalesce(p_created_at, now()) at time zone producer.app_tz())::date),
           last_touch_src = 'email'
     where id = cid;
  end if;

  return jsonb_build_object('inserted', ins, 'message', to_jsonb(r), 'contact_id', cid,
    'owner', case when cid is not null then 'person'
                  when coalesce(is_org, false) then 'org_mailbox' else 'unknown' end);
end $function$;

-- ══ 二、已经写错的回填 ═════════════════════════════════════════
--
-- 判据用**结构**，不用 kind 自己：有 gmail id、role 是往来、在信头账本里
-- 且不是草稿。这样回填不依赖那个正在被修的字段。
update producer.pursuit_messages m set kind = 'email'
 where m.kind = 'message'
   and m.gmail_message_id is not null
   and m.role in ('org', 'artist')
   and exists (select 1 from producer.mail_headers h
                where h.gmail_message_id = m.gmail_message_id and not h.is_draft);

-- 没有 gmail id 的 'message' 一行不动 —— 那是你跟 Fairwind 的商量，
-- 本来就不是往来。cues.js 开头那句原话：「没有 gmail_message_id 的是你跟
-- Fairwind 的商量，拿它当往来算，等待期会被你自己的一句嘀咕重置掉。」

comment on table producer.pursuit_messages is
  'kind: email=一封真信（收或发）| message=你跟 Fairwind 的商量 | gmail_draft=草稿的自动保存 | brief|draft|decision|note|meet';
