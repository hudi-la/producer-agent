-- Producer Agent — 对话里得看得见这条线的信
--
-- 病：打开 ASU 那张卡，对话里**一封信都没有**。
--
-- 数了一遍，12 条有信的线里**只有 1 条读得全**：
--     9 条线 —— 一封都读不到（33 封）
--     2 条线 —— 漏了一部分（16 封）
--   一共 49 封信在对话里看不见。
--
-- 病根：`fetchMessages` 读的是 `v_pa_pursuit_messages` 按 `pursuit_id` 过滤。
--   可**很多信是靠班底 / 串登记推导挂到线上的**，`pursuit_id` 是空的
--   （`v_pa_pursuit_mail.on_this_line`，0052/0053/0055 建的）。
--   ASU 那条线按 pursuit_id 挂着 31 条，其中是信的 **0 条**；
--   靠推导算这条线的信有 **16 封**。
--
--   这不是新引入的 —— 以前信渲染成普通气泡时也一样不显示，
--   只是把信做得显眼之后，「没有信」才看得出来。
--
--   而 v_pa_cue_facts 和 pa_subjects_for_rejudge 都已经走推导了
--   （后者是 0080 修的，同一个坑）。**这是第三处**，也是最后一处。
--
-- 药：对话读一个新的读面 `v_pa_pursuit_thread`：
--     按 pursuit_id 挂着的（跟 Fairwind 的商量、备注、brief）
--   + 算这条线的信（on_this_line，不管 pursuit_id 是不是空）
--   两边并起来去重。

create or replace view public.v_pa_pursuit_thread as
  select distinct on (线, m.id)
         g.线 as pursuit_id,
         m.id, m.role, m.kind, m.content, m.meta, m.created_at,
         m.gmail_message_id, m.body_raw, m.contact_id, m.counterpart_email
    from (
      -- 直接挂在这条线上的：你跟 Fairwind 的商量、备注、决定、brief
      select m.id as mid, m.pursuit_id as 线
        from producer.pursuit_messages m
       where m.pursuit_id is not null and m.deleted_at is null
      union
      -- 算这条线的信：跟事实视图、跟重判读的是**同一批**
      select v.id, v.pursuit_id
        from public.v_pa_pursuit_mail v
       where v.on_this_line and v.kind = 'email'
    ) g
    join producer.pursuit_messages m on m.id = g.mid and m.deleted_at is null;

grant select on public.v_pa_pursuit_thread to anon, authenticated, service_role;

comment on view public.v_pa_pursuit_thread is
  '一条线的对话流：直接挂着的 + 算这条线的信（on_this_line）。跟 v_pa_cue_facts 同一个口径';
