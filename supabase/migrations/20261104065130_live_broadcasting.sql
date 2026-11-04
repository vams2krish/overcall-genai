create table public.broadcast_sessions (
 id uuid primary key default gen_random_uuid(),group_id uuid not null references public.groups(id),
 host_id uuid not null references public.profiles(id),host_client uuid not null,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '90 seconds',ended_at timestamptz
);
create unique index broadcast_one_host on public.broadcast_sessions(group_id) where ended_at is null;
create table public.broadcast_signals (
 id bigint generated always as identity primary key,session_id uuid not null references public.broadcast_sessions(id) on delete cascade,
 sender_id uuid not null references public.profiles(id),sender_client uuid not null,
 receiver_id uuid not null references public.profiles(id),receiver_client uuid not null,
 payload jsonb not null check(octet_length(payload::text)<=65536),created_at timestamptz not null default now()
);
create index broadcast_inbox on public.broadcast_signals(receiver_id,receiver_client,id);
create index broadcast_signal_session on public.broadcast_signals(session_id,created_at);
alter table public.broadcast_sessions enable row level security;
alter table public.broadcast_signals enable row level security;
grant select on public.broadcast_sessions,public.broadcast_signals to authenticated;
grant delete on public.broadcast_signals to authenticated;
create policy broadcast_session_read on public.broadcast_sessions for select to authenticated using(private.member(group_id));
create policy broadcast_signal_read on public.broadcast_signals for select to authenticated using(receiver_id=(select auth.uid()) and exists(select 1 from public.broadcast_sessions s where s.id=session_id and private.member(s.group_id) and s.ended_at is null and s.expires_at>now()));
create policy broadcast_signal_delete on public.broadcast_signals for delete to authenticated using(receiver_id=(select auth.uid()));

create function public.broadcast_control(action text,gid uuid,client uuid,sid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.broadcast_sessions;u uuid:=auth.uid();
begin
 if u is null or not private.member(gid) then raise exception 'Group membership required';end if;
 perform 1 from public.groups where id=gid for update;
 if action='start' then
  update public.broadcast_sessions set ended_at=now() where group_id=gid and ended_at is null and expires_at<=now();
  select * into s from public.broadcast_sessions where group_id=gid and ended_at is null;
  if found then raise exception 'A group member is already broadcasting';end if;
  insert into public.broadcast_sessions(group_id,host_id,host_client) values(gid,u,client) returning * into s;
 elsif action='heartbeat' then
  update public.broadcast_sessions set expires_at=now()+interval '90 seconds' where id=sid and group_id=gid and host_id=u and host_client=client and ended_at is null and expires_at>now() returning * into s;
  if not found then raise exception 'Broadcast lease expired';end if;
 elsif action='stop' then
  update public.broadcast_sessions set ended_at=now() where id=sid and group_id=gid and host_id=u and host_client=client and ended_at is null returning * into s;
  if not found then raise exception 'Only the current broadcaster can stop this session';end if;
 else raise exception 'Unknown broadcast action';end if;
 -- Signaling is ephemeral: collect expired/ended session messages on control operations.
 delete from public.broadcast_signals where created_at<now()-interval '2 minutes' or session_id in(select id from public.broadcast_sessions where ended_at is not null or expires_at<=now());
 return to_jsonb(s);
end $$;
revoke all on function public.broadcast_control(text,uuid,uuid,uuid) from public,anon;
grant execute on function public.broadcast_control(text,uuid,uuid,uuid) to authenticated;

create function public.broadcast_signal(sid uuid,client uuid,recipient uuid,recipient_client uuid,message jsonb) returns void language plpgsql security definer set search_path='' as $$
declare s public.broadcast_sessions;u uuid:=auth.uid();kind text:=message->>'type';
begin
 select * into s from public.broadcast_sessions where id=sid;
 if u is null or not private.member(s.group_id) or s.ended_at is not null or s.expires_at<=now() then raise exception 'Inactive or unauthorized broadcast';end if;
 if not exists(select 1 from public.group_members where group_id=s.group_id and user_id=recipient) then raise exception 'Recipient is not a group member';end if;
 if client is null or recipient_client is null or octet_length(message::text)>65536 then raise exception 'Invalid signal';end if;
 if kind not in ('ready','offer','answer','candidate','leave') or kind is null then raise exception 'Invalid signal type';end if;
 if u=s.host_id and client=s.host_client then
  if kind not in ('offer','candidate') then raise exception 'Invalid host signal';end if;
 else
  if recipient<>s.host_id or recipient_client<>s.host_client or kind not in ('ready','answer','candidate','leave') then raise exception 'Viewers may signal only the broadcaster';end if;
 end if;
 if (select count(*) from public.broadcast_signals where sender_id=u and created_at>now()-interval '1 minute')>=600 then raise exception 'Signaling rate limit';end if;
 insert into public.broadcast_signals(session_id,sender_id,sender_client,receiver_id,receiver_client,payload) values(sid,u,client,recipient,recipient_client,message);
end $$;
revoke all on function public.broadcast_signal(uuid,uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.broadcast_signal(uuid,uuid,uuid,uuid,jsonb) to authenticated;
alter publication supabase_realtime add table public.broadcast_sessions,public.broadcast_signals;
