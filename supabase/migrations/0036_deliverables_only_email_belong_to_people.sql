-- Producer Agent — 收回一步走过头的迁移：只有「信」才归人
--
-- 0033 的第 ③ 步把一条机会线的**全部**交付物都挂上了那条线的联系人。
-- 上界面才看出来这是错的：Mattie 的名片右栏（「要发的信」）里摆着
-- 「营销素材 6 样」和「第一人称项目陈述」——那些是交给 **CultureHub 这个机构**
-- 的东西，属于那条机会线，不是要发给 Mattie 本人的信。
--
-- 摆在那儿等于界面在说一句假话。判据很干净：
--   kind='email' → 是写给某个人的 → 归人
--   其余（idea/concept/statement/bio/form/file）→ 交给机构的 → 只归线
--
-- 只清 contact_id 这一列。pursuit_id 一个字没动，所以这些交付物在机会线上
-- 原样都在——没有任何东西消失，只是不再假装它属于某个人。

update producer.deliverables
   set contact_id = null
 where contact_id is not null
   and kind is distinct from 'email';

-- 验一下：现在挂在人身上的交付物必须全是 email
do $$
declare bad int;
begin
  select count(*) into bad from producer.deliverables
   where contact_id is not null and kind is distinct from 'email';
  if bad > 0 then
    raise exception '还有 % 份不是信的交付物挂在人身上', bad;
  end if;
end $$;
