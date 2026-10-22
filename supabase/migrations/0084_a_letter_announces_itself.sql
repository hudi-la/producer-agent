-- Producer Agent — 信到了，它自己说一声
--
-- 0030 设计过这条告知消息，原话：
--   「对方来了新信 → 收信那段顺手落一条 Fairwind 的告知消息。这不是靠
--     Fairwind 记得写 —— 是收信入库的同一个操作顺手写的，**结构上做不到
--     「信到了但没告知」**。」
--
-- 后来 0058（四个信号）把它换成了算出来的 new_mail 列，这条消息一直没建：
-- 库里 182 条 role='producer' 的消息**全是对话回复**，一条告知都没有。
--
-- new_mail 解决了「卡面上看得见有信」，但没解决 0030 真正要的那件事：
-- **你翻这条线的时候，信的到来在时间线上该有位置。** 现在往来是往来、
-- 对话是对话 —— 你跟 Fairwind 聊到一半，中间对方回了一封信，对话里看不出来。
--
-- ══ 框里放什么：全是事实，不叫模型 ═══════════════════════════════
--
-- 谁 / 哪天 / 哪个方向 → 信头；那一两句 → **正文头一段**；展开 → body_raw。
--
-- 摘要不叫模型，两条理由：
--   一、每封信摘一次是按**信数**花钱（几千封），而这个项目的规矩是量要锁在
--       **对象数**上（几十）。
--   二、更要紧：模型摘的那句**会跟原文分叉**，而原文就在下面一个「展开」的
--       距离。截原文头一段，最坏是截得不好看，永远不会是假的。
--
-- 设计稿：docs/specs/2026-08-19-a-letter-announces-itself.md

-- ══ 一、截头一段 ═══════════════════════════════════════════════
--
-- 引用行（> 开头）和签名分隔线之前的第一段。Gmail 的回信正文前半截
-- 常常是空行 + 正文，后半截是整封被引用的旧信 —— 截到引用就够了。
create or replace function producer.first_para(p_text text, p_cap int default 180)
returns text
language sql immutable
as $$
  select nullif(btrim(left(
    -- 引用块、签名、原信头一律砍掉：它们不是这封信说的话
    regexp_replace(
      split_part(
        regexp_replace(coalesce(p_text, ''), E'\\r', '', 'g'),
        E'\n>', 1),
      E'\nOn .{0,80}wrote:[\\s\\S]*$', ''),
    p_cap)), '')
$$;

comment on function producer.first_para(text, int) is
  '正文头一段，砍掉引用块和「On … wrote:」。给告知框用 —— 不叫模型摘，摘的会跟原文分叉';

-- ══ 二、pa_add_mail 顺手落一条告知 ═════════════════════════════
--
-- 整段重写（0025 的规矩）。原文来自 0076，尾巴上多一段。
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
        gist text; who text;
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

  -- ── 顺手落一条告知 ──
  --
  -- **跟信在同一个操作里写**，所以「信到了但没告知」这种状态做不出来。
  -- 只在真新增时落（ins），重复收同一封不会刷屏。
  if ins then
    gist := producer.first_para(coalesce(p_body_raw, p_content));
    who := case when p_role = 'org'
                then coalesce((select c.name from producer.contacts c where c.id = cid), cp)
                else '你' end;
    insert into producer.pursuit_messages
      (pursuit_id, contact_id, role, kind, content, created_at, meta)
    values (p_pursuit_id, cid, 'producer', 'arrival',
            coalesce(gist, '（这封信没有正文）'),
            coalesce(p_created_at, now()),
            jsonb_build_object(
              'gmail_message_id', p_gmail_message_id,
              'dir',  case when p_role = 'org' then 'in' else 'out' end,
              'who',  who,
              'msg_id', r.id));
  end if;

  return jsonb_build_object('inserted', ins, 'message', to_jsonb(r), 'contact_id', cid,
    'owner', case when cid is not null then 'person'
                  when coalesce(is_org, false) then 'org_mailbox' else 'unknown' end);
