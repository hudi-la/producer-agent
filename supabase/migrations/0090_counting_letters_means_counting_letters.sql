-- Producer Agent — 数信就是数信，别把草稿数进去
--
-- 病：「相关的人」里 Ana Herruzo 写着 5 封 —— 真信 1 封、草稿 4 条。
--     Biayna 写着 8 封 —— 真信 5、草稿 3。
--
-- ══ 这是同一件事的第四次 ═════════════════════════════════════
--
--     抽屉里的对话      0086
--     左栏卷宗 / 人卡    0089
--     「相关的人」的封数  这一支
--
-- 前三次我都只修了被指出来的那一处，还说过「这是最后一处」——
-- 而我从来没数过一共有几处。
--
-- 病根是同一个：判「这是不是一封信」有两个判据在流通
--     kind = 'email'                 对的
--     gmail_message_id is not null   **gmail_draft 出现之前**是对的
-- 0075 引入 gmail_draft 那天，后一个在所有用它的地方同时变错。
--
-- ══ 这次先全库扫，再动手 ═══════════════════════════════════
--
--   select … from pg_class where pg_get_viewdef(oid) ~* 'gmail_message_id IS NOT NULL'
--   select … from pg_proc  where pg_get_functiondef(oid) ~* '…'
--
-- 一共 8 处。5 处安全（同时带了 kind，或者只改归属不改分类）：
--   v_pa_cue_facts · v_pa_pursuit_mail · pa_letters_missing_body
--   pa_add_contact_email · pa_add_email · pa_claim_email
-- 3 处有问题，全在这一支里改：
--   v_pa_pursuit_parties · v_pa_orgs · v_pa_unknown_senders
--
-- 顺带：这三个视图**连 deleted_at 都没滤** —— 0066 的规矩是读面每次都要带
-- （「重说」撤掉的行还在库里，读面一律滤掉）。一起补上。
--
-- 判据统一成 kind = 'email'：它比 gmail_message_id is not null 严格
-- （自查里有一条盯着「kind=email 的都有 gmail_message_id」）。

create or replace view public.v_pa_pursuit_parties as
 SELECT pp.id, pp.pursuit_id, pp.contact_id, pp.mailbox_email, pp.note, pp.added_by,
    COALESCE(c.name, b.org, pp.mailbox_email) AS name,
    COALESCE(c.org, b.org) AS org,
    c.role,
    pp.mailbox_email IS NOT NULL AS is_mailbox,
    ( SELECT count(*) FROM producer.pursuit_messages m
       WHERE m.kind = 'email' AND m.deleted_at IS NULL AND
             CASE WHEN pp.contact_id IS NOT NULL THEN m.contact_id = pp.contact_id
                  ELSE lower(m.counterpart_email) = lower(pp.mailbox_email) END) AS mails,
    ( SELECT max(m.created_at)::date FROM producer.pursuit_messages m
       WHERE m.kind = 'email' AND m.deleted_at IS NULL AND
             CASE WHEN pp.contact_id IS NOT NULL THEN m.contact_id = pp.contact_id
                  ELSE lower(m.counterpart_email) = lower(pp.mailbox_email) END) AS last_at
   FROM producer.pursuit_parties pp
     LEFT JOIN producer.contacts c ON c.id = pp.contact_id
     LEFT JOIN producer.org_mailboxes b ON lower(b.email) = lower(pp.mailbox_email);

create or replace view public.v_pa_orgs as
 WITH names AS (
   SELECT DISTINCT contact_orgs.org FROM producer.contact_orgs
   UNION
   SELECT DISTINCT org_mailboxes.org FROM producer.org_mailboxes)
 SELECT org,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('email', b.email, 'label', b.label, 'notes', b.notes) ORDER BY b.email)
           FROM producer.org_mailboxes b WHERE b.org = n.org), '[]'::jsonb) AS mailboxes,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('contact_id', o.contact_id, 'name', c.name, 'role', o.role, 'since', o.since, 'until', o.until) ORDER BY (o.until IS NOT NULL), c.name)
           FROM producer.contact_orgs o JOIN producer.contacts c ON c.id = o.contact_id
          WHERE o.org = n.org), '[]'::jsonb) AS people,
    ( SELECT count(*) FROM producer.contact_orgs o WHERE o.org = n.org AND o.until IS NULL) AS people_now,
    ( SELECT count(*) FROM producer.contact_orgs o WHERE o.org = n.org AND o.until IS NOT NULL) AS people_past,
    ( SELECT count(*) FROM producer.pursuit_messages m
       WHERE m.kind = 'email' AND m.deleted_at IS NULL AND (EXISTS ( SELECT 1
               FROM producer.org_mailboxes b
              WHERE b.org = n.org AND lower(b.email) = lower(m.counterpart_email)))) AS mail_count,
    ( SELECT max(m.created_at)::date FROM producer.pursuit_messages m
       WHERE m.kind = 'email' AND m.deleted_at IS NULL AND (EXISTS ( SELECT 1
               FROM producer.org_mailboxes b
              WHERE b.org = n.org AND lower(b.email) = lower(m.counterpart_email)))) AS last_touch_at,
    COALESCE(( SELECT jsonb_agg(DISTINCT jsonb_build_object('id', p.id, 'title', p.title, 'stage', p.stage))
           FROM producer.pursuits p
          WHERE (EXISTS ( SELECT 1 FROM producer.pursuit_messages m
                  WHERE m.pursuit_id = p.id AND m.kind = 'email' AND m.deleted_at IS NULL
                    AND (EXISTS ( SELECT 1 FROM producer.org_mailboxes b
                          WHERE b.org = n.org AND lower(b.email) = lower(m.counterpart_email)))))
             OR (EXISTS ( SELECT 1 FROM producer.contact_orgs o
                  WHERE o.contact_id = p.contact_id AND o.org = n.org))), '[]'::jsonb) AS pursuits
   FROM names n;

