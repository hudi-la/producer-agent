-- 卡片和球权都还在看老结构。
--
-- ══ 两处都瞎 ══════════════════════════════════════════════════
--
-- 一、卡片上那行本来就写着 `{contact_name} · 沟通中`，但 contact_name 取自
--     pursuits.contact_id ——那是「一条线一个人」那套老结构。人现在挂在
--     pursuit_parties 上，所以卡片上永远只有「沟通中」，看不见是谁。
--
-- 二、**更要紧的**：球权（他回你了 / 等回复）算的是
--     `pursuit_messages where pursuit_id = p.id and kind='email'` ——
--     同一套老结构。62 条线一封都没盖过 pursuit_id，于是球权全是空的：
--     Brooke 8/11 回了信，那条线上却不显示「他回你了」。
--
--     这比卡片上少个名字严重得多：球权是「现在轮到谁」，判空了就等于
--     这条线从待办里消失。
--
-- 两处都改成认新结构，前端一个字都不用动。

create or replace view public.v_pa_pursuits as
 SELECT p.id, p.title, p.kind, p.org, p.location, p.url, p.funding, p.deadline,
    p.match_stars, p.why, p.notes, p.source, p.eligible, p.stage, p.work_id,
    p.task_id, p.created_at, p.next_touch_at, p.payoff, p.contact_id,
    p.opens_at, p.deadline_at, p.next_action, p.next_action_done_at,
    p.last_touch_at, p.next_action_void_at, p.next_action_void_by,
    p.next_action_by, p.jot,
    w.title AS work_title,
    -- 名字：老的 contact_id 优先（你手动指过的那个最准），
    -- 没有就退回班底里往来最多的那位。机构共享信箱不当「对接人」显示——
    -- 卡片上写个 info@… 没有意义。
    COALESCE(c.name, party.name) AS contact_name,
    COALESCE(c.role, party.role) AS contact_role,
    p.ball, p.ball_at, b.ball_auto,
        CASE WHEN b.manual_holds THEN p.ball ELSE b.ball_auto END AS ball_eff,
    COALESCE(last_msg.role = 'producer'::text
             AND last_msg.kind IS DISTINCT FROM 'brief'::text
             AND last_msg.created_at > COALESCE(s.seen_at, p.created_at), false) AS unread,
    s.seen_at
   FROM producer.pursuits p
     LEFT JOIN producer.works w ON w.id = p.work_id
     LEFT JOIN producer.contacts c ON c.id = p.contact_id
     LEFT JOIN producer.pursuit_seen s ON s.pursuit_id = p.id
     -- 班底里最主要的那位：往来最多的人（不算机构信箱）
     LEFT JOIN LATERAL (
       SELECT pc.name, pc.role
         FROM public.v_pa_pursuit_parties pc
        WHERE pc.pursuit_id = p.id AND NOT pc.is_mailbox
        ORDER BY pc.mails DESC NULLS LAST, pc.name
        LIMIT 1) party ON true
     -- 最近一封对外往来。**两个来源都要看**：
     --   · 盖过 pursuit_id 的老信
     --   · 由班底/已登记 thread 推导出来的（现在绝大多数是这种）
     -- 只看前者的话，Brooke 回了信这条线的球权还是空的。
     LEFT JOIN LATERAL (
       SELECT x.role, x.created_at FROM (
         SELECT m.role, m.created_at
           FROM producer.pursuit_messages m
          WHERE m.pursuit_id = p.id
            AND m.role = ANY (ARRAY['org'::text, 'artist'::text])
            AND m.kind = 'email'::text
         UNION ALL
         SELECT v.role, v.created_at
           FROM public.v_pa_pursuit_mail v
          WHERE v.pursuit_id = p.id AND v.on_this_line
            AND v.role = ANY (ARRAY['org'::text, 'artist'::text])
       ) x ORDER BY x.created_at DESC LIMIT 1) last_ext ON true
     LEFT JOIN LATERAL (
       SELECT m.role, m.kind, m.created_at
         FROM producer.pursuit_messages m
        WHERE m.pursuit_id = p.id
        ORDER BY m.created_at DESC LIMIT 1) last_msg ON true
     CROSS JOIN LATERAL (
       SELECT CASE
                WHEN p.next_touch_at IS NOT NULL AND p.next_touch_at <= CURRENT_DATE THEN 'me'::text
                WHEN last_ext.role = 'org'::text THEN 'me'::text
                WHEN last_ext.role = 'artist'::text THEN 'them'::text
                ELSE NULL::text
              END AS ball_auto,
              p.ball IS NOT NULL
              AND (p.ball_at IS NULL
                   OR (last_ext.created_at IS NULL OR last_ext.created_at <= p.ball_at)
                   AND (p.next_touch_at IS NULL OR p.next_touch_at > CURRENT_DATE
                        OR p.next_touch_at <= p.ball_at::date)) AS manual_holds) b;

grant select on public.v_pa_pursuits to anon, authenticated, service_role;
