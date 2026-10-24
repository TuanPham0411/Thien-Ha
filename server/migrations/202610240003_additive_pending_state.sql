-- Publication readiness lives outside immutable legacy ticket/history JSON.
create table if not exists mes_private.pending_ticket_legacy(issue_id text primary key);
insert into mes_private.pending_ticket_legacy select id from mes_private.records where collection='issues' and not coalesce((data->>'deleting')::boolean,false) and jsonb_array_length(mes_private.ticket_missing_requirements(data))>0 on conflict do nothing;
create or replace function mes_private.visible_evidence_result(action text,payload jsonb,result jsonb) returns jsonb language plpgsql security definer set search_path=mes_private,pg_temp as $$
declare output jsonb:='{}'; item jsonb; k text;
begin
 if action='readBundle' then
  for k,item in select * from jsonb_each(result->'snapshots') loop output:=output||jsonb_build_object(k,mes_private.visible_evidence_result('read',jsonb_build_object('path',k),item));end loop;
  return result||jsonb_build_object('snapshots',output);
 end if;
 if action='read' and payload->>'path' in ('issues','myIssues') then
  select coalesce(jsonb_agg(a.row_value order by a.position),'[]') into output from jsonb_array_elements(result->'rows') with ordinality a(row_value,position) where a.row_value->'pendingEvidence' is distinct from 'true'::jsonb and not exists(select 1 from pending_ticket_legacy q where q.issue_id=a.row_value->>'id');
  return result||jsonb_build_object('rows',output);
 end if;
 if action='read' and payload->>'path' ~ '^issues/[a-zA-Z0-9_-]+/timeline$' and exists(select 1 from records where collection='issues' and id=split_part(payload->>'path','/',2) and (data->'pendingEvidence'='true'::jsonb or exists(select 1 from pending_ticket_legacy q where q.issue_id=records.id))) then raise exception 'Ticket upload is not complete';end if;
 if action='readTicket' and (result->'pendingEvidence'='true'::jsonb or exists(select 1 from pending_ticket_legacy q where q.issue_id=result->>'id')) then raise exception 'Ticket upload is not complete';end if;
 return result;
