-- Account-scoped chart colors, independent of widget and appearance preferences.
alter function public.mes_dispatch(text,jsonb,jsonb) rename to dispatch_before_incident_colors;
alter function public.dispatch_before_incident_colors(text,jsonb,jsonb) set schema mes_private;
create function public.mes_dispatch(action text,payload jsonb,actor jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=mes_private,extensions,pg_temp as $$
declare sess jsonb; uid_value text; result jsonb; item record;
begin
 if action in ('getIncidentColors','saveIncidentColors') then
  sess:=mes_private.dispatch_before_incident_colors('getSession','{}',actor);uid_value:=sess->'user'->>'uid';
  if uid_value is null then raise exception 'Sign in first' using errcode='28000';end if;
  if action='getIncidentColors' then
   select data into result from records where collection='incidentColors' and id=uid_value;
   return coalesce(result,'{}'::jsonb);
  end if;
  if payload ? 'line' and (jsonb_typeof(payload->'line') is distinct from 'string' or payload->>'line' !~ '^#[0-9a-fA-F]{6}$') then raise exception 'Invalid line color';end if;
  if jsonb_typeof(payload->'departments') is distinct from 'object' or octet_length((payload->'departments')::text)>20000 then raise exception 'Invalid department colors';end if;
  for item in select * from jsonb_each(payload->'departments') loop
   if length(item.key)>160 or jsonb_typeof(item.value)<>'string' or item.value#>>'{}' !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Invalid department color';end if;
  end loop;
  result:=jsonb_build_object('departments',payload->'departments');if payload ? 'line' then result:=result||jsonb_build_object('line',payload->'line');end if;
  insert into records(collection,id,data) values('incidentColors',uid_value,result) on conflict(collection,id) do update set data=excluded.data;
  return result;
 end if;
 return mes_private.dispatch_before_incident_colors(action,payload,actor);
end $$;
