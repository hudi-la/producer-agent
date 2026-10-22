-- 名片上「他挂着的机会线」要按**班底**算，不是按 pursuits.contact_id。
--
-- contact_id 是单数，一条线只能指一个人。可一条线的对面从来不止一个人——
-- ASU 那条博士线上有三个：Weidi（引荐）、Ana、Biayna。按 contact_id 读的话
-- 只有 Weidi 的名片上看得见它，另外两位打开卡是「没挂机会线」——
-- 而她们正是这条线接下来要写信的对象。
--
-- 0052 建 pursuit_parties 就是为了装下这个。读面一直没接上。
create or replace view public.v_pa_contact_lines as
  select pp.contact_id, p.id as pursuit_id, p.title, p.stage, pp.note
    from producer.pursuit_parties pp
    join producer.pursuits p on p.id = pp.pursuit_id
  union
  -- 老数据里只写了 pursuits.contact_id、还没进班底表的，也算数。
  -- 不因为「结构升级了」就让旧的关系凭空消失。
  select p.contact_id, p.id, p.title, p.stage, null
    from producer.pursuits p
   where p.contact_id is not null
     and not exists (select 1 from producer.pursuit_parties x
                      where x.pursuit_id = p.id and x.contact_id = p.contact_id);

grant select on public.v_pa_contact_lines to anon, authenticated, service_role;

comment on view public.v_pa_contact_lines is
  '一个人挂在哪几条机会线上。按班底（pursuit_parties）算——一条线的对面从来不止一个人，contact_id 那个单数字段装不下';
