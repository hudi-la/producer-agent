-- 0061 漏了一半：只重算了 last_touch_src='email' 的日期。
--
-- 「记一笔」（meet）那些还留着 UTC 那天，于是同一件事在同一页上两个日期：
--   由头说「Weidi Zhang 8/13 见过，48 小时信还没发」  ← 从 created_at 现算的
--   通讯录那行说「8/14」                              ← 存下来的旧值
--
-- 这正是 0061 要治的病，我治了一半就收手了。补完。
--
-- checkin 那些没法重算：打卡只存了一个日期，没有可回溯的源记录。
-- 现在起 pa_contact_checkin 已经按当地算了，历史那几条如果差一天，
-- 只能你自己看到了改——不编一个值填上去。
update producer.contacts c
   set last_touch_at = x.d
  from (select m.contact_id,
               max((m.created_at at time zone producer.app_tz())::date) as d
          from producer.pursuit_messages m
         where m.role = 'note' and m.kind = 'meet' and m.contact_id is not null
         group by m.contact_id) x
 where c.id = x.contact_id
   and c.last_touch_src = 'meet'
   and c.last_touch_at is distinct from x.d;

do $$
declare bad int;
begin
  select count(*) into bad
    from producer.contacts c
    join (select m.contact_id,
                 max((m.created_at at time zone producer.app_tz())::date) as d
            from producer.pursuit_messages m
           where m.role = 'note' and m.kind = 'meet' and m.contact_id is not null
           group by m.contact_id) x on x.contact_id = c.id
   where c.last_touch_src = 'meet' and c.last_touch_at is distinct from x.d;
  if bad > 0 then raise exception '还有 % 个人的「记一笔」日期跟那条笔记对不上', bad; end if;
  raise notice '✓ 记一笔那些日期跟笔记本身对齐了';
end $$;
