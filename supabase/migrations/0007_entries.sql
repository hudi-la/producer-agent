-- Producer Agent — 作品库 → 战绩信息库
-- Generalize producer.works into a unified "一条" entry model. Physical table name
-- stays `producer.works` (keeps pursuits.work_id FK + existing triggers intact);
-- exposed to the frontend through a well-named public.v_pa_entries view.
-- (Applied to project jjgvvtrsnoqnoigukobi via MCP on 2026-08-03.)

alter table producer.works
  add column if not exists kind   text    not null default 'work',     -- work | job | education | credit | statement | …(free text)
  add column if not exists meta   jsonb   not null default '{}'::jsonb, -- kind-specific fields (job:{org,role,start,end}, education:{school,degree,field,year}, credit:{org,year,type,location}…)
  add column if not exists images text[]  not null default '{}',       -- image URLs (referenced, not hosted — this slice)
  add column if not exists tags   text[]  not null default '{}';       -- matching tags (themes/skills), optional

-- blurb → body (blurb was one-line-from-site; body now holds any entry's text incl. long statements)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='producer' and table_name='works' and column_name='blurb')
     and not exists (select 1 from information_schema.columns
             where table_schema='producer' and table_name='works' and column_name='body')
  then
    alter table producer.works rename column blurb to body;
  end if;
end $$;

create index if not exists works_kind_idx on producer.works (kind);

-- Read surface: v_pa_works depended on blurb → recreate as v_pa_entries.
drop view if exists public.v_pa_works;
create or replace view public.v_pa_entries as
  select id, kind, title, medium, year, body, concern, site_path,
         source, box, meta, images, tags, sort
  from producer.works
  order by sort;

grant select on public.v_pa_entries to anon, authenticated;
