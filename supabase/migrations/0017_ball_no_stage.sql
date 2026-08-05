-- 球权不再从 stage 推。
--
-- 0013 当初留了个兜底：没有外部往来时，按卡在哪一列猜球在谁手里
-- （pending/matching/writing = 你，sent/replying = 对方）。那是个错误：
-- 「这条线走到哪一格」和「现在该谁动」是两件事，用前者猜后者，猜出来的
-- 是一个看着很确定、其实没有依据的答案。而且列以后要让用户自己定，
-- 名字一改这套猜法就全错——行为不该挂在列名上。
--
-- 撤掉之后只剩两个真实信号：
--   ③ next_touch_at 到期或过期 → 该你动（外联唯一的引擎）
--   ① 最后一条真实对外通信是谁发的 → org 发的该你回，artist 发的等对方
-- 两个都没有 → null，卡上就不显示球权那一行。宁可不说，也不猜。

drop view if exists public.v_pa_pursuits;
create view public.v_pa_pursuits as
  select p.id, p.title, p.kind, p.org, p.location, p.url, p.funding, p.deadline,
         p.match_stars, p.why, p.notes, p.source, p.eligible, p.stage,
         p.work_id, p.task_id, p.created_at,
         p.next_touch_at, p.payoff, p.contact_id,
         w.title as work_title,
         c.name  as contact_name,
         c.role  as contact_role,
         p.ball,
         case
           -- ③ 到点了就是你该动，压过其他信号
           when p.next_touch_at is not null and p.next_touch_at <= current_date then 'me'
           -- ① 最后说话的人
           when last_ext.role = 'org'    then 'me'
           when last_ext.role = 'artist' then 'them'
           -- 没有信号就别猜（原来这里按 stage 兜底，已撤）
           else null
         end as ball_auto
    from producer.pursuits p
    left join producer.works    w on w.id = p.work_id
    left join producer.contacts c on c.id = p.contact_id
    left join lateral (
      select m.role
        from producer.pursuit_messages m
       where m.pursuit_id = p.id
         and m.role in ('org','artist')
         and m.kind = 'email'               -- 只认真实对外通信；和渡的对话(kind='message')不算
       order by m.created_at desc
       limit 1
    ) last_ext on true;

grant select on public.v_pa_pursuits to anon, authenticated;
grant select on public.v_pa_pursuits to service_role;
