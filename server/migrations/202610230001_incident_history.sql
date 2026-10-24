-- Project only the state transitions needed by analytics; comments, assessment,
-- authors and private account fields never enter the dashboard history.
create function mes_private.incident_history_result(action text,payload jsonb,result jsonb) returns jsonb language plpgsql security definer set search_path=mes_private,pg_temp as $$
declare output jsonb; histories jsonb; k text; item jsonb;
begin
 if action='readBundle' then
  output:='{}';
  for k,item in select * from jsonb_each(result->'snapshots') loop
   output:=output||jsonb_build_object(k,mes_private.incident_history_result('read',jsonb_build_object('path',k),item));
  end loop;
  return result||jsonb_build_object('snapshots',output);
 end if;
 if action<>'read' or payload->>'path' not in ('issues','myIssues') then return result;end if;
 if not exists(select 1 from jsonb_array_elements(result->'rows') i where not i ? 'analysisHistory') then return result;end if;
 select coalesce(jsonb_object_agg(issue_id,events),'{}') into histories from (
  select split_part(r.collection,'/',2) issue_id,jsonb_agg(jsonb_build_object(
   'at',r.data->'createdAt',
   'beforePriority',case when r.data->>'kind'='edit' then r.data->'before'->>'priority' else (regexp_match(r.data->>'text','Priority: (Low|Medium|High|Critical) → (Low|Medium|High|Critical)\.'))[1] end,
   'priority',case when r.data->>'kind'='edit' then r.data->'after'->>'priority' else (regexp_match(r.data->>'text','Priority: (Low|Medium|High|Critical) → (Low|Medium|High|Critical)\.'))[2] end,
   'beforeStatus',case when r.data->>'kind'='edit' then r.data->'before'->>'status' else (regexp_match(r.data->>'text','^Status: (New|Acknowledged|In progress|Awaiting information|Resolved|Closed) → (New|Acknowledged|In progress|Awaiting information|Resolved|Closed)\.'))[1] end,
   'status',case when r.data->>'kind'='edit' then r.data->'after'->>'status' else (regexp_match(r.data->>'text','^Status: (New|Acknowledged|In progress|Awaiting information|Resolved|Closed) → (New|Acknowledged|In progress|Awaiting information|Resolved|Closed)\.'))[2] end
  ) order by (r.data->>'createdAt')::bigint,r.seq) events
  from records r join jsonb_array_elements(result->'rows') i on r.collection='issues/'||(i->>'id')||'/timeline'
  where r.data->>'kind' in ('handling','edit') group by r.collection
 ) h;
 select coalesce(jsonb_agg(i||jsonb_build_object('analysisHistory',coalesce(histories->(i->>'id'),'[]')) order by ord),'[]') into output from jsonb_array_elements(result->'rows') with ordinality a(i,ord);
 return result||jsonb_build_object('rows',output);
end $$;
alter function public.mes_dispatch(text,jsonb,jsonb) rename to dispatch_before_incident_history;
alter function public.dispatch_before_incident_history(text,jsonb,jsonb) set schema mes_private;
create function public.mes_dispatch(action text,payload jsonb,actor jsonb default '{}'::jsonb) returns jsonb language sql security definer set search_path=mes_private,pg_temp as $$
 select mes_private.incident_history_result(action,payload,mes_private.dispatch_before_incident_history(action,payload,actor));
$$;
alter function public.mes_view(text,jsonb) rename to view_before_incident_history;
alter function public.view_before_incident_history(text,jsonb) set schema mes_private;
create function public.mes_view(action text,payload jsonb default '{}'::jsonb) returns jsonb language sql security definer set search_path=mes_private,pg_temp as $$
 select mes_private.incident_history_result(action,payload,mes_private.view_before_incident_history(action,payload));
$$;
revoke all on function mes_private.incident_history_result(text,jsonb,jsonb) from public;
