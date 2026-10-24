-- New tickets remain private upload drafts until real uploaded media is attached.
-- Existing tickets/history are preserved; no historical records are hidden.
create function mes_private.visible_evidence_result(action text,payload jsonb,result jsonb) returns jsonb language plpgsql security definer set search_path=mes_private,pg_temp as $$
declare output jsonb:='{}'; item jsonb; k text;
begin
 if action='readBundle' then
  for k,item in select * from jsonb_each(result->'snapshots') loop output:=output||jsonb_build_object(k,mes_private.visible_evidence_result('read',jsonb_build_object('path',k),item));end loop;
  return result||jsonb_build_object('snapshots',output);
 end if;
 if action='read' and payload->>'path' in ('issues','myIssues') then
  select coalesce(jsonb_agg(a.row_value order by a.position),'[]') into output from jsonb_array_elements(result->'rows') with ordinality a(row_value,position) where a.row_value->'pendingEvidence' is distinct from 'true'::jsonb;
  return result||jsonb_build_object('rows',output);
 end if;
 if action='read' and payload->>'path' ~ '^issues/[a-zA-Z0-9_-]+/timeline$' and exists(select 1 from records where collection='issues' and id=split_part(payload->>'path','/',2) and data->'pendingEvidence'='true'::jsonb) then raise exception 'Ticket upload is not complete';end if;
 if action='readTicket' and result->'pendingEvidence'='true'::jsonb then raise exception 'Ticket upload is not complete';end if;
 return result;
end $$;
alter function public.mes_dispatch(text,jsonb,jsonb) rename to dispatch_before_verified_evidence;
alter function public.dispatch_before_verified_evidence(text,jsonb,jsonb) set schema mes_private;
create function public.mes_dispatch(action text,payload jsonb,actor jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path=mes_private,extensions,pg_temp as $$
declare result jsonb; ticket jsonb; ident text; published boolean; sess jsonb;
begin
 if action='downloadUrl' and exists(select 1 from records where collection='issues' and id=split_part(payload->>'path','/',2) and data->'pendingEvidence'='true'::jsonb) then raise exception 'Ticket upload is not complete';end if;
 if action='uploadUrl' then
  ident:=split_part(payload->>'path','/',2);select data into ticket from records where collection='issues' and id=ident;
  if ticket->'pendingEvidence'='true'::jsonb then
   sess:=mes_private.dispatch_before_verified_evidence('getSession','{}',actor);
   if not coalesce((sess->>'isOwner')::boolean,false) and ticket->>'createdBy' is distinct from sess->'user'->>'uid' then raise exception 'Not your upload';end if;
   if coalesce((ticket->>'deleting')::boolean,false) or payload->>'path'<>'issues/'||ident||'/'||split_part(payload->>'path','/',3) or not (ticket->'uploadSlots' ? split_part(payload->>'path','/',3)) or (extract(epoch from now())*1000)::bigint-(ticket->>'createdAt')::bigint>86400000 then raise exception 'Upload draft expired';end if;
   return '{"ok":true}';
  end if;
 end if;
 if action='saveTicketEdit' then
  select data into ticket from records where collection='issues' and id=payload->>'id';
  if ticket->'evidenceRequired'='true'::jsonb and not exists(select 1 from jsonb_array_elements(coalesce(payload->'files','[]')) item join public.files f on f.path=item->>'path' where f.type like 'image/%' or f.type like 'video/%') then raise exception 'Keep at least one photo or video';end if;
 end if;
 result:=mes_private.dispatch_before_verified_evidence(action,payload,actor);
 if action='createIssue' and result ? 'id' then
  update records set data=data||'{"evidenceRequired":true,"pendingEvidence":true}'::jsonb where collection='issues' and id=result->>'id';
  return result||'{"pendingEvidence":true}'::jsonb;
 end if;
 if action='attachFiles' then
  ident:=payload->>'issueId';
  select data into ticket from records where collection='issues' and id=ident for update;
  published:=exists(select 1 from jsonb_array_elements(coalesce(ticket->'attachments','[]')) a join public.files f on f.path=a->>'path' and f.type=a->>'type' where f.size>0 and (f.type like 'image/%' or f.type like 'video/%'));
  if ticket->'pendingEvidence'='true'::jsonb and published then update records set data=data||'{"pendingEvidence":false}'::jsonb where collection='issues' and id=ident;end if;
  return result||jsonb_build_object('published',ticket->'pendingEvidence' is distinct from 'true'::jsonb or published);
 end if;
 return mes_private.visible_evidence_result(action,payload,result);
end $$;
alter function public.mes_view(text,jsonb) rename to view_before_verified_evidence;
alter function public.view_before_verified_evidence(text,jsonb) set schema mes_private;
create function public.mes_view(action text,payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path=mes_private,pg_temp as $$
begin
 if (action='read' and payload->>'path' ~ '^issues/[a-zA-Z0-9_-]+/timeline$') or action='downloadUrl' then
  if exists(select 1 from records where collection='issues' and id=split_part(payload->>'path','/',2) and data->'pendingEvidence'='true'::jsonb) then raise exception 'Ticket upload is not complete';end if;
 end if;
 return mes_private.visible_evidence_result(action,payload,mes_private.view_before_verified_evidence(action,payload));
end $$;
revoke all on function mes_private.visible_evidence_result(text,jsonb,jsonb) from public;
