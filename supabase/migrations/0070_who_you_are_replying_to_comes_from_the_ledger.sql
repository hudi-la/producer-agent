-- 「回给谁」从信头账本算，不让模型猜。
--
-- ══ 真事 ══════════════════════════════════════════════════════
-- 2026-08-18 试用直发：Huntington 那封 Re: Workshop Proposal 实际上要回给
-- **两个人**（发件人 + 原信 To 里另一个）。而界面上只摆着模型挑出来的
-- 一个地址，抄送一个字都没有。于是那封信没法安心发出去 ——
-- 「我不确定是几个人」，就只好切回 Gmail 手动 reply all。
--
-- ══ 为什么这件事一次模型都不该花 ══════════════════════════════
-- 答案早就在库里：mail_headers 存着每封信的 from / to_emails / cc_emails，
-- 3512 条信头全部带 RFC Message-ID。「回这封信要发给谁」就是一次查表，
-- 精确、零成本、而且**不会编**。
--
-- 这跟 0060（人的往来从账本翻，不问模型）是同一条道理，而且更要紧：
-- 找信找漏了还能再找一次，收件人猜错了是**撤不回来的**。
--
-- ══ 这支函数不替你做决定 ══════════════════════════════════════
-- 它只回答「原信上都有谁」，分成三档交出去：
--   sender  发件人 —— 你回信的主要对象
--   others  原信 To 里除你之外的其他人
--   cc      原信抄送里除你之外的人
-- **默认勾谁是界面的事，不是这儿的事。** 这儿只负责把名单摆全 ——
-- 少摆一个人，你就会像那天一样不敢按发送。
--
-- 照 0025 的规矩：create or replace 必须整段重写，漏掉 security definer
-- 或 search_path 会悄悄改掉权限模型且不报错。
create or replace function public.pa_reply_recipients(p_message_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, producer
as $$
declare
  h producer.mail_headers;
  mine text[];
begin
  if coalesce(btrim(p_message_id), '') = '' then
    return jsonb_build_object('found', false, 'why', '没给原信的 Message-ID');
  end if;

  -- 认的是 RFC 的 Message-ID（信头里那个 <...@...>），不是 Gmail 的 id。
  -- 跨地址、跨客户端它都成立，见 0054。
  select * into h from producer.mail_headers
   where message_id = btrim(p_message_id)
   limit 1;

  if not found then
    -- 找不到不等于「没有人」。说清楚是找不到，别交出一份空名单 ——
    -- 空名单在界面上跟「只回发件人」长得一样，那是在骗人。
    return jsonb_build_object('found', false, 'why', '账本里没有这封信（可能还没同步到）');
  end if;

  -- 「我」有哪些地址：信箱账号 + 通讯录里登记成我的。回信时一律剔掉自己。
  select coalesce(array_agg(distinct lower(btrim(a))), '{}')
    into mine
    from (select address as a from producer.mail_accounts) x
   where a is not null and a <> '';

  return jsonb_build_object(
    'found', true,
    'subject', h.subject,
    'sent_at', h.sent_at,
    -- 发件人：你回信的主要对象。它自己就是「我」的话（你回自己发的信）就空着。
    'sender', case when lower(h.from_email) = any(mine) then null else h.from_email end,
    'sender_name', h.from_name,
    'others', coalesce((select array_agg(distinct e) from unnest(h.to_emails) e
                         where e is not null and e <> ''
                           and e <> lower(h.from_email) and not (e = any(mine))), '{}'),
    'cc',     coalesce((select array_agg(distinct e) from unnest(h.cc_emails) e
                         where e is not null and e <> ''
                           and e <> lower(h.from_email) and not (e = any(mine))), '{}'));
end $$;

-- 你的手要用它（页面上那份勾选名单），所以给 anon。
revoke all on function public.pa_reply_recipients(text) from public;
grant execute on function public.pa_reply_recipients(text)
  to anon, authenticated, service_role;

comment on function public.pa_reply_recipients(text) is
  '回这封信该发给谁：从 mail_headers 按 RFC Message-ID 查出发件人 / 原信其他收件人 / 抄送，各自剔掉我自己。只摆名单，不替你决定勾谁。';
