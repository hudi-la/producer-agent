-- 收件人是一份**你勾出来的名单**，不是一个字符串。
--
-- 0068 把 meta.to 存成单个地址，因为当时只想着「回给发件人」。真用了一次
-- 就撞墙了：Huntington 那封要回给两个人，而界面上只有一个地址、没有抄送，
-- 于是那封信没法安心发 ——「我不确定是几个人」。
--
-- 名单本身从账本算（0070 的 pa_reply_recipients），这支只管**存你勾的结果**。
--
-- ══ 为什么 to 改成数组而不是再加一个 also 列 ══════════════════
-- 「主收件人 + 附加收件人」是个假的区分：RFC 里 To 就是一个列表，Gmail 里
-- 也是。硬分成两格的话，每一处用到它的地方都要记得把两格拼起来 ——
-- 漏拼一处，那封信就少发给一个人，而且**发出去了才知道**。
--
-- 老数据里 meta.to 是字符串。不迁移、也不改写老行：读的那头（brain 的
-- handleSendMail、界面）两种都认。已经发出去的信里那个 to 是历史记录，
-- 改它没有意义，还可能改错。
--
-- 照 0025 的规矩：create or replace 必须整段重写，漏掉 security definer
-- 或 search_path 会悄悄改掉权限模型且不报错。
create or replace function public.pa_set_recipients(
  p_id uuid, p_to text[] default '{}', p_cc text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public, producer
as $$
declare
  st text; k text;
  v_to text[]; v_cc text[];
begin
  select status, kind into st, k from producer.deliverables where id = p_id;
  if not found then raise exception 'no deliverable: %', p_id; end if;
  if k <> 'email' then raise exception '这份产出不是一封信（kind=%），没有收件人可勾', k; end if;
  -- 跟 pa_edit_deliverable 一样：定稿的改不动。
  -- 对信来说「定稿」其实是「发出去了」——发出去之后改收件人是自欺欺人。
  if st = 'final' then raise exception '已经发出去了，改收件人没有意义'; end if;

  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_to
    from unnest(coalesce(p_to, '{}')) e where btrim(coalesce(e,'')) like '%@%';
  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_cc
    from unnest(coalesce(p_cc, '{}')) e where btrim(coalesce(e,'')) like '%@%';

  -- 一个人都不剩就拦住。空名单的信「发出去」了却谁也收不到，
  -- 而界面会显示已发送 —— 那是这套东西最不该撒的那种谎。
  if array_length(v_to, 1) is null then
    raise exception '收件人一个都没勾，这封信发出去谁也收不到';
  end if;

  -- 同一个人既在 To 又在 Cc 的话，Cc 里去掉：对方会收到两份一模一样的信头，
  -- 有些客户端还会显示成两条。
  select coalesce(array_agg(e), '{}') into v_cc
    from unnest(v_cc) e where not (e = any(v_to));

  update producer.deliverables
     set meta = coalesce(meta, '{}'::jsonb)
                || jsonb_build_object('to', to_jsonb(v_to), 'cc', to_jsonb(v_cc))
   where id = p_id;
end $$;

revoke all on function public.pa_set_recipients(uuid, text[], text[]) from public;
grant execute on function public.pa_set_recipients(uuid, text[], text[])
  to anon, authenticated, service_role;

comment on function public.pa_set_recipients(uuid, text[], text[]) is
  '存你在页面上勾出来的收件人和抄送。to 空了当场拒——空名单的信发出去谁也收不到，而界面会显示已发送。';
