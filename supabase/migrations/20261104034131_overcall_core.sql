-- All currency is non-purchasable, non-redeemable virtual tokens.
create schema if not exists private;
revoke all on schema private from public;
create type public.prop_status as enum ('draft','open','locked','awaiting_result','proposed','confirmed','settled','voided');
create table public.profiles (id uuid primary key references auth.users(id), display_name text not null check(length(display_name) between 1 and 80), balance bigint not null default 1000 check(balance>=0), last_reward date);
create table public.groups (id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 80), owner_id uuid not null references profiles(id), created_at timestamptz not null default now());
create table public.group_members (group_id uuid references groups(id) on delete cascade, user_id uuid references profiles(id), missed_props integer not null default 0, primary key(group_id,user_id));
create index member_user_idx on public.group_members(user_id);
create table public.group_settings (group_id uuid primary key references groups(id) on delete cascade, strict_mode boolean not null default false, confirmation_rule text not null default 'majority' check(confirmation_rule in ('majority','initiator_plus_one','admin')), who_can_create_props text not null default 'members' check(who_can_create_props in ('members','admin')), ai_confidence_threshold numeric not null default .85 check(ai_confidence_threshold between 0 and 1));
create table public.custom_props (id uuid primary key default gen_random_uuid(), group_id uuid not null references groups(id), creator_id uuid not null references profiles(id), title text not null check(length(title) between 10 and 240), sport text not null check(sport in ('Cricket','NBA','NFL','Soccer','MLB','NHL')), status prop_status not null default 'draft', entry_type text not null check(entry_type in ('free','fixed','match')), entry_amount bigint not null check(entry_amount>0), initial_stake bigint not null check(initial_stake>0), lock_type text not null default 'timer' check(lock_type in ('timer','manual','event')), lock_at timestamptz not null, result text check(result in ('yes','no')), void_reason text, active_proposal_id uuid, confirmation_rule text not null check(confirmation_rule in ('majority','initiator_plus_one','admin')), vision_active boolean not null default false, vision_last_at timestamptz, created_at timestamptz not null default now());
create index props_group_status_idx on public.custom_props(group_id,status,created_at desc);
create table public.custom_prop_entries (id uuid primary key default gen_random_uuid(), prop_id uuid not null references custom_props(id), user_id uuid not null references profiles(id), side text not null check(side in ('yes','no')), stake bigint not null check(stake>0), created_at timestamptz not null default now(), unique(prop_id,user_id));
create index entries_user_idx on public.custom_prop_entries(user_id);
create table public.prop_expected_members (prop_id uuid references custom_props(id), user_id uuid references profiles(id), primary key(prop_id,user_id));
create table public.custom_prop_proposals (id uuid primary key default gen_random_uuid(), prop_id uuid not null references custom_props(id), author_id uuid not null references profiles(id), side text not null check(side in ('yes','no')), source text not null check(source in ('ai','human')), evidence text not null check(length(evidence) between 1 and 4000), confidence numeric check(confidence between 0 and 1), created_at timestamptz not null default now());
create index proposals_prop_idx on public.custom_prop_proposals(prop_id);
alter table public.custom_props add constraint active_proposal_fk foreign key(active_proposal_id) references custom_prop_proposals(id);
create table public.custom_prop_votes (proposal_id uuid references custom_prop_proposals(id), user_id uuid references profiles(id), approve boolean not null, primary key(proposal_id,user_id));
create table public.prop_vision_logs (id uuid primary key default gen_random_uuid(), prop_id uuid not null references custom_props(id), requested_by uuid not null references profiles(id), source text not null check(source in ('screenshare','upload')), raw_output jsonb not null, structured_result jsonb, confidence numeric check(confidence between 0 and 1), created_at timestamptz not null default now());
create index vision_prop_time_idx on public.prop_vision_logs(prop_id,created_at desc);
create table public.token_transactions (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id), prop_id uuid references custom_props(id), amount bigint not null, kind text not null check(kind in ('grant','stake','payout','refund','daily')), created_at timestamptz not null default now());
create index ledger_user_time_idx on public.token_transactions(user_id,created_at desc);
create unique index ledger_once_idx on public.token_transactions(user_id,prop_id,kind) where prop_id is not null;
create table public.chat_messages (id uuid primary key default gen_random_uuid(), group_id uuid not null references groups(id), user_id uuid not null references profiles(id), body text not null check(length(body) between 1 and 2000), created_at timestamptz not null default now());
create index chat_group_time_idx on public.chat_messages(group_id,created_at);
create table public.follows (follower_id uuid references profiles(id), following_id uuid references profiles(id), primary key(follower_id,following_id), check(follower_id<>following_id));
create table public.feed_posts (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id), body text not null check(length(body) between 1 and 1000), created_at timestamptz not null default now());
create index feed_time_idx on public.feed_posts(created_at desc);

