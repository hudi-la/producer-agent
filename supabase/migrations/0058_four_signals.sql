-- 卡上只剩四样：你点的标签、新来信、红点、日期。
-- 设计稿：docs/specs/2026-08-12-four-signals-design.md
--
-- ══ 一、球权不再自动推算 ═══════════════════════════════════════
-- 原来有一套「你手动定的能撑到下一件真事发生（新的对外通信、跟进日到期），
-- 之后 Fairwind 重新接管」的规则——也就是说**你的判断会被系统悄悄改回去**，
-- 而你不会收到任何通知。
-- 现在：标签就是标签。你点了「等回复」它就是等回复，直到你自己再点。
-- ball_auto 留着但恒为 null（前端还在读这一列，删列会把界面打瞎，
-- 而这一刀的重点是判据不是清列）。
--
-- ══ 二、新来信 ═══════════════════════════════════════════════
-- 这条线上有对方来的信，而且是你上次看这张卡之后来的。
--   · 「这条线上的信」用 v_pa_pursuit_mail 的 on_this_line（0052/0053 的推导）
--   · 「上次看」用 pursuit_seen.seen_at，跟红点同一个机制，点开卡一起灭
-- 为什么「看过就灭」而不是「回了才灭」：卡面只该说一句最要紧的话。
-- 「你还没回这封信」是判断，判断归他——他觉得该回，自己点亮「待处理」。
-- 系统的活到「告诉你有信」为止。
--
-- （加了三列，列序变了，所以 drop 再建。查过：没有任何视图依赖它。）
drop view if exists public.v_pa_pursuits;
create view public.v_pa_pursuits as
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
             AND last_msg.created_at > COALESCE(s.seen_at, p.created_at), false) AS unread,
    COALESCE(inbox.at > COALESCE(s.seen_at, p.created_at), false) AS new_mail,
    inbox.at AS new_mail_at,
    inbox.who AS new_mail_from,
    s.seen_at
   FROM producer.pursuits p
     LEFT JOIN producer.works w ON w.id = p.work_id
     LEFT JOIN producer.contacts c ON c.id = p.contact_id
     LEFT JOIN producer.pursuit_seen s ON s.pursuit_id = p.id
     LEFT JOIN LATERAL (
       SELECT pc.name, pc.role
         FROM public.v_pa_pursuit_parties pc
        WHERE pc.pursuit_id = p.id AND NOT pc.is_mailbox
        ORDER BY pc.mails DESC NULLS LAST, pc.name
        LIMIT 1) party ON true
     LEFT JOIN LATERAL (
       SELECT x.created_at AS at, x.who FROM (
         SELECT m.created_at, COALESCE(ct.name, m.counterpart_email) AS who
           FROM producer.pursuit_messages m
           LEFT JOIN producer.contacts ct ON ct.id = m.contact_id
          WHERE m.pursuit_id = p.id AND m.role = 'org'::text AND m.kind = 'email'::text
         UNION ALL
         SELECT v.created_at, v.who
           FROM public.v_pa_pursuit_mail v
          WHERE v.pursuit_id = p.id AND v.on_this_line AND v.role = 'org'::text
       ) x ORDER BY x.created_at DESC LIMIT 1) inbox ON true
     LEFT JOIN LATERAL (
       SELECT m.role, m.kind, m.created_at
         FROM producer.pursuit_messages m
        WHERE m.pursuit_id = p.id
        ORDER BY m.created_at DESC LIMIT 1) last_msg ON true;

grant select on public.v_pa_pursuits to anon, authenticated, service_role;

comment on view public.v_pa_pursuits is
  '卡上只剩四样：ball（你点的标签，系统不动）/ new_mail（外部新来信，看过就灭）/ unread（Fairwind 未读）/ 日期。ball_auto 恒 null，系统不再替你判球权';
