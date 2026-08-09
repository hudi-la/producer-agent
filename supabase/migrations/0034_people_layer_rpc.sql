-- Producer Agent — 人这一层的写口
--
-- 设计稿：docs/specs/2026-08-08-people-layer-design.md
--
-- 跟 0009 / 0027 一个姿势：每个口都只能碰它该碰的行，**护栏在函数里，
-- 不在提示词里**。Fairwind 拿到的写口仍然只能碰 status='draft'——
-- 已定稿的它改不动、删不掉，也没有把 draft 变 final 的口。
-- 定稿是你的手（pa_set_final，走 anon 浏览器直连）。

-- ══ 一、往人身上写消息 ═════════════════════════════════════════
create or replace function public.pa_add_contact_message(
  p_contact_id uuid,
  p_role       text,
  p_content    text,
  p_kind       text  default 'message',
  p_meta       jsonb default '{}'::jsonb
) returns producer.pursuit_messages
language plpgsql security definer set search_path = public as $$
declare r producer.pursuit_messages;
begin
  insert into producer.pursuit_messages (contact_id, role, kind, content, meta)
  values (p_contact_id, p_role,
          coalesce(nullif(btrim(p_kind), ''), 'message'), p_content,
          coalesce(p_meta, '{}'::jsonb))
  returning * into r;

  -- 线下见了一面记一笔 —— 一条记录同时干三件事：
  -- 更新「上次碰」、触发 48 小时由头、留下「上次聊到哪」。不是三个功能，是同一笔。
  -- 来源写 meet，日期就永远说得出出处。
  if p_role = 'note' and p_kind = 'meet' then
    update producer.contacts
       set last_touch_at = current_date, last_touch_src = 'meet'
     where id = p_contact_id;
  end if;

  return r;
end $$;
grant execute on function public.pa_add_contact_message(uuid, text, text, text, jsonb)
  to anon, authenticated, service_role;

