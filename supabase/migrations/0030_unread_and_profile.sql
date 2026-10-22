-- 0030 · 红点说人话 + 档案能改
-- 设计稿：docs/specs/2026-08-08-unread-and-profile-design.md
--
-- 三件事：
--   ① 「已读」从 localStorage 搬进库（原来只活在某一个浏览器里，换个窗口全部红点复活）
--   ② 未读的判据搬进视图（原来前端要拉全库消息才算得出来，1000 行上限一到就静悄悄漏报）
--   ③ 对方来信时 Fairwind 出面说一句（原来 role='org' 根本不点红点——最该响的那下唯一不响）
-- 外加：档案能在界面上改（原来 O-1 之类既写死在 prompt 里、又躺在库里，两份会飘）

-- ══ 一、已读 ═══════════════════════════════════════════════════
-- 「我看没看过」是**我和这张卡的关系**，不是卡的属性，所以是独立的表，
-- 不是 pursuits 上加一列。
--
-- profile_id 现在恒等于唯一那行 profile。带上它不是为了今天——是为了以后
-- 真有第二个人时不用拆表：主键改成 (pursuit_id, profile_id) 即可，其余不动。
create table if not exists producer.pursuit_seen (
  pursuit_id uuid primary key references producer.pursuits(id) on delete cascade,
  profile_id uuid not null references producer.profile(id),
  seen_at    timestamptz not null default now()
);

comment on table producer.pursuit_seen is
  '你读到哪儿了。跟卡走，不跟浏览器走——换机器/换标签页都认这一份。';