-- Only guarded functions may write balances, entries, proposals, votes, and state.
create function private.member(g uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.group_members where group_id=g and user_id=auth.uid()) $$;
create function private.prop_member(p uuid) returns boolean language sql stable security definer set search_path='' as $$ select private.member(group_id) from public.custom_props where id=p $$;
grant usage on schema private to authenticated;
grant execute on function private.member(uuid), private.prop_member(uuid) to authenticated;
do $$ declare t text; begin foreach t in array array['profiles','groups','group_members','group_settings','custom_props','custom_prop_entries','prop_expected_members','custom_prop_proposals','custom_prop_votes','prop_vision_logs','token_transactions','chat_messages','follows','feed_posts'] loop execute format('alter table public.%I enable row level security',t); execute format('grant select on public.%I to authenticated',t); end loop; end $$;
create policy profile_read on public.profiles for select to authenticated using (id=auth.uid() or exists(select 1 from public.group_members a join public.group_members b using(group_id) where a.user_id=auth.uid() and b.user_id=profiles.id));
create policy group_read on public.groups for select to authenticated using(private.member(id));
create policy member_read on public.group_members for select to authenticated using(private.member(group_id));
create policy settings_read on public.group_settings for select to authenticated using(private.member(group_id));
create policy prop_read on public.custom_props for select to authenticated using(private.member(group_id));
create policy entry_read on public.custom_prop_entries for select to authenticated using(private.prop_member(prop_id));
create policy expected_read on public.prop_expected_members for select to authenticated using(private.prop_member(prop_id));
create policy proposal_read on public.custom_prop_proposals for select to authenticated using(private.prop_member(prop_id));
create policy vote_read on public.custom_prop_votes for select to authenticated using(exists(select 1 from public.custom_prop_proposals p where p.id=proposal_id));
create policy vision_read on public.prop_vision_logs for select to authenticated using(private.prop_member(prop_id));
create policy ledger_read on public.token_transactions for select to authenticated using(user_id=auth.uid());
create policy chat_read on public.chat_messages for select to authenticated using(private.member(group_id));
create policy chat_write on public.chat_messages for insert to authenticated with check(user_id=auth.uid() and private.member(group_id));
create policy follows_read on public.follows for select to authenticated using(follower_id=auth.uid());
create policy follows_write on public.follows for insert to authenticated with check(follower_id=auth.uid());
create policy follows_delete on public.follows for delete to authenticated using(follower_id=auth.uid());
create policy feed_read on public.feed_posts for select to authenticated using(true);
create policy feed_write on public.feed_posts for insert to authenticated with check(user_id=auth.uid());
grant insert on public.chat_messages,public.follows,public.feed_posts to authenticated;
grant delete on public.follows to authenticated;

create function private.bootstrap() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.profiles(id,display_name) values(new.id, left(coalesce(nullif(new.raw_user_meta_data->>'display_name',''),split_part(new.email,'@',1),'Friend'),80)); insert into public.token_transactions(user_id,amount,kind) values(new.id,1000,'grant'); return new; end $$;
create trigger new_profile after insert on auth.users for each row execute function private.bootstrap();