-- ══ 二、往人身上写邮件（brain 收信用）══════════════════════════
-- 校验跟 0027 的 pa_add_email 一模一样，一条不减。
create or replace function public.pa_add_contact_email(
  p_contact_id       uuid,
  p_role             text,
  p_gmail_message_id text,
  p_content          text,
  p_body_raw         text        default null,
  p_meta             jsonb       default '{}'::jsonb,
  p_created_at       timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r producer.pursuit_messages; ins boolean := false;
begin
  if p_role not in ('org', 'artist') then
    raise exception 'email 的 role 只能是 org|artist，收到 %', p_role;
  end if;
  if coalesce(btrim(p_gmail_message_id), '') = '' then
    raise exception 'gmail_message_id 不能为空——没有它就没法去重';
  end if;

  insert into producer.pursuit_messages
    (contact_id, role, kind, content, body_raw, gmail_message_id, meta, created_at)
  values (p_contact_id, p_role, 'message', p_content, p_body_raw, p_gmail_message_id,
          coalesce(p_meta, '{}'::jsonb), coalesce(p_created_at, now()))
  on conflict (contact_id, gmail_message_id) where contact_id is not null and gmail_message_id is not null
  do nothing
  returning * into r;

  if found then
    ins := true;
  else
    select * into r from producer.pursuit_messages
     where contact_id = p_contact_id and gmail_message_id = p_gmail_message_id;
  end if;

  -- 收到信就是碰过了。只前进不后退——同步顺序不保证，别让一封旧信把日期往回拨。
  update producer.contacts
     set last_touch_at = greatest(coalesce(last_touch_at, date '1900-01-01'),
                                  coalesce(p_created_at, now())::date),
         last_touch_src = 'email'
   where id = p_contact_id;

  return jsonb_build_object('inserted', ins, 'message', to_jsonb(r));
end $$;
grant execute on function public.pa_add_contact_email(uuid, text, text, text, text, jsonb, timestamptz)
  to service_role;

-- 同一个人同一封信不能进两次（对应 0027 那条 pm_gmail_uniq）。
-- 上面那句 on conflict 指的就是它——**索引必须先建**，不然 do nothing 落不到位。
create unique index if not exists pm_gmail_contact_uniq
  on producer.pursuit_messages (contact_id, gmail_message_id)
  where contact_id is not null and gmail_message_id is not null;

-- ══ 三、产出也能挂人 ═══════════════════════════════════════════
-- 三条硬约束跟 0027 那个一模一样：只能碰自己这个人的、只能碰 draft、
-- 没有把 draft 变 final 的路径。不是嘱咐，是这个函数里没有那条分支。
create or replace function public.pa_upsert_contact_deliverable(
  p_contact_id uuid,
  p_id         uuid  default null,
  p_kind       text  default 'email',
  p_title      text  default '未命名',
  p_body       text  default null,
  p_rules      jsonb default null,
  p_source     text  default null,
  p_due        date  default null,
  p_meta       jsonb default null,
  p_sort       int   default 100
) returns producer.deliverables
language plpgsql security definer set search_path = public as $$
declare r producer.deliverables;
begin
  if p_id is null then
    insert into producer.deliverables
      (contact_id, kind, title, body, rules, source, due, meta, sort, created_by, status)
    values (p_contact_id, p_kind, p_title, p_body, coalesce(p_rules, '{}'::jsonb),
            p_source, p_due, coalesce(p_meta, '{}'::jsonb), p_sort, 'fairwind', 'draft')
    returning * into r;
  else
    update producer.deliverables set
      kind   = coalesce(p_kind, kind),
      title  = coalesce(p_title, title),
      body   = coalesce(p_body, body),
      rules  = coalesce(p_rules, rules),
      source = coalesce(p_source, source),
      due    = coalesce(p_due, due),
      meta   = coalesce(p_meta, meta),
      sort   = coalesce(p_sort, sort)
     where id = p_id and contact_id = p_contact_id and status = 'draft'
     returning * into r;
    if r.id is null then
      raise exception '改不动：要么不是这个人的产出，要么已经定稿了';
    end if;
  end if;
  return r;
end $$;
grant execute on function public.pa_upsert_contact_deliverable(uuid, uuid, text, text, text, jsonb, text, date, jsonb, int)
  to service_role;

-- ══ 四、认领一条邮件往来到人身上 ═══════════════════════════════
-- 0027 立过一条原则：同步**只拉登记过的 thread，永远不遍历信箱**。
-- 这个口就是「登记」那一下，人这边的版本。
create or replace function public.pa_claim_contact_thread(
  p_contact_id uuid, p_thread_id text
) returns void
language sql security definer set search_path = public as $$
  insert into producer.pursuit_threads (contact_id, gmail_thread_id, added_by)
  values (p_contact_id, btrim(p_thread_id), 'you')
  on conflict (contact_id, gmail_thread_id) where contact_id is not null
  do nothing;
$$;
grant execute on function public.pa_claim_contact_thread(uuid, text)
  to anon, authenticated, service_role;

-- 同步到哪儿了。收完信 brain 来盖一下时间戳。
create or replace function public.pa_touch_contact_thread(
  p_contact_id uuid, p_thread_id text, p_history_id text default null
) returns void
language sql security definer set search_path = public as $$
  update producer.pursuit_threads
     set last_synced_at   = now(),
         last_history_id  = coalesce(p_history_id, last_history_id)
   where contact_id = p_contact_id and gmail_thread_id = p_thread_id;
$$;
grant execute on function public.pa_touch_contact_thread(uuid, text, text) to service_role;

-- ══ 五、建 / 改一个人 ══════════════════════════════════════════
-- 名片上每一格都能改——「档案能改」那一刀定的规矩。
-- 传 null 的字段一律不动（coalesce），所以改一格不用把整张名片重发一遍。
create or replace function public.pa_upsert_contact(
  p_id             uuid  default null,
  p_name           text  default null,
  p_email          text  default null,
  p_org            text  default null,
  p_role           text  default null,
  p_notes          text  default null,
  p_channels       jsonb default null,
  p_intro_by       uuid  default null,
  p_next_touch_at  date  default null,
  p_next_touch_why text  default null,
  p_cadence_days   int   default null
) returns producer.contacts
language plpgsql security definer set search_path = public as $$
declare r producer.contacts;
begin
  if p_id is null then
    insert into producer.contacts
      (name, email, org, role, notes, channels, intro_by,
       next_touch_at, next_touch_why, cadence_days)
    values (p_name, nullif(btrim(p_email), ''), p_org, p_role, p_notes,
            coalesce(p_channels, '[]'::jsonb), p_intro_by,
            p_next_touch_at, p_next_touch_why, p_cadence_days)
    returning * into r;
  else
    update producer.contacts set
      name           = coalesce(p_name, name),
      email          = coalesce(nullif(btrim(p_email), ''), email),
      org            = coalesce(p_org, org),
      role           = coalesce(p_role, role),
      notes          = coalesce(p_notes, notes),
      channels       = coalesce(p_channels, channels),
      intro_by       = coalesce(p_intro_by, intro_by),
      next_touch_at  = coalesce(p_next_touch_at, next_touch_at),
      next_touch_why = coalesce(p_next_touch_why, next_touch_why),
      cadence_days   = coalesce(p_cadence_days, cadence_days)
     where id = p_id
     returning * into r;
    if r.id is null then raise exception '没有这个人：%', p_id; end if;
  end if;
  return r;
end $$;
grant execute on function public.pa_upsert_contact(uuid, text, text, text, text, text, jsonb, uuid, date, text, int)
  to anon, authenticated, service_role;

-- ══ 六、回谢了 ═════════════════════════════════════════════════
-- 只写时间戳，由头③ 立刻不再提。跟「勾掉下一步」一个道理：
-- 记录的是你做过这件事，不是把这件事抹掉。
create or replace function public.pa_mark_intro_thanked(p_contact_id uuid)
returns void language sql security definer set search_path = public as $$
  update producer.contacts set intro_thanked_at = current_date where id = p_contact_id;
$$;
grant execute on function public.pa_mark_intro_thanked(uuid) to anon, authenticated, service_role;

-- ══ 七、Fairwind 读一个人的上下文 ══════════════════════════════
-- pa_brain_context 的人版。形状**故意跟它一模一样**（同样的键、同样的顺序），
-- 好让 brain 那边一套 prompt 两边都能用——照抄两份迟早会分叉。
--
-- 差别只有一处：'pursuit' 那一格装的是这个人的名片 + 他挂着的机会线标题，
-- 因为 prompt 里那句「这条线是什么」对人来说就是「这个人是谁」。
create or replace function public.pa_brain_person_context(p_contact_id uuid)
returns jsonb
language sql
security definer
set search_path = public, producer
as $$
  select jsonb_build_object(
    'contact', (
      select to_jsonb(x) from (
        select c.*,
               (select i.name from producer.contacts i where i.id = c.intro_by) as intro_by_name,
               coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'stage', p.stage))
                           from producer.pursuits p where p.contact_id = c.id), '[]'::jsonb) as pursuits
          from producer.contacts c where c.id = p_contact_id
      ) x
    ),
    'messages', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created_at)
      from producer.pursuit_messages m where m.contact_id = p_contact_id
    ), '[]'::jsonb),
    'deliverables', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.sort, d.created_at)
      from producer.deliverables d where d.contact_id = p_contact_id
    ), '[]'::jsonb),
    'threads', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at)
      from producer.pursuit_threads t where t.contact_id = p_contact_id
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'title', e.title, 'body', e.body, 'concern', e.concern,
        'year', e.year, 'medium', e.medium, 'site_path', e.site_path, 'box', e.box,
        'meta', e.meta, 'tags', e.tags
      ) order by e.kind, e.sort)
      from producer.works e
    ), '[]'::jsonb),
    'profile', (select to_jsonb(pr) from producer.profile pr limit 1)
  );
$$;

revoke all on function public.pa_brain_person_context(uuid) from public, anon, authenticated;
grant execute on function public.pa_brain_person_context(uuid) to service_role;

-- ══ 八、打卡「聊过了」════════════════════════════════════════════
-- 微信 / 电话 / 线下聊完，你按一下。系统看不见那些渠道——
-- **它不知道就不假装知道**，靠你这一下。来源写 checkin，日期说得出出处。
create or replace function public.pa_contact_checkin(p_contact_id uuid)
returns void language sql security definer set search_path = public as $$
  update producer.contacts
     set last_touch_at = current_date, last_touch_src = 'checkin'
   where id = p_contact_id;
$$;
grant execute on function public.pa_contact_checkin(uuid) to anon, authenticated, service_role;