end $$;
create or replace function public.mes_dispatch(action text,payload jsonb,actor jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path=mes_private,extensions,pg_temp as $$
declare sess jsonb; uid_value text; ticket jsonb; result jsonb; ident text; item jsonb; attachment jsonb; attachments jsonb:='[]'; slot text; slots jsonb:='[]'; dept jsonb; category jsonb; idx integer; used integer[]:='{}'; tick bigint:=(extract(epoch from clock_timestamp())*1000)::bigint;
begin
 if action in ('getMyPendingTickets','reservePendingFiles','completePendingTicket') or (action='uploadUrl' and exists(select 1 from attachment_drafts d join records r on r.collection='issues' and r.id=d.issue_id where d.path=payload->>'path' and d.expires>now() and (r.data->'pendingEvidence'='true'::jsonb or exists(select 1 from pending_ticket_legacy q where q.issue_id=r.id)))) then
  sess:=mes_private.dispatch_before_pending_completion('getSession','{}',actor);uid_value:=sess->'user'->>'uid';
  if uid_value is null then raise exception 'Sign in first' using errcode='28000';end if;
  if action='getMyPendingTickets' then
   select coalesce(jsonb_agg((r.data-'uploadSlots')||jsonb_build_object('id',r.id,'pendingEvidence',true,'ticketNumber',c.code,'submissionState','Waiting for completion','missingRequirements',ticket_missing_requirements(r.data)) order by (r.data->>'createdAt')::bigint desc),'[]') into result from records r left join public.mes_ticket_codes c on c.issue_id=r.id where r.collection='issues' and r.data->>'reporterUid'=uid_value and (r.data->'pendingEvidence'='true'::jsonb or exists(select 1 from pending_ticket_legacy q where q.issue_id=r.id)) and not coalesce((r.data->>'deleting')::boolean,false);
   return jsonb_build_object('rows',result);
  end if;
  ident:=coalesce(payload->>'id',split_part(payload->>'path','/',2));select data into ticket from records where collection='issues' and id=ident for update;
  if exists(select 1 from pending_ticket_legacy where issue_id=ident) then ticket:=ticket||'{"pendingEvidence":true}'::jsonb;end if;
  if ticket is null or ticket->>'reporterUid' is distinct from uid_value or coalesce((ticket->>'deleting')::boolean,false) then raise exception 'Pending ticket unavailable';end if;
  if action='completePendingTicket' and ticket->'pendingEvidence' is distinct from 'true'::jsonb then return jsonb_build_object('ok',true,'published',true,'id',ident);end if;
  if ticket->'pendingEvidence' is distinct from 'true'::jsonb then raise exception 'Ticket is already submitted';end if;
  if action='uploadUrl' then
   if not exists(select 1 from attachment_drafts where path=payload->>'path' and issue_id=ident and owner_uid=uid_value and expires>now()) then raise exception 'Invalid pending upload';end if;
   return '{"ok":true}';
  end if;
  if action='reservePendingFiles' then
   if jsonb_typeof(payload->'count') is distinct from 'number' or payload->>'count' !~ '^[1-5]$' then raise exception 'Maximum five attachments';end if;
   delete from attachment_drafts where expires<now();
   if (select count(*) from attachment_drafts where issue_id=ident)>35 then raise exception 'Too many pending uploads';end if;
   for n in 1..(payload->>'count')::integer loop
    slot:=gen_random_uuid()::text;insert into attachment_drafts(path,issue_id,owner_uid,slot_index) values('issues/'||ident||'/'||slot,ident,uid_value,n-1);slots:=slots||jsonb_build_array(jsonb_build_object('path','issues/'||ident||'/'||slot,'slot',slot));
   end loop;
   return jsonb_build_object('files',slots);
  end if;
  if payload->'baseUpdatedAt' is distinct from ticket->'updatedAt' then raise exception using errcode='P0409',message='This ticket changed. Close and reopen it to try again.';end if;
  if char_length(trim(payload->>'process')) not between 1 and 120 or char_length(trim(payload->>'description')) not between 1 and 5000 or payload->>'process' is null or payload->>'description' is null then raise exception 'Enter process and feedback';end if;
  select data into dept from records where collection='departments' and id=payload->>'departmentId' and coalesce((data->>'active')::boolean,true);
  if dept is null then raise exception 'Select a department';end if;
  if nullif(payload->>'issueTypeId','') is not null then select data into category from public.mes_workspace where kind='issueTypes' and id=payload->>'issueTypeId' and coalesce((data->>'active')::boolean,true);if category is null then raise exception 'Select a ticket type';end if;end if;
  if jsonb_typeof(payload->'files') is distinct from 'array' or jsonb_array_length(payload->'files') not between 1 and 5 then raise exception 'Add at least one photo or video';end if;
  for item in select value from jsonb_array_elements(payload->'files') loop
   if not exists(select 1 from jsonb_array_elements(coalesce(ticket->'attachments','[]')) a where a->>'path'=item->>'path') and not exists(select 1 from attachment_drafts where path=item->>'path' and issue_id=ident and owner_uid=uid_value and expires>now()) then raise exception 'Attachment is not part of this ticket';end if;
   idx:=null;select coalesce((a.value->>'slotIndex')::integer,(a.position-1)::integer) into idx from jsonb_array_elements(coalesce(ticket->'attachments','[]')) with ordinality a(value,position) where a.value->>'path'=item->>'path';
   if idx is null then for n in 0..4 loop if not n=any(used) then idx:=n;exit;end if;end loop;end if;
   if idx is null or idx=any(used) then raise exception 'Duplicate image slot';end if;used:=array_append(used,idx);
   select jsonb_build_object('path',f.path,'name',left(coalesce(nullif(item->>'name',''),f.name,'evidence'),180),'type',f.type,'size',f.size,'slotIndex',idx) into attachment from public.files f where f.path=item->>'path';
   if attachment is null then raise exception 'Upload is incomplete';end if;
   if exists(select 1 from jsonb_array_elements(attachments) a where a->>'path'=attachment->>'path') then raise exception 'Duplicate attachment';end if;
   attachments:=attachments||jsonb_build_array(attachment);
  end loop;
  result:=ticket||jsonb_build_object('process',trim(payload->>'process'),'subject',left(trim(payload->>'description'),100),'description',trim(payload->>'description'),'richDocument',payload->'richDocument','departmentId',payload->>'departmentId','departmentName',dept->>'name','issueTypeId',payload->>'issueTypeId','issueTypeName',coalesce(category->>'name','General'),'attachments',attachments,'pendingEvidence',false,'evidenceRequired',true,'updatedAt',tick);
  if jsonb_array_length(ticket_missing_requirements(result))>0 then raise exception 'Complete all required information and add a photo or video';end if;
  update records set data=result where collection='issues' and id=ident;
  insert into records(collection,id,data) values('issues/'||ident||'/timeline',gen_random_uuid()::text,jsonb_build_object('kind','supplemented','text','Requester completed required information and submitted the ticket.','before',ticket-array['uploadSlots','reporterUid','reporterUsername','createdBy'],'after',result-array['uploadSlots','reporterUid','reporterUsername','createdBy'],'authorUid',uid_value,'author',sess->'user'->>'displayName','createdAt',tick));
  delete from pending_ticket_legacy where issue_id=ident;
  delete from attachment_drafts where issue_id=ident and owner_uid=uid_value;
  return jsonb_build_object('ok',true,'published',true,'id',ident);
 end if;
 result:=mes_private.dispatch_before_pending_completion(action,payload,actor);
 if action='attachFiles' then
  select data into ticket from records where collection='issues' and id=payload->>'issueId';
  if (ticket->'evidenceRequired'='true'::jsonb or exists(select 1 from pending_ticket_legacy where issue_id=payload->>'issueId')) and jsonb_array_length(ticket_missing_requirements(ticket))>0 then update records set data=data||'{"pendingEvidence":true}'::jsonb where collection='issues' and id=payload->>'issueId';return result||'{"published":false}'::jsonb;end if;
  if jsonb_array_length(ticket_missing_requirements(ticket))=0 then delete from pending_ticket_legacy where issue_id=payload->>'issueId';end if;
 end if;
 return result;
end $$;
create or replace function public.mes_view(action text,payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path=mes_private,pg_temp as $$
begin
 if (action='read' and payload->>'path' ~ '^issues/[a-zA-Z0-9_-]+/timeline$') or action='downloadUrl' then
  if exists(select 1 from records where collection='issues' and id=split_part(payload->>'path','/',2) and (data->'pendingEvidence'='true'::jsonb or exists(select 1 from pending_ticket_legacy q where q.issue_id=records.id))) then raise exception 'Ticket upload is not complete';end if;
 end if;
 return mes_private.visible_evidence_result(action,payload,mes_private.view_before_verified_evidence(action,payload));
end $$;
