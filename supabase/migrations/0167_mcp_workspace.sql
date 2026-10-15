-- MCP workspace writes. All functions run as the authenticated owner, never as a definer.
create table producer.card_stacks (
 id uuid primary key default gen_random_uuid(), owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
 name text not null check (btrim(name) <> ''), description text not null default '',
 created_at timestamptz not null default now(), unique(owner,id)
);
create unique index card_stacks_name on producer.card_stacks(owner,lower(btrim(name)));
create table producer.card_stack_items (
 pursuit_id uuid primary key references producer.pursuits(id) on delete cascade,
 owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
 stack_id uuid not null, position integer not null default 0,
 foreign key(owner,stack_id) references producer.card_stacks(owner,id) on delete cascade
);
alter table producer.card_stacks enable row level security;
alter table producer.card_stack_items enable row level security;
create policy own_rows on producer.card_stacks for all to authenticated using(owner=auth.uid()) with check(owner=auth.uid());
create policy own_rows on producer.card_stack_items for all to authenticated using(owner=auth.uid()) with check(owner=auth.uid() and exists(select 1 from producer.pursuits p where p.id=pursuit_id and p.owner=auth.uid()));
grant select,insert,update,delete on producer.card_stacks,producer.card_stack_items to authenticated,service_role;
create view public.v_pa_stacks with(security_invoker=true) as select s.id,s.name,s.description,s.created_at,
 (select count(*) from producer.card_stack_items i where i.stack_id=s.id) as card_count from producer.card_stacks s;
create view public.v_pa_stack_cards with(security_invoker=true) as
 select p.*,i.stack_id,i.position as stack_position,s.name as stack_name
 from public.v_pa_pursuit_cards p left join producer.card_stack_items i on i.pursuit_id=p.id left join producer.card_stacks s on s.id=i.stack_id;
grant select on public.v_pa_stacks,public.v_pa_stack_cards to authenticated,service_role;
-- Pulse updates make already-open boards refresh when MCP changes a stack.
create trigger stack_insert after insert on producer.card_stacks referencing new table as chg for each statement execute function producer.pulse_bump_areas('board');
create trigger stack_update after update on producer.card_stacks referencing new table as chg for each statement execute function producer.pulse_bump_areas('board');
create trigger stack_item_insert after insert on producer.card_stack_items referencing new table as chg for each statement execute function producer.pulse_bump_areas('board');
create trigger stack_item_update after update on producer.card_stack_items referencing new table as chg for each statement execute function producer.pulse_bump_areas('board');
create trigger stack_item_delete after delete on producer.card_stack_items referencing old table as chg for each statement execute function producer.pulse_bump_areas('board');