create function private.command(action text, payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); p public.custom_props; g uuid; pid uuid; s public.group_settings; n bigint; e record; q public.custom_prop_proposals; approvals integer; participants integer; ok boolean:=false; total bigint; winning bigint; paid bigint:=0; share bigint; vside text; remaining bigint;
begin
 if u is null then raise exception 'Authentication required'; end if;
 -- A per-group lock serializes wallet operations for that group; wallets additionally lock in UUID order on settlement.
 if action='create_group' then
  if length(trim(payload->>'name')) not between 1 and 80 then raise exception 'Invalid group name'; end if;
  insert into public.groups(name,owner_id) values(trim(payload->>'name'),u) returning id into g;
  insert into public.group_members values(g,u,0); insert into public.group_settings(group_id) values(g); return jsonb_build_object('id',g);
 end if;
 if action='daily' then
  update public.profiles set balance=balance+50,last_reward=current_date where id=u and last_reward is distinct from current_date;
  if found then insert into public.token_transactions(user_id,amount,kind) values(u,50,'daily'); else raise exception 'Daily reward already claimed'; end if; return '{}'::jsonb;
 end if;
 if action='create' then
  g:=(payload->>'group_id')::uuid;
  if not private.member(g) then raise exception 'Group membership required'; end if;
  perform 1 from public.groups where id=g for update;
  select * into s from public.group_settings where group_id=g;
  if s.who_can_create_props='admin' and not exists(select 1 from public.groups where id=g and owner_id=u) then raise exception 'Admin required'; end if;
  n:=(payload->>'stake')::bigint;
  if n is null or n<1 or n>100000 or (payload->>'minutes')::int not between 1 and 1440 then raise exception 'Invalid stake or timer'; end if;
  insert into public.custom_props(group_id,creator_id,title,sport,status,entry_type,entry_amount,initial_stake,lock_at,lock_type,confirmation_rule) values(g,u,payload->>'title',payload->>'sport','open',payload->>'entry_type',(payload->>'entry_amount')::bigint,n,now()+make_interval(mins=>(payload->>'minutes')::int),coalesce(payload->>'lock_type','timer'),s.confirmation_rule) returning * into p;
  insert into public.prop_expected_members select p.id,user_id from public.group_members where group_id=g;
  update public.profiles set balance=balance-n where id=u and balance>=n; if not found then raise exception 'Insufficient tokens'; end if;
  insert into public.custom_prop_entries(prop_id,user_id,side,stake) values(p.id,u,payload->>'side',n);
  insert into public.token_transactions(user_id,prop_id,amount,kind) values(u,p.id,-n,'stake'); return to_jsonb(p);
 end if;
 pid:=(payload->>'prop_id')::uuid;
 -- Group is fetched before row locking to keep the group -> prop -> wallets lock order consistent.
 select group_id into g from public.custom_props where id=pid;
 if not private.member(g) then raise exception 'Group membership required'; end if;
 perform 1 from public.groups where id=g for update;
 select * into p from public.custom_props where id=pid for update;
 if action='join' then
  if p.status<>'open' or (p.lock_type='timer' and now()>=p.lock_at) then raise exception 'Entries are permanently closed'; end if;
  n:=(payload->>'stake')::bigint;
  if n is null or n<1 or n>100000 then raise exception 'Invalid stake'; end if;
  -- Free entry means no fixed buy-in; each participant still chooses a positive virtual stake.
  if (p.entry_type='fixed' and n<>p.entry_amount) or (p.entry_type='match' and n<>p.initial_stake) then raise exception 'Stake does not meet entry rule'; end if;
  insert into public.custom_prop_entries(prop_id,user_id,side,stake) values(pid,u,payload->>'side',n);
  update public.profiles set balance=balance-n where id=u and balance>=n; if not found then raise exception 'Insufficient tokens'; end if;
  insert into public.token_transactions(user_id,prop_id,amount,kind) values(u,pid,-n,'stake');
 elsif action='lock' then
  if p.status<>'open' then raise exception 'Prop is not open'; end if;
  if u<>p.creator_id and not exists(select 1 from public.groups where id=g and owner_id=u) and not(p.lock_type='timer' and now()>=p.lock_at) then raise exception 'Creator or admin must lock'; end if;
  update public.custom_props set status='locked' where id=pid;
  update public.group_members m set missed_props=missed_props+1 where m.group_id=g and exists(select 1 from public.group_settings where group_id=g and strict_mode) and exists(select 1 from public.prop_expected_members x where x.prop_id=pid and x.user_id=m.user_id) and not exists(select 1 from public.custom_prop_entries x where x.prop_id=pid and x.user_id=m.user_id);
 elsif action='await' then
  if p.status<>'locked' then raise exception 'Lock the prop first'; end if;
  update public.custom_props set status='awaiting_result' where id=pid;
 elsif action in ('vision_start','vision_stop') then
  if p.status<>'awaiting_result' then raise exception 'Result collection is not active'; end if;
  update public.custom_props set vision_active=(action='vision_start') where id=pid;
 elsif action='propose' then
  if p.status<>'awaiting_result' then raise exception 'Not awaiting a proposal'; end if;
  if not exists(select 1 from public.custom_prop_entries where prop_id=pid and user_id=u) and not exists(select 1 from public.groups where id=g and owner_id=u) then raise exception 'Participant or admin required'; end if;
  insert into public.custom_prop_proposals(prop_id,author_id,side,source,evidence) values(pid,u,payload->>'side','human',payload->>'evidence') returning * into q;
  update public.custom_props set status='proposed',active_proposal_id=q.id,vision_active=false where id=pid;
 elsif action='vote' then
  if p.status<>'proposed' then raise exception 'No active proposal'; end if;
  if not exists(select 1 from public.custom_prop_entries where prop_id=pid and user_id=u) and not(p.confirmation_rule='admin' and exists(select 1 from public.groups where id=g and owner_id=u)) then raise exception 'Only eligible voters may confirm'; end if;
  insert into public.custom_prop_votes values(p.active_proposal_id,u,(payload->>'approve')::boolean) on conflict(proposal_id,user_id) do update set approve=excluded.approve;
  select count(*) into participants from public.custom_prop_entries where prop_id=pid;
  select count(*) into approvals from public.custom_prop_votes v join public.custom_prop_entries ent on ent.user_id=v.user_id and ent.prop_id=pid where proposal_id=p.active_proposal_id and approve;
  if p.confirmation_rule='majority' then ok:=approvals>participants/2;
  elsif p.confirmation_rule='initiator_plus_one' then ok:=approvals>=2 and exists(select 1 from public.custom_prop_votes where proposal_id=p.active_proposal_id and user_id=p.creator_id and approve);
  else ok:=exists(select 1 from public.custom_prop_votes v join public.groups a on a.owner_id=v.user_id where a.id=g and v.proposal_id=p.active_proposal_id and v.approve); end if;
  if ok then select * into q from public.custom_prop_proposals where id=p.active_proposal_id; update public.custom_props set status='confirmed',result=q.side where id=pid;
  elsif (select count(*) from public.custom_prop_votes where proposal_id=p.active_proposal_id and not approve)>participants/2 then update public.custom_props set status='awaiting_result',active_proposal_id=null where id=pid; end if;
 elsif action='void' then
  if not exists(select 1 from public.groups where id=g and owner_id=u) then raise exception 'Only group admin can void'; end if;
  if p.status in ('settled','voided') then raise exception 'Already final'; end if;
  if coalesce(length(trim(payload->>'reason')),0)<5 then raise exception 'A clear void reason is required'; end if;
  perform 1 from public.profiles where id in(select user_id from public.custom_prop_entries where prop_id=pid) order by id for update;
  for e in select * from public.custom_prop_entries where prop_id=pid order by user_id loop
   update public.profiles set balance=balance+e.stake where id=e.user_id; insert into public.token_transactions(user_id,prop_id,amount,kind) values(e.user_id,pid,e.stake,'refund');
  end loop;
  update public.custom_props set status='voided',void_reason=payload->>'reason',vision_active=false where id=pid;
 elsif action='settle' then
  if p.status<>'confirmed' then raise exception 'Human confirmation required'; end if;
  select sum(stake),sum(stake) filter(where side=p.result) into total,winning from public.custom_prop_entries where prop_id=pid;
  if winning is null or winning=0 or winning=total then raise exception 'Both sides require stake; admin must void for full refunds'; end if;
  perform 1 from public.profiles where id in(select user_id from public.custom_prop_entries where prop_id=pid) order by id for update;
  select total-sum(floor(total::numeric*stake/winning)) into remaining from public.custom_prop_entries where prop_id=pid and side=p.result;
  for e in select * from public.custom_prop_entries where prop_id=pid and side=p.result order by id loop
   share:=floor(total::numeric*e.stake/winning); if remaining>0 then share:=share+1; remaining:=remaining-1; end if;
   update public.profiles set balance=balance+share where id=e.user_id; insert into public.token_transactions(user_id,prop_id,amount,kind) values(e.user_id,pid,share,'payout'); paid:=paid+share;
  end loop;
  if paid<>total then raise exception 'Token conservation failure'; end if;
  update public.custom_props set status='settled',vision_active=false where id=pid;
 else raise exception 'Unknown action'; end if;
 select * into p from public.custom_props where id=pid; return to_jsonb(p);
