-- Producer Agent — 通知栏要存的全部东西
--
-- 由头本身**一条都不存**（现算，见 0072 + src/lib/cues.js）。
-- 存的只有这两张，而每一张都是**关于一个不会变的事实的**记录：
--
--   letter_verdicts —— 关于那一封信的内容，而信寄出去就不会再改
--   cue_marks       —— 关于某一条由头的身份（谁 + 哪种 + 依据哪天）
--
-- 设计稿：docs/specs/2026-08-18-notifications-design.md 第五、七、九节

-- ══ 一、这封信要不要回 ════════════════════════════════════════
--
-- 三层漏斗的第三层。前两层已经在 0045 里了：
--   ① mail_headers.bulk —— 信头里就看得出的群发 / no-reply，零成本
--   ② address_verdicts  —— 这个地址是不是真人，一地址一次
-- 第三层判的是真人写给你的、但**不需要你回**的那些：
-- 「谢谢，回头见」「收到了，月底再联系」。
--
-- **判一次、永远算数** —— 跟 address_verdicts 是同一种东西。
-- 它跟 next_action 那种「全局现在该干什么」根本不是一回事：
-- 那种判断新事实一来就分叉，这种不会，因为信的内容永远不变。
create table if not exists producer.letter_verdicts (
  gmail_message_id text primary key
    references producer.mail_headers(gmail_message_id) on delete cascade,
  needs_reply  boolean not null,
  not_before   date,           -- 要回，但不是现在（从他信里读出来的日子）
  why          text not null,  -- 一句人话，你看得见它凭什么这么判
  judged_at    timestamptz not null default now()
);

comment on table producer.letter_verdicts is
  '一封信要不要回、什么时候回。判一次永远算数——信的内容不会变，所以这个判断不会过期';
comment on column producer.letter_verdicts.not_before is
  '他信里说的时间锚点（circle back next semester）。必须是他说的，不许模型编';
comment on column producer.letter_verdicts.why is
  '凭什么这么判。判错了你得看得见理由才捞得回来';

-- ══ 二、你按的 ✓ 和 ✕ ═════════════════════════════════════════
--
-- 为什么 ✕ 也上库（cueoff.js 原来存 localStorage）：8/08 那次当场证死的
-- 事故——两个窗口同时开着同一个 localhost，顶栏「过卡」一个 1/2 一个 1/1，
-- 两份存储各记各的、刷新不会收敛。pa_seen 因此进了库；pa_cue_off 是
-- 同一个形状的地雷，只是还没踩到。通知栏一旦是唯一入口，
-- 踩到它的代价比过卡队列大得多：你在笔记本上处理完的一摊，
-- 回到台式机全部重新冒出来。
--
-- 键锚在**事实的日期**上，不是措辞上（src/lib/cues.js 的 cueKey）：
-- 「3 天没回」明天变「4 天没回」，拿措辞当键的话今天关掉的明天又冒出来。
-- 而他再回你一封新的，fact_at 就变了，这条由头理应重新出现。
create table if not exists producer.cue_marks (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references producer.profile(id),
  subject_kind text not null check (subject_kind in ('contact', 'pursuit')),
  subject_id   uuid not null,
  via          text not null,
  fact_at      date not null,
  mark         text not null check (mark in ('done', 'off')),
  marked_at    timestamptz not null default now(),
  unique (profile_id, subject_kind, subject_id, via, fact_at)
);

comment on table producer.cue_marks is
  'done=办完了 / off=先不看。分开存是为了「都放回来」只放回 off，不把真办完的翻出来';

-- profile_id 恒等于那唯一一行 profile。**带上它不是为了今天**——
-- 是为了以后真有第二个人时不用拆表（pursuit_seen 同一个做法）。

-- ══ 三、读面 ═══════════════════════════════════════════════════
create or replace view public.v_pa_letter_verdicts as
  select gmail_message_id, needs_reply, not_before, why, judged_at
    from producer.letter_verdicts;

create or replace view public.v_pa_cue_marks as
  select subject_kind, subject_id, via, fact_at, mark, marked_at
    from producer.cue_marks;

grant select on public.v_pa_letter_verdicts to anon, authenticated, service_role;
grant select on public.v_pa_cue_marks       to anon, authenticated, service_role;

-- ══ 四、写口 ═══════════════════════════════════════════════════

create or replace function public.pa_judge_letter(
  p_gmail_message_id text, p_needs_reply boolean,
  p_not_before date, p_why text)
returns boolean
language plpgsql
security definer
set search_path = public, producer
as $$
begin
  -- 信不在账本里就不判 —— 不许凭空造一行判定出来
  if not exists (select 1 from producer.mail_headers
                  where gmail_message_id = p_gmail_message_id) then
    return false;
  end if;
  insert into producer.letter_verdicts
              (gmail_message_id, needs_reply, not_before, why)
       values (p_gmail_message_id, p_needs_reply, p_not_before,
               coalesce(nullif(trim(p_why), ''), '（没说理由）'))
  on conflict (gmail_message_id) do update
     set needs_reply = excluded.needs_reply,
         not_before  = excluded.not_before,
         why         = excluded.why,
         judged_at   = now();
  return true;
end $$;

create or replace function public.pa_mark_cue(
  p_kind text, p_id uuid, p_via text, p_at date, p_mark text)
returns boolean
language plpgsql
security definer
set search_path = public, producer
as $$
declare v_profile uuid;
begin
  select id into v_profile from producer.profile limit 1;
  if v_profile is null then return false; end if;

  if p_mark is null then                       -- 撤销
    delete from producer.cue_marks
     where profile_id = v_profile and subject_kind = p_kind
       and subject_id = p_id and via = p_via and fact_at = p_at;
    return true;
  end if;

  insert into producer.cue_marks
              (profile_id, subject_kind, subject_id, via, fact_at, mark)
       values (v_profile, p_kind, p_id, p_via, p_at, p_mark)
  on conflict (profile_id, subject_kind, subject_id, via, fact_at) do update
     set mark = excluded.mark, marked_at = now();
  return true;
end $$;

-- 「都放回来」**永远留这条路**：关掉是看不见，看不见不许等于没有。
-- 只放回 off —— 你按错了 ✕ 能全捞回来，而不会把真办完的一起翻出来。
create or replace function public.pa_unmark_all_off()
returns integer
language plpgsql
security definer
set search_path = public, producer
as $$
declare n integer;
begin
  with gone as (delete from producer.cue_marks where mark = 'off' returning 1)
  select count(*) into n from gone;
  return n;
end $$;

grant execute on function public.pa_judge_letter(text, boolean, date, text)
  to anon, authenticated, service_role;
grant execute on function public.pa_mark_cue(text, uuid, text, date, text)
  to anon, authenticated, service_role;
grant execute on function public.pa_unmark_all_off()
  to anon, authenticated, service_role;
