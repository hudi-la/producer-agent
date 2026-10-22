-- Producer Agent — 草稿不是信
--
-- 病：通讯录上 Ana Herruzo 写着「5 封」，可只发过 1 封。
--
-- 病根：Gmail 里改一次草稿就生成一个新 message id，而收信两条路都会抓到它——
--   · listIds 的 q 是 `-in:chats`，只排掉了聊天，**Gmail 搜索默认包含草稿**
--   · 增量走 historyTypes:['messageAdded']，**草稿每存一次就是一个 messageAdded**
-- 收信循环每 5 分钟一轮，一轮抓走一份当时的草稿。Ana 那四条的
-- sent_at 是 05:33 / 05:37 / 05:46 / 05:53，收进来的时间是
-- 05:35 / 05:40 / 05:50 / 05:55 —— 一轮一条，对得严丝合缝。
--
-- 后果不只是数字难看：「你发出去 N 天没回音」会把草稿算成发出，
-- 于是那条线上的等待期从你**第一次存草稿**那一刻就开始算了。
--
-- 入口已经堵住（brain/mail/addr.js 的 classify：labelIds 含 DRAFT 就不入库）。
-- 这一支管**已经进来的那些**。
--
-- ══ 怎么认出来的：逐条问 Gmail，不靠猜 ═══════════════════════════
--
-- 嫌疑名单是「direction='out' 且没主题」，22 条。**但这只是嫌疑**——
-- 拿去 Gmail 逐条核 labelIds 之后：
--   ·  7 条 [DRAFT]  —— 确认是草稿，现在还躺在草稿箱里
--   ·  6 条 [SENT]   —— **是真信**，只是没写主题。一个字都不许动。
--   ·  9 条 Gmail 里已经没有了 —— 草稿发出后 Gmail 会丢掉草稿的 id
--
-- 那 9 条不能因为「没了」就判成草稿，所以又查了一层：它们全部落在两个
-- 会话里，每个会话里都有一封主题为「Introduction from Weidi Zhang —
-- DEA PhD, fall 2027」的真信，时间就在它们之后几分钟。是那封信的草稿。
--
-- **「没主题」这个猜测本身是不可靠的** —— 22 条里有 6 条是真信。
-- 幸好核过再动手。

-- ══ 一、账本上记下这件事 ═══════════════════════════════════════
alter table producer.mail_headers
  add column if not exists is_draft boolean not null default false;

comment on column producer.mail_headers.is_draft is
  '这一行是 Gmail 草稿的自动保存，不是发出去的信。逐条核过 labelIds 认定的，不是按主题猜的';

update producer.mail_headers set is_draft = true
 where gmail_message_id in (
   -- 确认在草稿箱里的 7 条
   '19100a52c1d076ac','1932daf24f14086b','196032dc7fc2bd48','1966a9054f581da0',
   '198d29b61b645eac','19b90d354716df75','19e6fdf4b6bbac4b',
   -- Gmail 里已没有、且同会话内被一封真信顶替的 9 条
   '1a00e0429f1fe315','1a00e2d38f34ab8e','1a00e32cd5f181ec','1a00e3649ac06e4a',
   '1a00e3936d47282e','1a00e420711bed37','1a00e47d8891c0bc','1a00e570a6d77b5c',
   '1a00e5b31e4993a7');

-- ══ 二、往来表里那几行改名，**不删** ═══════════════════════════
--
-- 它们是你真写过的东西，只是不该算成「发出去的信」。删掉就是替你决定
-- 那几稿不值得留——那不是这个项目的规矩。
--
-- 用 'gmail_draft' 而不是现成的 'draft'：'draft' 在这张表里已经有主人了
-- （Fairwind 起草的那种）。两件事共用一个标签，就是这一整刀在治的病。
update producer.pursuit_messages m set kind = 'gmail_draft'
  from producer.mail_headers h
 where h.gmail_message_id = m.gmail_message_id
   and h.is_draft and m.kind <> 'gmail_draft';

comment on table producer.pursuit_messages is
  'kind: message|email|brief|draft|decision|note|meet|gmail_draft。gmail_draft = Gmail 草稿的自动保存，留着但不算往来';

-- ══ 三、以后再有漏网的，库这边也拦一道 ═════════════════════════
--
-- 入口在 brain 里堵着（classify）。但 pa_add_mail 是**任何**收信路径的
-- 必经之处，在这儿再拦一次是防御纵深：将来谁换了收信实现、或者手工灌一批，
-- 都不会把草稿灌成往来。
create or replace function public.pa_mark_draft(p_gmail_message_id text)
returns boolean
language plpgsql
security definer
set search_path = public, producer
as $$
begin
  update producer.mail_headers set is_draft = true
   where gmail_message_id = p_gmail_message_id;
  update producer.pursuit_messages set kind = 'gmail_draft'
   where gmail_message_id = p_gmail_message_id;
  return found;
end $$;

grant execute on function public.pa_mark_draft(text) to service_role;
