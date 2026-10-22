-- Producer Agent — 「没主题」那个猜测是错的，草稿比想的多
--
-- 病：通知栏说「Brooke Applegate · 已经碰过 4 次，停了」。
--     碰满三次就停，是这个项目定的规矩（cues.js 的 BUMP_WAIT）——
--     **等于劝你放弃这条线**。可真查下来你只跟进过一次。
--
-- 病根：0075 认草稿时，嫌疑名单用的是「direction='out' 且**没有主题**」。
--     那一批确实全是新起的信，草稿没填主题。
--     **但回信的草稿会继承主题**（`Re: Partnering on a class…`），
--     所以 8/16 那天 01:10、01:16、01:21、01:22 四封十二分钟内、
--     同一会话、正文几乎一样的「草稿」，一条都没被点名。
--
--     换句话说：那个猜测在它自己那批数据上看着挺准，出了那批就不成立。
--     **靠形态猜，早晚会漏；只有问 Gmail 才是权威。**
--
-- 药：把**所有** direction='out' 的信头（421 封）一次性拿去问 Gmail 的
--     labelIds。结果：真发出 393 · 草稿 8 · Gmail 里已经不存在 20。
--
--     那 20 条按 0075 同一条规矩核过：落在 9 个会话里，每个会话里都还有
--     真发出的信 —— 是草稿发出后被 Gmail 丢掉的那个 id。
--
-- 结果：Brooke 5 封 → 2 封（碰过 1 次，还没到停的地步）
--       Stacy  3 封 → 1 封
--       两条「停了」整个消失。
--
-- 入口那道闸（brain/mail/addr.js 的 classify：labelIds 含 DRAFT 就不入库）
-- 是 0075 装的，以后不会再进。这一支只管入口装好之前漏进来的。

update producer.mail_headers set is_draft = true
 where gmail_message_id in (
   -- Gmail 现在还标着 DRAFT 的 8 条
   '19e6d17bd9c3c3df','19c432195ea93444','19756182aaee8aa4','1975617b6019a5c1',
   '19755e232fa8ddf9','19752e6b9151af16','196930665ae85ef2','19658dcfc9992b63',
   -- Gmail 里已经不存在、且同会话内有真信顶替的 20 条
   '1a0174b4af06de2c','1a01744aa7536065','1a015d2c4fa46fd3','1a011a7dee8a5cc3',
   '1a00e5ff9fccf716','1a00851acbf7d63b','1a0084d1797a518a','1a0082d6c242641e',
   '1a00828a3041ef94','1a0082404e10497a','1a0081ea08839819','1a00312b036bbb35',
   '1a00308f2ed77f00','1a003074f3c5d70c','1a00302068a07f4b','1a0025c1e026a545',
   '1a002570721b5a07','1a0024cbcc405bac','19ffdb3bf4754934','19ffdaa9bb4187f3');

update producer.pursuit_messages m set kind = 'gmail_draft'
  from producer.mail_headers h
 where h.gmail_message_id = m.gmail_message_id
   and h.is_draft and m.kind <> 'gmail_draft';

-- 以后再要核，从这儿拿名单：**所有还没标过的发出信**，不筛主题、不猜形态。
-- 一次 421 封，Gmail 一轮就答完。
create or replace function public.pa_outgoing_to_verify()
returns table (gmail_message_id text)
language sql security definer set search_path = public, producer as $$
  select h.gmail_message_id from producer.mail_headers h
   where h.direction = 'out' and not h.is_draft
   order by h.sent_at desc
$$;
grant execute on function public.pa_outgoing_to_verify() to service_role;

-- 那个按主题猜的函数删掉 —— 留着它，下次还会有人拿它当名单。
drop function if exists public.pa_suspect_drafts();
