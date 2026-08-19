-- Producer Agent — 账本的真假认标签，不认形态
--
-- 起因：「你截了两条我就改那两条」是不够的。把**整本账**拿去问 Gmail：
-- 3519 封信头逐封要 labelIds，结果落 producer.mail_label_audit。
--
-- ══ 全量核对的结果 ═════════════════════════════════════════════
--
--   真收到（收件箱）  in    3081   其中 451 封进了往来表
--   真发出            out    392   其中 356 封
--   Gmail 里已经没有   out     29   其中  25 封  ← 草稿发出后被丢掉的 id
--   草稿              out     15   其中   9 封
--   投递回来的那一份   out      1   其中   1 封  ← 定时发送，见下
--   已归档的来信      in       1
--
-- 44 封草稿（15 DRAFT + 29 gone）跟之前两轮标的**完全对得上**，没有漏网的。
-- 那 29 封「已经没有了」逐个核过：**全部**在同会话里有真发出的信顶替 ——
-- 是草稿发出后 Gmail 丢掉的 id，不是你删掉的真信。这条现在有权威依据。
--
-- ══ 但查出一种新的「没发生的事」 ═══════════════════════════════
--
-- 有一封「Zoom meeting」：我们记成 out，可 Gmail 没给它 SENT 标签，
-- 而且 sent_at 是 **2026-08-25 —— 还没到**。那是一封**定时发送**：
-- 写好了排着队，八天后才发。8/18 它就已经在账本里算作「我发出去了」。
--
-- 跟草稿是同一类病：**没发生的事被当成发生了。**
--
-- ══ 判据 ═══════════════════════════════════════════════════════
--
-- **我发出去的信一定有 SENT。** 没有 SENT 又是我发的 → 它还没发出去。
-- 这条比「时间在未来」更根本，也比「没有主题」可靠得多 ——
-- 后者已经错过一次（0081：回信的草稿会继承 Re: 主题）。
--
-- 入口在 brain/mail/addr.js 的 classify 里堵住了（DRAFT 一道、缺 SENT 一道）。
-- 这一支管已经进来的那一封。

-- 那封定时发送的信：标成还没发出去。**行不删** —— 它是你真写过的东西。
update producer.mail_headers h set is_draft = true
  from producer.mail_label_audit a
 where a.gmail_message_id = h.gmail_message_id
   and h.direction = 'out'
   and not a.gone and a.labels is not null
   and not ('SENT' = any(a.labels))
   and not ('DRAFT' = any(a.labels));

update producer.pursuit_messages m set kind = 'gmail_draft'
  from producer.mail_headers h
 where h.gmail_message_id = m.gmail_message_id
   and h.is_draft and m.kind <> 'gmail_draft';

-- 以后要重核，从这两个口子走。**不筛主题、不猜形态、不看时间**，
-- 全量拿去问 Gmail。分页是必须的：PostgREST 默认封顶 1000 行而且**不报错**
-- ——第一次跑这个审计时就中了，3519 封只核了 1000 封还以为核完了。
create or replace function public.pa_mail_ids_page(p_after text default null, p_limit int default 500)
returns jsonb
language sql security definer set search_path = public, producer as $$
  select coalesce(jsonb_agg(x.gmail_message_id order by x.gmail_message_id), '[]'::jsonb)
    from (select h.gmail_message_id from producer.mail_headers h
           where (p_after is null or h.gmail_message_id > p_after)
             and not exists (select 1 from producer.mail_label_audit a
                              where a.gmail_message_id = h.gmail_message_id)
           order by h.gmail_message_id
           limit p_limit) x
$$;
grant execute on function public.pa_mail_ids_page(text, int) to service_role;

comment on function public.pa_mail_ids_page(text, int) is
  '还没核过标签的信头，分页取。PostgREST 那个 1000 行封顶不报错，所以必须分页';
