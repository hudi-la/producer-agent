-- Producer Agent — 一条事实身上挂它引发的判断
--
-- 病：判断的结论存成「线的状态」（next_touch_at 之类），全局一直在变，
--     存下来的派生值跟事实分叉 —— 这一路修的十几个 bug 一大半是这个。
--
-- 药：每次判断锚在**引发它的那条事实**上（一封信、一条笔、一次回答）。
--     信的内容永远不变，所以判一次永远算数。line/contact 的当前 state
--     不落表，由 0094 的视图重放算出来。
--
-- 锚点选 pursuit_messages.id 而不是 gmail_message_id：那张表里
-- email / note / meet / decision 本来就并排放着，一套锚点全盖住
-- 「信里说的」和「你手记的」。（letter_verdicts 保留不动，它是同一个
-- 思路的先例，服务旧的 triage 路。）
--
-- situation 记的是转移表的哪一格问出来的（例 'WAITING_REPLY x THEIR_LETTER'）
-- —— 查错的时候第一个问题永远是「这是谁判的、按什么判的」。
--
-- 设计稿：docs/specs/2026-08-19-what-this-line-is-waiting-on-design.md 第九节

create table if not exists producer.message_tags (
  message_id   uuid primary key references producer.pursuit_messages(id) on delete cascade,
  situation    text not null,
  -- 答案（哪格用哪些列，其余留 null）：
  resolves     boolean,      -- 解决了当时等的事吗 —— 关 WAITING_REPLY 的唯一途径
  resolves_why text,
  needs_reply  boolean,
  reply_why    text,         -- 判「要回」凭什么 —— 通知栏要显示这句
  awaiting     text,         -- 这封信发出后在等对方做什么
  wait_days    int,          -- 按这类事的惯例该等几天（agent 定，5/14 只是兜底）
  meet_at      timestamptz,  -- 约的日子
  gist         text,         -- 一句话梗概，通知栏直接用
  tagged_at    timestamptz not null default now(),
  tagged_by    text not null default 'fairwind',
  -- 日期和理由成对，孤儿字段挡在门口。教训：next_touch_why 全 null 的时候，
  -- 界面只好自己编了个「你定的日子 8/17」。
  constraint tags_paired check (
    (awaiting is null or wait_days is not null) and
    (needs_reply is not true or reply_why is not null) and
    (resolves is not true or resolves_why is not null))
);

create index if not exists message_tags_meet on producer.message_tags (meet_at)
  where meet_at is not null;

-- 写标签。upsert：同一封信重判，新答案盖旧答案（信没变，判得更准了而已）。
create or replace function public.pa_tag_message(
  p_message_id  uuid,
  p_situation   text,
  p_resolves     boolean     default null,
  p_resolves_why text        default null,
  p_needs_reply  boolean     default null,
  p_reply_why    text        default null,
  p_awaiting     text        default null,
  p_wait_days    int         default null,
  p_meet_at      timestamptz default null,
  p_gist         text        default null,
  p_by           text        default 'fairwind'
) returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if p_message_id is null then raise exception '标签得有锚：message_id 是空的'; end if;
  if coalesce(btrim(p_situation), '') = '' then
    raise exception '标签得说清是哪一格问出来的：situation 是空的';
  end if;

  insert into producer.message_tags as t (
    message_id, situation, resolves, resolves_why, needs_reply, reply_why,
    awaiting, wait_days, meet_at, gist, tagged_by
  ) values (
    p_message_id, btrim(p_situation),
    p_resolves, nullif(btrim(coalesce(p_resolves_why, '')), ''),
    p_needs_reply, nullif(btrim(coalesce(p_reply_why, '')), ''),
    nullif(btrim(coalesce(p_awaiting, '')), ''), p_wait_days,
    p_meet_at, nullif(btrim(coalesce(p_gist, '')), ''),
    coalesce(nullif(btrim(coalesce(p_by, '')), ''), 'fairwind')
  )
  on conflict (message_id) do update set
    situation    = excluded.situation,
    resolves     = excluded.resolves,
    resolves_why = excluded.resolves_why,
    needs_reply  = excluded.needs_reply,
    reply_why    = excluded.reply_why,
    awaiting     = excluded.awaiting,
    wait_days    = excluded.wait_days,
    meet_at      = excluded.meet_at,
    gist         = excluded.gist,
    tagged_at    = now(),
    tagged_by    = excluded.tagged_by;
end $$;

revoke all on function public.pa_tag_message(uuid,text,boolean,text,boolean,text,text,int,timestamptz,text,text) from public;
grant execute on function public.pa_tag_message(uuid,text,boolean,text,boolean,text,text,int,timestamptz,text,text) to anon, authenticated, service_role;