create function public.pa_stack_write(p_id uuid default null,p_name text default null,p_description text default null,p_cards jsonb default '[]',p_ids uuid[] default '{}',p_remove boolean default false,p_reorder boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,producer as $$
declare sid uuid:=p_id; pid uuid; c jsonb; made jsonb; n integer; ids uuid[]:=p_ids; results jsonb:='[]';
begin
 if sid is null then
  if coalesce(btrim(p_name),'')='' then raise exception 'Stack needs a name'; end if;
  insert into producer.card_stacks(name,description) values(btrim(p_name),coalesce(p_description,''))
  on conflict(owner,lower(btrim(name))) do update set name=excluded.name returning id into sid;
 else
  perform 1 from producer.card_stacks where id=sid and owner=auth.uid() for update;
  if not found then raise exception 'Stack not found'; end if;
  update producer.card_stacks set name=coalesce(p_name,name),description=coalesce(p_description,description) where id=sid and owner=auth.uid();
 end if;
 if jsonb_typeof(p_cards)<>'array' or jsonb_array_length(p_cards)>100 or cardinality(ids)>1000 then raise exception 'Maximum 100 cards per write'; end if;
 for c in select value from jsonb_array_elements(p_cards) loop
  made:=public.pa_create_pursuit(p_title=>c->>'title',p_kind=>c->>'kind',p_org=>c->>'org',p_location=>c->>'location',p_funding=>c->>'funding',p_deadline=>c->>'deadline',p_deadline_at=>(c->>'deadline_at')::date,p_opens_at=>(c->>'opens_at')::date,p_url=>c->>'url',p_match_stars=>(c->>'match_stars')::int,p_why=>c->>'why',p_notes=>c->>'notes',p_eligible=>coalesce((c->>'eligible')::boolean,true),p_source=>'mcp');
  ids:=array_append(ids,(made->>'id')::uuid); results:=results||jsonb_build_array(made);
 end loop;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Duplicate card IDs'; end if;
 if p_reorder and (cardinality(ids)<>(select count(*) from producer.card_stack_items where stack_id=sid) or exists(select 1 from unnest(ids) x where not exists(select 1 from producer.card_stack_items where stack_id=sid and pursuit_id=x))) then raise exception 'Reorder must include each current card exactly once'; end if;
 select coalesce(max(position),-1)+1 into n from producer.card_stack_items where stack_id=sid;
 if p_reorder then n:=0; end if;
 foreach pid in array ids loop
  if not exists(select 1 from producer.pursuits where id=pid and owner=auth.uid()) then raise exception 'Card not found'; end if;
  if p_remove then
   delete from producer.card_stack_items where pursuit_id=pid and stack_id=sid and owner=auth.uid();
  elsif p_reorder then
   update producer.card_stack_items set position=n where pursuit_id=pid and stack_id=sid and owner=auth.uid();
  else
   if exists(select 1 from producer.card_stack_items where pursuit_id=pid and stack_id<>sid) then raise exception 'Card already in another stack; remove it there first'; end if;
   insert into producer.card_stack_items(pursuit_id,stack_id,position) values(pid,sid,n) on conflict(pursuit_id) do nothing;
  end if;
  n:=n+1;
 end loop;
 return jsonb_build_object('ok',true,'id',sid,'cards',results);
end $$;

-- A small fixed whitelist; no owner, state-machine internals, arbitrary table or SQL input.
create function public.pa_mcp_patch(p_entity text,p_id uuid,p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path=public,producer as $$
declare tbl text; allowed text[]; k text; assignments text; result jsonb;
begin
 case p_entity
 when 'pursuit' then tbl:='pursuits'; allowed:=array['title','kind','org','location','funding','url','deadline','deadline_at','opens_at','eligible','match_stars','why','notes'];
 when 'opportunity' then tbl:='opportunities'; allowed:=array['title','kind','org','location','funding','url','deadline','deadline_at','opens_at','eligible','fit_stars','why','notes','status'];
 when 'entry' then tbl:='works'; allowed:=array['sort','draft'];
 when 'deliverable' then tbl:='deliverables'; allowed:=array['title','body','rules'];
 else raise exception 'Unsupported entity'; end case;
 if jsonb_typeof(p_patch)<>'object' or p_patch='{}' then raise exception 'Empty patch'; end if;
 for k in select jsonb_object_keys(p_patch) loop
  if not k=any(allowed) then raise exception 'Unsupported field: %',k; end if;
 end loop;
 if p_patch ? 'title' and coalesce(btrim(p_patch->>'title'),'')='' then raise exception 'Title cannot be empty'; end if;
 if p_entity='deliverable' then
  perform 1 from producer.deliverables where id=p_id and status='draft' and owner=auth.uid() for update;
  if not found then raise exception 'Draft not found (finals cannot be edited)'; end if;
 end if;
 select string_agg(format('%I = v.%I',key,key),', ') into assignments from jsonb_object_keys(p_patch) key;
 execute format('update producer.%1$I t set %2$s from jsonb_populate_record(null::producer.%1$I,$1) v where t.id=$2 and t.owner=auth.uid() returning to_jsonb(t)',tbl,assignments) into result using p_patch,p_id;
 if result is null then raise exception 'Record not found'; end if;
 return result;
end $$;

create function public.pa_mcp_entries_import(p_entries jsonb)
returns jsonb language plpgsql security invoker set search_path=public,producer as $$
declare e jsonb; eid uuid; is_new boolean; result jsonb:='[]';
begin
 if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)>100 then raise exception 'Maximum 100 entries'; end if;
 for e in select value from jsonb_array_elements(p_entries) loop
  eid:=(e->>'id')::uuid; is_new:=eid is null;
  if eid is null then
   select id into eid from producer.works where owner=auth.uid() and kind=e->>'kind' and lower(btrim(title))=lower(btrim(e->>'title')) order by sort limit 1;
   if eid is not null then result:=result||jsonb_build_array(jsonb_build_object('id',eid,'created',false,'skipped','existing')); continue; end if;
   eid:=public.pa_add_entry(e->>'kind',e->>'title');
  end if;
  perform public.pa_set_entry(eid,e->>'title',e->>'body',e->>'medium',e->>'year',e->'meta');
  if e ? 'images' or e ? 'site_path' then perform public.pa_set_entry_images(eid,case when e ? 'images' then array(select jsonb_array_elements_text(e->'images')) else null end,e->>'site_path'); end if;
  if is_new or e ? 'draft' then perform public.pa_set_entry_draft(eid,coalesce((e->>'draft')::boolean,false)); end if;
  result:=result||jsonb_build_array(jsonb_build_object('id',eid,'saved',true));
 end loop;
 return result;
end $$;

-- Archiving preserves the original draft state and makes the item unavailable to writing context.
create function public.pa_mcp_entry_archive(p_id uuid,p_archived boolean)
returns void language plpgsql security invoker set search_path=public,producer as $$
begin
 update producer.works set
 draft=case when p_archived then true when coalesce((meta->>'mcp_archived')::boolean,false) then coalesce((meta->>'mcp_previous_draft')::boolean,false) else draft end,
 meta=case when p_archived and not coalesce((meta->>'mcp_archived')::boolean,false) then coalesce(meta,'{}')||jsonb_build_object('mcp_archived',true,'mcp_previous_draft',draft)
 when not p_archived then coalesce(meta,'{}')-'mcp_archived'-'mcp_previous_draft' else meta end
 where id=p_id and owner=auth.uid();
 if not found then raise exception 'Entry not found'; end if;
end $$;

create function public.pa_mcp_deliverable_add(p_pursuit_id uuid,p_kind text,p_title text,p_body text default '',p_rules jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path=public,producer as $$
declare d producer.deliverables;
begin
 if not exists(select 1 from producer.pursuits where id=p_pursuit_id and owner=auth.uid()) then raise exception 'Card not found'; end if;
 if coalesce(btrim(p_title),'')='' then raise exception 'Title required'; end if;
 insert into producer.deliverables(pursuit_id,kind,title,body,rules,created_by) values(p_pursuit_id,p_kind,p_title,p_body,p_rules,'you') returning * into d;
 return to_jsonb(d);
end $$;

create function public.pa_mcp_task_add(p_name text,p_prompt text,p_run_every text default 'manual',p_run_weekday int default 1,p_run_hour int default 8,p_enabled boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,producer as $$
declare tid uuid;
begin
 if coalesce(btrim(p_name),'')='' or coalesce(btrim(p_prompt),'')='' then raise exception 'Name and prompt required'; end if;
 insert into producer.tasks(name,type,enabled,prompt) values(p_name,'scout_custom',false,p_prompt) returning id into tid;
 return public.pa_set_task(tid,p_enabled,p_prompt,p_run_every,p_run_weekday,p_run_hour);
end $$;

-- Append one uploaded file under a row lock, without replacing concurrently added files.
create function public.pa_mcp_entry_file(p_id uuid,p_file jsonb)
returns void language plpgsql security invoker set search_path=public,producer as $$
begin
 if split_part(p_file->>'key','/',1) is distinct from auth.uid()::text then raise exception 'File owner mismatch'; end if;
 update producer.works set box=jsonb_set(coalesce(box,'{}'),'{files}',coalesce(box->'files','[]')||jsonb_build_array(p_file)) where id=p_id and owner=auth.uid();
 if not found then raise exception 'Entry not found'; end if;
end $$;

create function public.pa_mcp_list(p_entity text,p_filters jsonb default '{}',p_search text default '',p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security invoker set search_path=public,producer as $$
declare v text; result jsonb; extra text:='';
begin
 case p_entity
 when 'stacks' then v:='v_pa_stacks'; when 'cards' then v:='v_pa_stack_cards'; when 'pursuits' then v:='v_pa_pursuits';
 when 'contacts' then v:='v_pa_contacts'; when 'mailboxes' then v:='v_pa_org_mailboxes'; when 'parties' then v:='v_pa_pursuit_parties';
 when 'entries' then v:='v_pa_entries'; when 'deliverables' then v:='v_pa_deliverables'; when 'attachments' then v:='v_pa_attachments';
 when 'tasks' then v:='v_pa_tasks'; when 'opportunities' then v:='v_pa_opportunities';
 when 'notes' then v:='v_pa_pursuit_messages'; extra:=' and t.role = ''note''';
 else raise exception 'Unsupported entity'; end case;
 if p_offset<0 or p_limit<1 or p_limit>100 then raise exception 'Invalid page'; end if;
 execute format('select coalesce(jsonb_agg(j),''[]''::jsonb) from (select to_jsonb(t) as j from public.%I t where to_jsonb(t) @> $1 and ($2='''' or position(lower($2) in lower(coalesce(to_jsonb(t)->>''title'','''') || '' '' || coalesce(to_jsonb(t)->>''name'','''') || '' '' || coalesce(to_jsonb(t)->>''org'','''') || '' '' || coalesce(to_jsonb(t)->>''content'',''''))) > 0) %s order by (to_jsonb(t)->>''stack_position'')::integer nulls last,coalesce(to_jsonb(t)->>''id'',to_jsonb(t)->>''email'') limit $3 offset $4) q',v,extra)
 into result using p_filters,p_search,p_limit+1,p_offset;
 return jsonb_build_object('rows',case when jsonb_array_length(result)>p_limit then result-p_limit else result end,'has_more',jsonb_array_length(result)>p_limit,'next_offset',case when jsonb_array_length(result)>p_limit then p_offset+p_limit else null end);
end $$;

create function public.pa_mcp_pursuit_set(p_id uuid,p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path=public,producer as $$
begin
 perform 1 from producer.pursuits where id=p_id and owner=auth.uid() for update;
 if not found then raise exception 'Card not found'; end if;
 if p_patch-'stage'-'jot'<>'{}' then perform public.pa_mcp_patch('pursuit',p_id,p_patch-'stage'-'jot'); end if;
 if p_patch ? 'stage' then perform public.pa_set_stage(p_id,p_patch->>'stage'); end if;
 if p_patch ? 'jot' then perform public.pa_set_jot(p_id,p_patch->>'jot'); end if;
 return jsonb_build_object('ok',true,'id',p_id);
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'pa_mcp_%' or p.proname='pa_stack_write') loop
 execute format('revoke all on function %s from public,anon',f.sig);
 execute format('grant execute on function %s to authenticated,service_role',f.sig);
 end loop;
end $$;
notify pgrst,'reload schema';