end $function$;

-- ══ 三、告知不算「Fairwind 跟你说了话」 ════════════════════════
--
-- kind='arrival' 的 role 是 'producer'，而红点的判据是「最后一条是
-- Fairwind 说的、且不是 brief」——不排掉的话**每封信都会点亮红点**，
-- 那正是 0030 治的「红点撒谎」原样复发（当年是 brief 让整批新卡从出生起全亮）。
--
-- arrival 是**告诉你有信**，不是**它跟你说了话**。有信这件事已经有
-- new_mail 在说了。
--
-- 整段重写，列名列序一个字不动（0025 的规矩：drop 会连带砍掉依赖它的视图）。
-- 全文只改了 unread 那一行的判据。
create or replace view public.v_pa_pursuits as
 SELECT p.id, p.title, p.kind, p.org, p.location, p.url, p.funding, p.deadline,
    p.match_stars, p.why, p.notes, p.source, p.eligible, p.stage, p.work_id,
    p.task_id, p.created_at, p.next_touch_at, p.payoff, p.contact_id,
    p.opens_at, p.deadline_at, p.next_action, p.next_action_done_at,
    p.last_touch_at, p.next_action_void_at, p.next_action_void_by,
    p.next_action_by, p.jot,
    w.title AS work_title,
    COALESCE(c.name, party.name) AS contact_name,
    COALESCE(c.role, party.role) AS contact_role,
    p.ball, p.ball_at,
    NULL::text AS ball_auto,
    p.ball AS ball_eff,
    COALESCE(last_msg.role = 'producer'::text
             AND last_msg.kind IS DISTINCT FROM 'brief'::text
             AND last_msg.kind IS DISTINCT FROM 'arrival'::text
             AND last_msg.created_at > COALESCE(s.seen_at, p.created_at), false) AS unread,
    COALESCE(inbox.at > COALESCE(s.seen_at, p.created_at), false) AS new_mail,
    inbox.at AS new_mail_at,
    inbox.who AS new_mail_from,
    s.seen_at
   FROM producer.pursuits p
     LEFT JOIN producer.works w ON w.id = p.work_id
     LEFT JOIN producer.contacts c ON c.id = p.contact_id
     LEFT JOIN producer.pursuit_seen s ON s.pursuit_id = p.id
     LEFT JOIN LATERAL ( SELECT pc.name, pc.role
           FROM v_pa_pursuit_parties pc
          WHERE pc.pursuit_id = p.id AND NOT pc.is_mailbox
          ORDER BY pc.mails DESC NULLS LAST, pc.name
         LIMIT 1) party ON true
     LEFT JOIN LATERAL ( SELECT x.created_at AS at, x.who
           FROM ( SELECT m.created_at, COALESCE(ct.name, m.counterpart_email) AS who
                   FROM producer.pursuit_messages m
                     LEFT JOIN producer.contacts ct ON ct.id = m.contact_id
                  WHERE m.pursuit_id = p.id AND m.role = 'org'::text AND m.kind = 'email'::text
                UNION ALL
                 SELECT v.created_at, v.who
                   FROM v_pa_pursuit_mail v
                  WHERE v.pursuit_id = p.id AND v.on_this_line AND v.role = 'org'::text) x
          ORDER BY x.created_at DESC
         LIMIT 1) inbox ON true
     LEFT JOIN LATERAL ( SELECT m.role, m.kind, m.created_at
           FROM producer.pursuit_messages m
          WHERE m.pursuit_id = p.id
          ORDER BY m.created_at DESC
         LIMIT 1) last_msg ON true;

grant select on public.v_pa_pursuits to anon, authenticated, service_role;

comment on table producer.pursuit_messages is
  'kind: email=一封真信 | arrival=信到了的告知框 | message=你跟 Fairwind 的商量 | gmail_draft=没发出的 | brief|draft|decision|note|meet';