create or replace view public.v_pa_unknown_senders as
 SELECT m.counterpart_email AS email,
    count(*) AS "封数",
    min(m.created_at)::date AS "第一次",
    max(m.created_at)::date AS "最近一次",
    count(*) FILTER (WHERE m.role = 'org'::text) AS "他发来的",
    count(*) FILTER (WHERE m.role = 'artist'::text) AS "你发去的",
    (array_agg(m.meta ->> 'from_name'::text ORDER BY m.created_at DESC)
       FILTER (WHERE m.role = 'org'::text AND (m.meta ->> 'from_name'::text) IS NOT NULL))[1] AS "信头署名",
    (array_agg(DISTINCT p.title))[1:3] AS "出现在哪些机会线"
   FROM producer.pursuit_messages m
     LEFT JOIN producer.pursuits p ON p.id = m.pursuit_id
  WHERE m.kind = 'email' AND m.deleted_at IS NULL
    AND m.counterpart_email IS NOT NULL AND m.contact_id IS NULL
    AND NOT (EXISTS ( SELECT 1 FROM producer.org_mailboxes b
           WHERE lower(b.email) = lower(m.counterpart_email)))
  GROUP BY m.counterpart_email
  ORDER BY (count(*)) DESC;

grant select on public.v_pa_pursuit_parties to anon, authenticated, service_role;
grant select on public.v_pa_orgs            to anon, authenticated, service_role;
grant select on public.v_pa_unknown_senders to anon, authenticated, service_role;

-- 自查扩到「凡是数信的地方」，不只是列信的。加计数的时候这儿加一条。
drop function if exists public.pa_selfcheck_reads();
create function public.pa_selfcheck_reads()
returns table (读面 text, 检查 text, 实际 text, 通过 boolean)
language plpgsql security definer set search_path = public, producer
as $$
declare v text;
begin
  读面 := 'v_pa_pursuit_mail';        检查 := '列信：不许有草稿';
  select count(*)::text into v from public.v_pa_pursuit_mail where kind='gmail_draft';
  实际 := v || ' 条草稿'; 通过 := v='0'; return next;

  读面 := 'v_pa_pursuit_messages';    检查 := '列信：不许有草稿';
  select count(*)::text into v from public.v_pa_pursuit_messages where kind='gmail_draft';
  实际 := v || ' 条草稿'; 通过 := v='0'; return next;

  读面 := 'v_pa_pursuit_thread';      检查 := '列信：不许有草稿';
  select count(*)::text into v from public.v_pa_pursuit_thread where kind='gmail_draft';
  实际 := v || ' 条草稿'; 通过 := v='0'; return next;

  读面 := 'v_pa_cue_facts';           检查 := '最后一封来信不许是草稿';
  select count(*)::text into v from public.v_pa_cue_facts f
    join producer.pursuit_messages m on m.gmail_message_id = f.last_in_id
   where m.kind = 'gmail_draft';
  实际 := v || ' 条草稿'; 通过 := v='0'; return next;

  读面 := 'v_pa_pursuit_parties';     检查 := '数信：封数 = 真信数';
  select count(*)::text into v from public.v_pa_pursuit_parties pp
   where pp.contact_id is not null
     and pp.mails <> (select count(*) from producer.pursuit_messages m
                       where m.contact_id = pp.contact_id
                         and m.kind='email' and m.deleted_at is null);
  实际 := v || ' 个人对不上'; 通过 := v='0'; return next;

  读面 := 'v_pa_orgs';                检查 := '数信：封数 = 真信数';
  select count(*)::text into v from public.v_pa_orgs o
   where o.mail_count <> (select count(*) from producer.pursuit_messages m
                           where m.kind='email' and m.deleted_at is null
                             and exists (select 1 from producer.org_mailboxes b
                                          where b.org = o.org
                                            and lower(b.email)=lower(m.counterpart_email)));
  实际 := v || ' 个机构对不上'; 通过 := v='0'; return next;

  读面 := 'v_pa_unknown_senders';     检查 := '数信：不许把草稿算进去';
  select count(*)::text into v from public.v_pa_unknown_senders u
    join producer.pursuit_messages m on lower(m.counterpart_email)=lower(u.email)
   where m.kind='gmail_draft'
     and u."封数" <> (select count(*) from producer.pursuit_messages x
                      where lower(x.counterpart_email)=lower(u.email)
                        and x.kind='email' and x.deleted_at is null
                        and x.contact_id is null);
  实际 := v || ' 个地址对不上'; 通过 := v='0'; return next;
end $$;

grant execute on function public.pa_selfcheck_reads() to service_role;

comment on function public.pa_selfcheck_reads() is
  '凡是列信或数信的地方都在这儿数一遍。这件事修过四次，每次只修了被指出来的那一处';
