-- 看板：九列并成七列，key 名改成跟列名对得上的词。
--
-- 为什么并：旧九格是照着「producer 在做什么」切的（讲懂 / 批准 / 挑作品），
-- 但「批准」和「挑作品」中间没有一次真正的停顿——你点头的那一下，
-- 接着就是挑作品，它们是同一件事的两个瞬间，不是两格。
-- 「不投」和「搁置」同理：都是这条线停下来了，为什么停下来是卡上的事，不是列的事。
--
-- 为什么改 key 名：旧 key 是按动作起的（brief = 渡在读），新列名是按状态起的
-- （待批准 = 等你点头）。两套词并存会让「看代码」和「看界面」对不上。
--
--   brief               → pending    待批准
--   proposed, pick_work → matching   匹配项目
--   writing             → writing    一起写（不变）
--   submitted           → sent       发出&提交
--   waiting             → replying   初次回信&继续沟通
--   won                 → won        谈成（不变）
--   declined, shelved   → paused     暂停处理

-- ── 先留后路 ───────────────────────────────────────────────────
-- 改之前把每张卡的旧 stage 抄一份。回滚就是一句 update ... from 这张表。
-- 用户是一边开发一边在用的，这份数据没有第二份。
create table if not exists producer.stage_backup_0015 as
  select id, stage as old_stage, now() as backed_up_at from producer.pursuits;

-- ── 迁数据 ─────────────────────────────────────────────────────
update producer.pursuits set stage = case stage
    when 'brief'     then 'pending'
    when 'proposed'  then 'matching'
    when 'pick_work' then 'matching'
    when 'submitted' then 'sent'
    when 'waiting'   then 'replying'
    when 'declined'  then 'paused'
    when 'shelved'   then 'paused'
    else stage
  end
 where stage in ('brief','proposed','pick_work','submitted','waiting','declined','shelved');

-- 默认值原本是 'proposed'。并列之后 proposed 变成了「匹配项目」——
-- 不改的话，没显式写 stage 的新卡会直接落进匹配项目，跳过你批准那一步。
alter table producer.pursuits alter column stage set default 'pending';

comment on column producer.pursuits.stage is
  'pending|matching|writing|sent|replying|won|paused';

-- ── 球权自动判断：名单换成新七值 ───────────────────────────────
-- 视图整段照抄 0013，只改 ② 那两行的 stage 名单和末尾注释。
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
           -- ② 没有外部往来时按阶段
           when p.stage in ('pending','matching','writing') then 'me'
           when p.stage in ('sent','replying')              then 'them'
           else null                       -- won / paused：没球可打
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
-- 脑子要扫「待批准里还没读的卡」，得能读这个视图。service_role 不吃 RLS，
-- 但视图的 select 权限还是得显式给。
grant select on public.v_pa_pursuits to service_role;

-- ── 移卡的写口 ─────────────────────────────────────────────────
-- pa_set_stage 一直是直接建在库里的（仓库里没有它的定义），内部卡着一份
-- 旧九值白名单——不换的话，拖卡到任何新列都会被它拒收。
-- 这里保持它原本的形状（returns void、同样的 search_path 和权限）原样重建，
-- 只把白名单换成新七值。create or replace 就够，不 drop，权限不会掉。
create or replace function public.pa_set_stage(p_pursuit_id uuid, p_stage text)
returns void
language plpgsql
security definer
set search_path to 'public', 'producer'
as $function$
begin
  if p_stage not in ('pending','matching','writing','sent','replying','won','paused') then
    raise exception 'bad stage: %', p_stage;
  end if;
  update producer.pursuits set stage = p_stage where id = p_pursuit_id;
  if not found then
    raise exception 'no pursuit: %', p_pursuit_id;
  end if;
end;
$function$;
