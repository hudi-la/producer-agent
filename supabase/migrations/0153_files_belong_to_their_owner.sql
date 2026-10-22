-- Producer Agent — 附件桶:文件归人,路径第一段就是主人
--
-- hosted-fairwind(2026-10-02),设计稿 docs/specs/2026-10-02-hosted-fairwind-design.md D10。
--
-- ── 洞在哪 ──────────────────────────────────────────────────────
-- 0044 给 pursuit-files 桶挂的三条策略只看一样东西:bucket_id = 'pursuit-files'。
-- 并且 to anon, authenticated。那是单人时代的写法——「这个桶里的都是我的」。
-- 多人共用一个库之后它的意思变成:
--   · 任何登录用户能列出、下载、删掉**别人**的合同和作品图(桶是私有的,
--     但「私有」只挡没登录的人,策略才决定登录的人能摸什么;而策略对谁都放行)。
--   · anon 也在名单上——连登录都不用,拿前端那把 anon key 就能列整个桶。
-- 0137 把 producer.* 每张表都按 owner 关了门,storage.objects 不在 producer 下,
-- 那道循环没盖到它。这支补上。
--
-- ── 改法 ────────────────────────────────────────────────────────
-- 路径规则改成 <owner>/…(七):前端两处拼 key 的地方加前缀,
-- 旧文件由 scripts/storage-prefix-keys.mjs 搬到自己主人的目录下。
-- 策略只认两件事:还是这个桶,**并且**路径第一段 = auth.uid()。
-- anon 一律收回;顺手补 update(signed upload / upsert 走的是 update,0044 漏了)。
--
-- 先 drop 再建:策略是 or 的关系,旧的三条留着,新的等于没加。

drop policy if exists pa_files_read  on storage.objects;
drop policy if exists pa_files_write on storage.objects;
drop policy if exists pa_files_drop  on storage.objects;
drop policy if exists pa_files_own_read   on storage.objects;
drop policy if exists pa_files_own_write  on storage.objects;
drop policy if exists pa_files_own_update on storage.objects;
drop policy if exists pa_files_own_drop   on storage.objects;

create policy pa_files_own_read on storage.objects
  for select to authenticated
  using (bucket_id = 'pursuit-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy pa_files_own_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pursuit-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy pa_files_own_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'pursuit-files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'pursuit-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy pa_files_own_drop on storage.objects
  for delete to authenticated
  using (bucket_id = 'pursuit-files' and (storage.foldername(name))[1] = auth.uid()::text);
