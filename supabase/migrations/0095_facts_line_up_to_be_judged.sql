-- Producer Agent — 没判过的事实排队等判
--
-- 分发器（brain/judge.js）每轮问：「有哪些新事实还没过转移表？」
-- 判据就一条：message_tags 里没有它。判过必留标签（哪怕答案是
-- 「什么都不是」）—— 标签的存在本身 = 「这条判过了」，不然每轮重问。
--
-- 只排两类：真信（email）和你记的笔（note/meet/decision）。
-- Fairwind 对话（message）、简报（brief）、草稿都不是转移表的 event。
--
-- **按时间正序**：state 是按事件顺序重放的，后面的事没法先判 ——
-- 判它的时候 state 还没走到那儿。
--
-- p_since：只判 Fairwind 开工（2026-08-03）之后的。更早的只归属不进
-- 转移表（设计稿第十节）。
--
-- 走 RPC 不走 from()：producer 不在 Exposed schemas 里，from() 静默返回空。

create or replace function public.pa_facts_to_judge(
  p_since timestamptz default '2026-08-03',
  p_limit int default 12
) returns table (
  id uuid, kind text, role text, created_at timestamptz,
  subject_kind text, subject_id uuid,
  subject_name text,          -- 线的标题 / 人的名字，prompt 里用
  who text,                   -- 对面那个人（写信的/收信的）
  content text, body_raw text,
  recent jsonb                -- 这条之前的最近 3 条往来，判断的上下文
) language sql security definer set search_path = public, producer as $$
  with fact as (
    select m.id, m.kind, m.role, m.created_at, m.content, m.body_raw,
           m.counterpart_email, m.contact_id,
           coalesce(pm.pursuit_id, m.pursuit_id) as pursuit_id
      from producer.pursuit_messages m
      left join lateral (
        select v.pursuit_id from public.v_pa_pursuit_mail v
         where v.id = m.id and v.on_this_line
         order by v.created_at desc limit 1
      ) pm on true
     where m.deleted_at is null
       and m.created_at >= p_since
       and (m.kind = 'email' or m.kind in ('note', 'meet', 'decision'))
       and not exists (select 1 from producer.message_tags t where t.message_id = m.id)
       -- 日历回执不是有信息的信，不产生 event（信本身留在账本和对话里，
       -- 一封不删）。真例：Valeria 那封 `Accepted: Di Hu's Zoom Meeting`
       -- 正文是空的，旧 triage 盯着空正文编了个「可能漏附件」——这类错
       -- 从队列这儿就没了。群发（bulk）同理。
       -- 判据只住在这一个地方，别在 JS 里抄第二份（改判据先扫再改的规矩）。
       and not exists (
         select 1 from producer.mail_headers h
          where h.gmail_message_id = m.gmail_message_id
            and (h.bulk
             or h.subject ~* '^(Accepted|Declined|Tentative|Canceled|Cancelled|Invitation|Updated invitation):'))
  )
  select f.id, f.kind, f.role, f.created_at,
         case when f.pursuit_id is not null then 'pursuit' else 'contact' end,
         coalesce(f.pursuit_id, f.contact_id),
         coalesce(p.title, c.name),
         coalesce(ct.name, f.counterpart_email),
         f.content, f.body_raw,
         (select coalesce(jsonb_agg(jsonb_build_object(
                   '日', (r.created_at at time zone producer.app_tz())::date,
                   '谁', case when r.kind <> 'email' then '你记的笔'
                              when r.role = 'artist' then '你' else '对方' end,
                   -- 420 不是随手拍的：Biayna 8/17 那封，「meeting anytime between
                   -- 12-3pm on September 11th」出现在第 300 字上下 —— 截 200 字
                   -- 正好把日子剁掉，于是 9/11 的见面判丢了一次。
                   '说', left(regexp_replace(coalesce(r.body_raw, r.content, ''), E'\\s+', ' ', 'g'), 420)
                 ) order by r.created_at), '[]'::jsonb)
            from (select r0.* from producer.pursuit_messages r0
                   left join lateral (
                     select v.pursuit_id from public.v_pa_pursuit_mail v
                      where v.id = r0.id and v.on_this_line limit 1
                   ) rpm on true
                  where r0.deleted_at is null and r0.created_at < f.created_at
                    and (r0.kind = 'email' or r0.kind in ('note','meet','decision'))
                    and ((f.pursuit_id is not null
                          and coalesce(rpm.pursuit_id, r0.pursuit_id) = f.pursuit_id)
                      or (f.pursuit_id is null and r0.contact_id = f.contact_id))
                  order by r0.created_at desc limit 3) r)
    from fact f
    left join producer.pursuits p on p.id = f.pursuit_id
    left join producer.contacts c on c.id = f.contact_id and f.pursuit_id is null
    left join producer.contacts ct on ct.id = f.contact_id
   where coalesce(f.pursuit_id, f.contact_id) is not null
   order by f.created_at asc
   limit p_limit
$$;

revoke all on function public.pa_facts_to_judge(timestamptz, int) from public;
grant execute on function public.pa_facts_to_judge(timestamptz, int)
  to anon, authenticated, service_role;