-- 标记「读过了」。
--   p_at 传 null = 现在。传值是给「把旧的 localStorage 记录搬上来」用的。
--   时间只前进不后退：并发的两个标签页、或搬迁时撞上一次真实阅读，
--   都不该把已经读到的位置往回拨。
create or replace function public.pa_mark_seen(
  p_pursuit_id uuid,
  p_at         timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public, producer
as $$
declare pid uuid;
begin
  select id into pid from producer.profile limit 1;
  if pid is null then raise exception '库里没有 profile，pursuit_seen 挂不上人'; end if;

  insert into producer.pursuit_seen (pursuit_id, profile_id, seen_at)
  values (p_pursuit_id, pid, coalesce(p_at, now()))
  on conflict (pursuit_id) do update
    set seen_at = greatest(producer.pursuit_seen.seen_at, excluded.seen_at);
end
$$;

revoke all on function public.pa_mark_seen(uuid, timestamptz) from public;
grant execute on function public.pa_mark_seen(uuid, timestamptz) to anon, authenticated, service_role;

-- ══ 二、档案 ═══════════════════════════════════════════════════
-- 前端要读得到才谈得上显示和编辑。profile 是单例，视图不带 where。
create or replace view public.v_pa_profile as
  select p.id, p.name, p.website, p.data, p.updated_at
    from producer.profile p;

grant select on public.v_pa_profile to anon, authenticated, service_role;

-- 改档案。data 用 || 合并：传进来的键覆盖同名键，没传的原样留着。
-- （顶层键整个替换，所以 location 这种数组传新的就是换掉，不会拼接。）
create or replace function public.pa_set_profile(
  p_name    text  default null,
  p_website text  default null,
  p_data    jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, producer
as $$
begin
  update producer.profile
     set name       = coalesce(nullif(btrim(p_name), ''), name),
         website    = coalesce(nullif(btrim(p_website), ''), website),
         data       = case when p_data is null then data
                           else coalesce(data, '{}'::jsonb) || p_data end,
         updated_at = now()
   where singleton;
  if not found then raise exception '库里没有 profile'; end if;
end
$$;

revoke all on function public.pa_set_profile(text, text, jsonb) from public;
grant execute on function public.pa_set_profile(text, text, jsonb) to anon, authenticated, service_role;

-- ══ 三、对方来信 → Fairwind 出面说一句 ═════════════════════════
-- 为什么要有这条：红点的判据只认「最后一条是 Fairwind 说的」。对方回信是
-- role='org'，不点红点——真有人回你信，卡面上一点动静都没有。
--
-- 让 Fairwind 补一句告知，红点就还是一条规则，而且你看到的是一句人话
-- （谁回的、要什么），不是一个得自己点开翻的哑点。
--
-- 关键：这条告知由**收信入库的同一个操作**写，不是靠 Fairwind 记得写。
-- 结构上做不到「信到了但没告知」。
--
-- 告知的 created_at = 那封信 + 1 毫秒：它是**关于**那封信的，必须紧跟它排序；
-- 而且回填一封两个月前的旧信时，不该冒充成今天的新消息。
--
-- 自己发出去的（role='artist'）不写告知——你知道你发过。
--
-- 照 0025 的规矩：create or replace 必须整段重写，漏掉 security definer
-- 或 search_path 会悄悄改掉权限模型且不报错。
create or replace function public.pa_add_email(
  p_pursuit_id       uuid,
  p_role             text,
  p_gmail_message_id text,
  p_content          text,
  p_body_raw         text        default null,
  p_meta             jsonb       default null,
  p_created_at       timestamptz default null,
  p_kind             text        default 'email'
)
returns jsonb
language plpgsql
security definer
set search_path = public, producer
as $$
declare r producer.pursuit_messages; ins boolean := false; who text;
begin
  if p_role not in ('org', 'artist') then
    raise exception 'email 的 role 只能是 org|artist，收到 %', p_role;
  end if;
  if coalesce(btrim(p_gmail_message_id), '') = '' then
    raise exception 'gmail_message_id 不能为空——没有它就没法去重';
  end if;

  insert into producer.pursuit_messages
    (pursuit_id, role, kind, content, body_raw, gmail_message_id, meta, created_at)
  values
    (p_pursuit_id, p_role, p_kind, p_content, p_body_raw, p_gmail_message_id,
     coalesce(p_meta, '{}'::jsonb), coalesce(p_created_at, now()))
  on conflict (pursuit_id, gmail_message_id) where gmail_message_id is not null
  do nothing
  returning * into r;

  if found then
    ins := true;
  else
    select * into r from producer.pursuit_messages
     where pursuit_id = p_pursuit_id and gmail_message_id = p_gmail_message_id;
  end if;

  -- 新的、且是对方发来的 → 补一条告知
  if ins and p_role = 'org' then
    who := coalesce(nullif(btrim(coalesce(p_meta->>'from_name', '')), ''), '对方');
    insert into producer.pursuit_messages
      (pursuit_id, role, kind, content, meta, created_at)
    values
      (p_pursuit_id, 'producer', 'inbox',
       who || ' 回信了：' || coalesce(nullif(btrim(coalesce(p_content, '')), ''), '（正文见下）'),
       jsonb_build_object('about_message_id', r.id, 'subject', p_meta->>'subject'),
       r.created_at + interval '1 millisecond');
  end if;

  return jsonb_build_object('inserted', ins, 'message', to_jsonb(r));
end
$$;

revoke all on function public.pa_add_email(uuid,text,text,text,text,jsonb,timestamptz,text) from public, anon, authenticated;
grant execute on function public.pa_add_email(uuid,text,text,text,text,jsonb,timestamptz,text) to service_role;

-- ══ 四、未读搬进视图 ═══════════════════════════════════════════
-- 原来前端为了找「每张卡的最后一条消息」，每 8 秒把全库消息拉一遍
-- （loadPursuits 的 v_pa_pursuit_messages.select('*')）。PostgREST 默认封顶
-- 1000 行——超过之后只返回**最老的** 1000 条，新消息静悄悄不在里面，
-- 红点开始漏报且不报错。算在这里，首页就不用拉消息了。
--
-- 判据：最后一条消息是 Fairwind 说的、不是建卡那份 brief、且晚于你上次读。
--   · kind <> 'brief' —— brief 是卡自带的内容，不是找你说话。一批新卡造出来
--     每张的最后一句都是它，原来整批从出生起全亮。
--   · 兜底用 pursuits.created_at 而不是 1970 —— 新卡不该一出生就欠你一次点击。
create or replace view public.v_pa_pursuits as
  select p.id, p.title, p.kind, p.org, p.location, p.url, p.funding, p.deadline,
         p.match_stars, p.why, p.notes, p.source, p.eligible, p.stage, p.work_id,
         p.task_id, p.created_at, p.next_touch_at, p.payoff, p.contact_id,
         p.opens_at, p.deadline_at, p.next_action, p.next_action_done_at,
         p.last_touch_at, p.next_action_void_at, p.next_action_void_by,
         p.next_action_by, p.jot,
         w.title as work_title,
         c.name  as contact_name,
         c.role  as contact_role,
         p.ball, p.ball_at, b.ball_auto,
         case when b.manual_holds then p.ball else b.ball_auto end as ball_eff,
         -- ↓ 新增
         coalesce(
           last_msg.role = 'producer'
           and last_msg.kind is distinct from 'brief'
           and last_msg.created_at > coalesce(s.seen_at, p.created_at),
           false
         ) as unread,
         s.seen_at
    from producer.pursuits p
    left join producer.works w    on w.id = p.work_id
    left join producer.contacts c on c.id = p.contact_id
    left join producer.pursuit_seen s on s.pursuit_id = p.id
    left join lateral (
      select m.role, m.created_at
        from producer.pursuit_messages m
       where m.pursuit_id = p.id
         and m.role in ('org','artist')
         and m.kind = 'email'
       order by m.created_at desc
       limit 1
    ) last_ext on true
    left join lateral (
      select m.role, m.kind, m.created_at
        from producer.pursuit_messages m
       where m.pursuit_id = p.id
       order by m.created_at desc
       limit 1
    ) last_msg on true
    cross join lateral (
      select case
               when p.next_touch_at is not null and p.next_touch_at <= current_date then 'me'
               when last_ext.role = 'org'    then 'me'
               when last_ext.role = 'artist' then 'them'
               else null
             end as ball_auto,
             p.ball is not null
               and (p.ball_at is null
                    or (last_ext.created_at is null or last_ext.created_at <= p.ball_at)
                       and (p.next_touch_at is null
                            or p.next_touch_at > current_date
                            or p.next_touch_at <= p.ball_at::date)) as manual_holds
    ) b;

grant select on public.v_pa_pursuits to anon, authenticated, service_role;

-- 每张卡找「最后一条消息」都要走这个索引
create index if not exists pursuit_messages_pursuit_created_idx
  on producer.pursuit_messages (pursuit_id, created_at desc);
