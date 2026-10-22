-- 0163 · 新联系人带着「他是谁、怎么来的」一起端上来(2026-10-07)
--
-- 收信时判地址那一步(classify)早就把名字、机构、头衔、来路(why)写进了 address_verdicts,
-- 可 v_pa_unknown_senders 只吐了封数和日期,于是页面上每个陌生地址都得再点一次「这是谁?」
-- 让模型重读一遍信——判过的事又判一遍,还要人一个个去点。
-- 他 10/7 的话:「判断为真人的地址,直接问用户加不加,把对方到底是哪里来的备注在下面」。
--
-- 这支只往视图**末尾追加列**(create or replace view 不许动老列的位置),老读法一个字不变:
--   判定 / 名字 / 机构 / 头衔 / 来路 / 谁判的   ← address_verdicts 里本来就有的
--   最近主题                                      ← 最近两封的标题,给人一眼认出是哪件事
create or replace view public.v_pa_unknown_senders as
  select h.email,
         h.封数, h.第一次, h.最近一次, h.他发来的, h.你发去的,
         coalesce(h.信头署名, v.name) as "信头署名",
         coalesce(线.titles, '{}') as "出现在哪些机会线",
         v.verdict    as "判定",
         v.name       as "名字",
         v.org        as "机构",
         v.role       as "头衔",
         v.why        as "来路",
         v.decided_by as "谁判的",
         h.subjects   as "最近主题"
    from (
      select lower(m.counterpart_email) as email,
             count(*) as "封数",
             min(m.sent_at)::date as "第一次",
             max(m.sent_at)::date as "最近一次",
             count(*) filter (where m.direction = 'in')  as "他发来的",
             count(*) filter (where m.direction = 'out') as "你发去的",
             (array_agg(m.from_name order by m.sent_at desc)
                filter (where m.direction = 'in' and m.from_name is not null))[1] as "信头署名",
             array_agg(distinct m.gmail_thread_id) as threads,
             (array_agg(m.subject order by m.sent_at desc) filter (where nullif(btrim(m.subject), '') is not null))[1:2] as subjects
        from producer.mail_headers m
       where not m.is_draft
         and m.counterpart_email is not null
         and not exists (select 1 from producer.contact_emails e
                          where lower(e.email) = lower(m.counterpart_email))
         and not exists (select 1 from producer.org_mailboxes b
                          where lower(b.email) = lower(m.counterpart_email))
       group by 1
    ) h
    join producer.address_verdicts v on v.email = h.email
    left join lateral (
      select array_agg(distinct p.title) as titles
        from producer.pursuit_threads t
        join producer.pursuits p on p.id = t.pursuit_id
       where t.gmail_thread_id = any(h.threads)
    ) 线 on true
   where v.verdict in ('person', 'shared_box')
     and coalesce(v.business, false)
   order by h.最近一次 desc;

-- 0137 的规矩:视图按调用者的身份读(RLS 生效)。create or replace 不保证留着这个选项,再说一遍
alter view public.v_pa_unknown_senders set (security_invoker = true);
revoke all on public.v_pa_unknown_senders from anon;
grant select on public.v_pa_unknown_senders to authenticated, service_role;
