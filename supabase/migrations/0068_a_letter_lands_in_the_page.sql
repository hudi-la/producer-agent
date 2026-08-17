-- 「Fairwind 写的信从来进不了产出」—— 从根上治。
--
-- ══ 真事 ══════════════════════════════════════════════════════
-- PersonFocus 上写着「在中栏跟 Fairwind 说『帮我回他』，它写的草稿会出现在这儿」。
-- 那是一句从未兑现过的话：模型的工具白名单里根本没有能建产出的口
-- （server.js 的 READ_TOOLS + 文件 + GMAIL_TOOLS 四件套，一个都不沾库），
-- 所以那一栏永远是空的，右边那颗「放进 Gmail 草稿箱」也就永远够不着。
-- 于是真实用法退化成：从对话气泡里选中、复制、切去 Gmail 粘贴、在那儿改字再发。
-- （cleanCopy.js 存在的唯一理由就是那条路——它是给「复制出去」打的补丁。）
--
-- ══ 为什么是「你点一下」，不是自动收 ══════════════════════════
-- 让模型判断「这段该不该收进产出」是猜意图，会漏也会滥。改成两半：
--   形式判断归它  —— 这是一封信（有收件人、有主题、有称呼和落款），
--                    它写的时候本来就知道，不用猜
--   意图判断归你  —— 这封要发
-- 这支函数就是你那一下。刀切在这儿，「AI 判断得准不准」不再是风险：
-- 它最多把一段语气示范也标成信，代价是产出栏多一份随手删掉的草稿，
-- 不是发错信。
--
-- ══ 一个所有者只留一份待发信 ══════════════════════════════════
-- 在对话里让它改五版、你收五次，产出栏该是**一份**最新的，不是五份。
-- 理由跟 0066（重说）一样：草稿的「最新一版」只有一个。
-- 所以这支是 upsert：同一个所有者名下已有 draft 的 email 产出就覆盖它。
--
-- 照 0025 的规矩：create or replace 必须整段重写，漏掉 security definer
-- 或 search_path 会悄悄改掉权限模型且不报错。
create or replace function public.pa_adopt_letter(
  p_pursuit_id uuid  default null,
  p_contact_id uuid  default null,
  p_to         text  default null,
  p_subject    text  default '（无主题）',
  p_body       text  default '',
  p_meta       jsonb default '{}'::jsonb
) returns producer.deliverables
language plpgsql
security definer
set search_path = public, producer
as $$
declare r producer.deliverables; existing uuid; cp text;
begin
  -- 0033 给 deliverables 立的所有者约束：要么挂线，要么挂人，不能都给也不能都不给。
  -- 在这儿先拦一道，好让报错说人话——交给表约束的话，你看到的是一句
  -- deliverables_owner_chk 违反，查不到根上。
  if (p_pursuit_id is null) = (p_contact_id is null) then
    raise exception '要么挂在一条机会线上，要么挂在一个人身上，不能都给也不能都不给';
  end if;

  cp := lower(btrim(coalesce(p_to, '')));
  if cp not like '%@%' then
    raise exception '没有收件人的信收进来也发不出去（收到 %）', coalesce(p_to, 'null');
  end if;

  -- 已经有一份待发信就覆盖它，不再生一份
  select id into existing
    from producer.deliverables
   where kind = 'email' and status = 'draft'
     and pursuit_id is not distinct from p_pursuit_id
     and contact_id is not distinct from p_contact_id
   order by created_at desc
   limit 1;

  if existing is null then
    insert into producer.deliverables
      (pursuit_id, contact_id, kind, title, body, meta, created_by, status)
    values (p_pursuit_id, p_contact_id, 'email', p_subject, p_body,
            coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('to', cp),
            'fairwind', 'draft')
    returning * into r;
  else
    update producer.deliverables
       set title = p_subject,
           body  = p_body,
           -- meta 合并不替换：thread_id / reply_to 这些是这串往来的身份，
           -- 后一版没带就不该把它们抹掉——抹掉了这封信会变成另起一封，
           -- 对方的邮箱里就不再是同一串对话。
           meta  = coalesce(meta, '{}'::jsonb)
                     || coalesce(p_meta, '{}'::jsonb)
                     || jsonb_build_object('to', cp)
     where id = existing
    returning * into r;
  end if;

  return r;
end
$$;

-- 这是**你的手**（点「收进产出」），所以给 anon。
-- 不给的话就得绕一趟 brain，而脑子没开的时候你连收都收不了——
-- 跟 0027 把定稿/改稿留给 anon 是同一条理由。
revoke all on function public.pa_adopt_letter(uuid, uuid, text, text, text, jsonb)
  from public;
grant execute on function public.pa_adopt_letter(uuid, uuid, text, text, text, jsonb)
  to anon, authenticated, service_role;

comment on function public.pa_adopt_letter(uuid, uuid, text, text, text, jsonb) is
  '把对话里那封信收成一份待发的 email 产出。一个所有者只留一份，重收是覆盖。';

do $$
begin
  raise notice '✓ pa_adopt_letter 就位：对话里那封信收得进产出了';
end $$;
