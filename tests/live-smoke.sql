-- Run as the project database owner. Synthetic users and all mutations roll back.
begin;
do $$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();g uuid;p uuid;s jsonb;host_client uuid:=gen_random_uuid();viewer_client uuid:=gen_random_uuid();n integer;
begin
 insert into auth.users(id,email,raw_user_meta_data) values(a,a::text||'@example.invalid','{"display_name":"QA Host"}'),(b,b::text||'@example.invalid','{"display_name":"QA Viewer"}'),(outsider,outsider::text||'@example.invalid','{"display_name":"QA Outsider"}');
 perform set_config('request.jwt.claim.sub',a::text,true);set local role authenticated;
 g:=(public.prop_command('create_group','{"name":"Rollback QA"}') ->> 'id')::uuid;
 perform public.manage_group(g,'invite',jsonb_build_object('user_id',b));
 p:=(public.prop_command('create',jsonb_build_object('group_id',g,'title','Two sixes in the completed test over?','sport','Cricket','side','yes','stake',20,'entry_type','fixed','entry_amount',20,'minutes',5)) ->> 'id')::uuid;
 perform set_config('request.jwt.claim.sub',b::text,true);
 perform public.prop_command('join',jsonb_build_object('prop_id',p,'side','no','stake',20));
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform public.prop_command('lock',jsonb_build_object('prop_id',p));
 perform public.prop_command('await',jsonb_build_object('prop_id',p));
 perform public.prop_command('propose',jsonb_build_object('prop_id',p,'side','yes','evidence','Synthetic evidence for transaction rollback verification.'));
 perform public.prop_command('vote',jsonb_build_object('prop_id',p,'approve',true));
 if (select status from public.custom_props where id=p)<>'proposed' then raise exception 'One vote incorrectly confirmed a majority';end if;
 perform set_config('request.jwt.claim.sub',b::text,true);
 perform public.prop_command('vote',jsonb_build_object('prop_id',p,'approve',true));
 perform public.prop_command('settle',jsonb_build_object('prop_id',p));
 if (select balance from public.profiles where id=a)<>1020 or (select balance from public.profiles where id=b)<>980 then raise exception 'Incorrect payout';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 s:=public.broadcast_control('start',g,host_client);
 perform set_config('request.jwt.claim.sub',b::text,true);
 perform public.broadcast_signal((s->>'id')::uuid,viewer_client,a,host_client,'{"type":"ready"}');
 if (select count(*) from public.broadcast_signals where session_id=(s->>'id')::uuid)<>0 then raise exception 'Viewer read host inbox';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 if (select count(*) from public.broadcast_signals where session_id=(s->>'id')::uuid)<>1 then raise exception 'Host did not receive signal';end if;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 if exists(select 1 from public.groups where id=g) then raise exception 'Outsider read private group';end if;
 reset role;
end $$;
select 'Live Postgres: quorum, payout, RLS and private signaling passed; all test data rolled back' as result;
rollback;
