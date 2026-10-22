-- 补录：这条迁移线上已经跑过（20260810065854 / 0043_address_alone_is_enough_ownership），当时没落成文件。
-- 此文件由 supabase_migrations.schema_migrations.statements 逐字 dump，不是事后重写的。

-- 一封信只要**记下了对面地址**，就不算无主。
--
-- 0033 立的护栏是「要么挂线、要么挂人」。那时候没有 counterpart_email，
-- 所以两个都空 = 谁也不知道这封信是干嘛的 = 真丢了。
--
-- 现在不一样了：地址本身就是身份。一封"还不知道是谁发的"的信，
-- 它会出现在 v_pa_unknown_senders 里等你认领——这不叫无主，这叫**待认领**。
--
-- 不放宽的话有个真问题：收一条 thread 时里面冒出第三个人（CultureHub 那条
-- 就冒出过 Stacy），他的地址还没登记，插入会直接撞约束失败——
-- 于是那封信**根本进不了库**。为了守一条护栏而把信丢在门外，本末倒置了。
alter table producer.pursuit_messages drop constraint if exists pm_owner_chk;
alter table producer.pursuit_messages add constraint pm_owner_chk
  check (pursuit_id is not null or contact_id is not null or counterpart_email is not null);

comment on constraint pm_owner_chk on producer.pursuit_messages is
  '三样有其一即可：挂着线、挂着人、或者至少记下了对面地址。第三种是「待认领」，会出现在 v_pa_unknown_senders 里等你认——它不是无主';