end $$;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.member(uuid),private.prop_member(uuid),private.command(text,jsonb) to authenticated;
create function public.prop_command(action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.command(action,payload) $$;
revoke all on function public.prop_command(text,jsonb) from public,anon;
grant execute on function public.prop_command(text,jsonb) to authenticated;

-- Only the server-side vision function can record AI data; this cannot confirm or settle.
create function public.record_vision(pid uuid, actor uuid, source_kind text, data jsonb, attempt uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare p public.custom_props; q uuid;
begin
 select * into p from public.custom_props where id=pid for update;
 if not exists(select 1 from public.group_members where group_id=p.group_id and user_id=actor) then raise exception 'Group membership required'; end if;
 if p.status<>'awaiting_result' or not p.vision_active then raise exception 'Vision session is inactive'; end if;
 if attempt is null then
  insert into public.prop_vision_logs(prop_id,requested_by,source,raw_output,structured_result,confidence) values(pid,actor,source_kind,data,data,(data->>'confidence')::numeric);
 else
  update public.prop_vision_logs set structured_result=data,confidence=(data->>'confidence')::numeric,raw_output=jsonb_build_object('status','completed','extraction',data) where id=attempt and prop_id=pid and requested_by=actor and source=source_kind and raw_output->>'status'='pending';
  if not found then raise exception 'Invalid analysis attempt'; end if;
 end if;
 if (data->>'sufficient_evidence')::boolean and data->>'suggested_side' in ('yes','no') and (data->>'confidence')::numeric >= (select ai_confidence_threshold from public.group_settings where group_id=p.group_id) then
  insert into public.custom_prop_proposals(prop_id,author_id,side,source,evidence,confidence) values(pid,actor,data->>'suggested_side','ai',data->>'explanation',(data->>'confidence')::numeric) returning id into q;
  update public.custom_props set status='proposed',active_proposal_id=q,vision_active=false where id=pid;
 end if;
end $$;
revoke all on function public.record_vision(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.record_vision(uuid,uuid,text,jsonb,uuid) to service_role;
-- Private evidence bucket; screenshots are processed inline by the edge function, not published.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('prop-evidence','prop-evidence',false,5242880,array['image/jpeg','image/png','image/webp']);
-- Realtime consumers still pass through SELECT policies.
alter publication supabase_realtime add table public.custom_props, public.custom_prop_entries, public.custom_prop_votes, public.chat_messages, public.token_transactions, public.feed_posts;

create function public.manage_group(gid uuid,action text,payload jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.groups where id=gid and owner_id=auth.uid()) then raise exception 'Group admin required'; end if;
 perform 1 from public.groups where id=gid for update;
 if action='invite' then
  if (select count(*) from public.group_members where group_id=gid)>=10 then raise exception 'Groups support up to 10 friends'; end if;
  insert into public.group_members(group_id,user_id) values(gid,(payload->>'user_id')::uuid);
 elsif action='settings' then
  update public.group_settings set strict_mode=(payload->>'strict_mode')::boolean, confirmation_rule=payload->>'confirmation_rule',who_can_create_props=payload->>'who_can_create_props',ai_confidence_threshold=(payload->>'ai_confidence_threshold')::numeric where group_id=gid;
 else raise exception 'Unknown group action'; end if;
end $$;
revoke all on function public.manage_group(uuid,text,jsonb) from public,anon;
grant execute on function public.manage_group(uuid,text,jsonb) to authenticated;

-- A committed claim prevents parallel requests from bypassing per-prop vision throttling.
create function public.claim_vision(pid uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.prop_member(pid) then raise exception 'Group membership required'; end if;
 update public.custom_props set vision_last_at=clock_timestamp() where id=pid and status='awaiting_result' and vision_active and (vision_last_at is null or vision_last_at<clock_timestamp()-interval '15 seconds');
 return found;
end $$;
revoke all on function public.claim_vision(uuid) from public,anon;
grant execute on function public.claim_vision(uuid) to authenticated;

create function public.begin_vision_attempt(pid uuid,actor uuid,source_kind text) returns uuid language plpgsql security definer set search_path='' as $$
declare attempt uuid;
begin
 if not exists(select 1 from public.custom_props p join public.group_members m on m.group_id=p.group_id where p.id=pid and m.user_id=actor and p.status='awaiting_result' and p.vision_active) then raise exception 'Inactive or unauthorized session'; end if;
 insert into public.prop_vision_logs(prop_id,requested_by,source,raw_output) values(pid,actor,source_kind,'{"status":"pending"}') returning id into attempt;
 return attempt;
end $$;
create function public.fail_vision_attempt(attempt uuid) returns void language sql security definer set search_path='' as $$
 update public.prop_vision_logs set raw_output='{"status":"failed","error":"Provider request, validation, or state conflict"}' where id=attempt and raw_output->>'status'='pending';
$$;
revoke all on function public.begin_vision_attempt(uuid,uuid,text),public.fail_vision_attempt(uuid) from public,anon,authenticated;
grant execute on function public.begin_vision_attempt(uuid,uuid,text),public.fail_vision_attempt(uuid) to service_role;
