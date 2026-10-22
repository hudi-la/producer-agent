-- Producer Agent — 人这一层：contacts 从「外联的附属」变成第一公民
--
-- 设计稿：docs/specs/2026-08-08-people-layer-design.md 第三节
--
-- 背景：0011 建 contacts 是为了冷外联——「信是发给人的，不是发给机构的。
-- 人才是会复利的资产」。但它只有 email 一个渠道、没有任何联系节奏，
-- 而且整张表实际上挂在机会线下面（前端只从 pursuits 上倒推得到几个名字）。
--
-- 这一刀之后它是第一公民：**人可以没有机会线而存在**。Maisa 就是这样一个人——
-- Tom Leeser 介绍的，回了你信，可他还没形成任何机会线，库里没地方放他。
--
-- 刻意没动 email 那一列：它上面的唯一索引（contacts_email_uniq）是去重的地基，
-- channels 是补充不是替代。为了整洁把地基拆了不值得。

alter table producer.contacts
  add column if not exists channels         jsonb not null default '[]'::jsonb,
  add column if not exists intro_by         uuid references producer.contacts(id) on delete set null,
  add column if not exists intro_thanked_at date,
  add column if not exists last_touch_at    date,
  add column if not exists last_touch_src   text,
  add column if not exists cadence_days     int,
  add column if not exists next_touch_at    date,
  add column if not exists next_touch_why   text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_touch_src_chk') then
    alter table producer.contacts add constraint contacts_touch_src_chk
      check (last_touch_src is null or last_touch_src in ('email', 'checkin', 'meet'));
  end if;
end $$;

comment on column producer.contacts.channels is
  '[{kind,value,primary}]，kind ∈ email|wechat|sms|whatsapp|ig|phone。用 jsonb 不用列：渠道会一直长（IG DM 在当代艺术圈是真渠道，迟早要），列会一直加';
comment on column producer.contacts.last_touch_src is
  '上次碰的日期从哪来：email=库里那封信 / checkin=你打卡 / meet=你记的线下一笔。没有这一列，那个日期就是来路不明的数字';
comment on column producer.contacts.next_touch_at is
  '什么时候再碰他。跟 pursuits.next_touch_at 同名同义——同一个引擎不该有两个名字';
comment on column producer.contacts.next_touch_why is
  '这个日子哪来的，存原话（他说 "circle back next semester"）。认不出来就两列都不写，不猜';
comment on column producer.contacts.cadence_days is
  '你给这个人定的节奏。null = 不管他——大多数人都该是 null';
comment on column producer.contacts.intro_by is
  '谁介绍的。美国 warm intro 有个闭环：过阵子单独回介绍人一句「跟他聊了，谢谢」。大多数人不做这一步';

create index if not exists contacts_next_touch_idx
  on producer.contacts (next_touch_at) where next_touch_at is not null;

-- ── 视图：加新列，并开给 anon ──────────────────────────────────
--
-- 0011 当时把这张视图 revoke 掉了 anon（notes 里有私人内容），可整个 app 走的
-- 正是 anon、没有登录。而邮件正文（v_pa_pursuit_messages）从 0027 起就对 anon
-- 开着了——contacts 一直关着是个**不一致，不是一道真的墙**。这儿把它补齐。
--
-- 收紧登录是另一刀（设计稿缓办五）。不在这儿偷偷做，也不在这儿假装已经做了。
drop view if exists public.v_pa_contacts;
create view public.v_pa_contacts as
  select id, name, email, org, role, notes, channels,
         intro_by, intro_thanked_at,
         last_touch_at, last_touch_src, cadence_days,
         next_touch_at, next_touch_why,
         created_at, updated_at
    from producer.contacts;

grant select on public.v_pa_contacts to anon, authenticated, service_role;
