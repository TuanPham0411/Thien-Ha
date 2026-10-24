-- Keep hpham as the sole owner; administrators manage workspace widget defaults.
alter table mes_private.credentials drop constraint credentials_role_check;
alter table mes_private.credentials add constraint credentials_role_check check(role in ('owner','admin','user'));
create function mes_private.validate_widgets(value jsonb) returns void language plpgsql set search_path=mes_private,pg_temp as $$
declare item jsonb;
begin
 if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)>16 then raise exception 'Invalid widget list';end if;
 for item in select v from jsonb_array_elements(value) v loop
  if jsonb_typeof(item)<>'string' or (item#>>'{}') not in ('metrics','notices','video','activity','incidents','status','performance','priority','types','department-progress','departments','recent','aging','priority-detail','resolution-detail','department-detail') then raise exception 'Unknown widget';end if;
 end loop;
end $$;
alter function public.mes_dispatch(text,jsonb,jsonb) rename to dispatch_before_dashboard_roles;
alter function public.dispatch_before_dashboard_roles(text,jsonb,jsonb) set schema mes_private;
create function public.mes_dispatch(action text,payload jsonb,actor jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=mes_private,extensions,pg_temp as $$
declare sess jsonb; result jsonb; uid_value text; role_value text; target text;
begin
 if action='getDashboardDefaults' then
  select data into result from records where collection='settings' and id='dashboardDefaults';
  return coalesce(result,'{"hidden":[]}'::jsonb);
 end if;
 if action in ('getSession','getDashboardPreferences','saveDashboardPreferences','resetDashboardPreferences','saveDashboardDefaults','setAccountRole') then
  sess:=mes_private.dispatch_before_dashboard_roles('getSession','{}',actor);
  uid_value:=sess->'user'->>'uid';
  if uid_value is null then raise exception 'Sign in first' using errcode='28000';end if;
  select role into role_value from credentials where uid=uid_value;
  role_value:=case when sess->>'isOwner'='true' then 'owner' when role_value='admin' and coalesce(sess->'user'->>'isTester','false')<>'true' then 'admin' else 'user' end;
  if action='getSession' then return sess||jsonb_build_object('role',role_value,'isAdmin',role_value in ('owner','admin'),'user',sess->'user'||jsonb_build_object('role',role_value));end if;
  if action='setAccountRole' then
   if role_value<>'owner' then raise exception 'Only owner can assign account roles';end if;
   target:=payload->>'uid';
   if target is null or target in ('mes-owner','mes-tester') or payload->>'role' is null or payload->>'role' not in ('admin','user') then raise exception 'Invalid account role';end if;
   perform 1 from records where collection='users' and id=target for update;
   if not found then raise exception 'Account unavailable';end if;
   update credentials set role=payload->>'role',revision=revision+1 where uid=target;
   if not found then raise exception 'Account unavailable';end if;
   update records set data=data||jsonb_build_object('role',payload->>'role') where collection='users' and id=target;
   delete from sessions where uid=target;
   return '{"ok":true}';
  end if;
  if action='saveDashboardDefaults' then
   if role_value not in ('owner','admin') then raise exception 'Administrator access required';end if;
   perform mes_private.validate_widgets(payload->'hidden');
   result:=jsonb_build_object('hidden',payload->'hidden');
   insert into records(collection,id,data) values('settings','dashboardDefaults',result) on conflict(collection,id) do update set data=excluded.data;
   return result;
  end if;
  if action='saveDashboardPreferences' then
   perform mes_private.validate_widgets(payload->'hidden');
   result:=jsonb_build_object('hidden',payload->'hidden');
   insert into records(collection,id,data) values('dashboardPreferences',uid_value,result) on conflict(collection,id) do update set data=excluded.data;
   return result||'{"customized":true}';
  end if;
  if action='resetDashboardPreferences' then delete from records where collection='dashboardPreferences' and id=uid_value;end if;
  select data into result from records where collection='dashboardPreferences' and id=uid_value;
  if result is not null then return result||'{"customized":true}';end if;
  select data into result from records where collection='settings' and id='dashboardDefaults';
  return coalesce(result,'{"hidden":[]}'::jsonb)||'{"customized":false}';
 end if;
 return mes_private.dispatch_before_dashboard_roles(action,payload,actor);
end $$;
revoke all on function mes_private.validate_widgets(jsonb) from public;
