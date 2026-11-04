-- Keep privileged implementations outside exposed API schemas. The public APIs
-- retain the same signatures and use caller-privilege wrappers.
alter function public.manage_group(uuid,text,jsonb) set schema private;
alter function public.claim_vision(uuid) set schema private;
alter function public.broadcast_control(text,uuid,uuid,uuid) set schema private;
alter function public.broadcast_signal(uuid,uuid,uuid,uuid,jsonb) set schema private;
create function public.manage_group(gid uuid,action text,payload jsonb) returns void language sql security invoker set search_path='' as $$select private.manage_group(gid,action,payload)$$;
create function public.claim_vision(pid uuid) returns boolean language sql security invoker set search_path='' as $$select private.claim_vision(pid)$$;
create function public.broadcast_control(action text,gid uuid,client uuid,sid uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.broadcast_control(action,gid,client,sid)$$;
create function public.broadcast_signal(sid uuid,client uuid,recipient uuid,recipient_client uuid,message jsonb) returns void language sql security invoker set search_path='' as $$select private.broadcast_signal(sid,client,recipient,recipient_client,message)$$;
revoke all on function public.manage_group(uuid,text,jsonb),public.claim_vision(uuid),public.broadcast_control(text,uuid,uuid,uuid),public.broadcast_signal(uuid,uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.manage_group(uuid,text,jsonb),public.claim_vision(uuid),public.broadcast_control(text,uuid,uuid,uuid),public.broadcast_signal(uuid,uuid,uuid,uuid,jsonb) to authenticated;

create index broadcast_host_idx on public.broadcast_sessions(host_id);
create index broadcast_sender_idx on public.broadcast_signals(sender_id,created_at);
create index chat_user_idx on public.chat_messages(user_id);
create index proposal_author_idx on public.custom_prop_proposals(author_id);
create index vote_user_idx on public.custom_prop_votes(user_id);
create index prop_active_proposal_idx on public.custom_props(active_proposal_id);
create index prop_creator_idx on public.custom_props(creator_id);
create index feed_author_idx on public.feed_posts(user_id);
create index follow_target_idx on public.follows(following_id);
create index group_owner_idx on public.groups(owner_id);
create index expected_user_idx on public.prop_expected_members(user_id);
create index vision_requester_idx on public.prop_vision_logs(requested_by);
create index ledger_prop_idx on public.token_transactions(prop_id);

alter policy profile_read on public.profiles using (id=(select auth.uid()) or exists(select 1 from public.group_members a join public.group_members b using(group_id) where a.user_id=(select auth.uid()) and b.user_id=profiles.id));
alter policy ledger_read on public.token_transactions using(user_id=(select auth.uid()));
alter policy chat_write on public.chat_messages with check(user_id=(select auth.uid()) and private.member(group_id));
alter policy follows_read on public.follows using(follower_id=(select auth.uid()));
alter policy follows_write on public.follows with check(follower_id=(select auth.uid()));
alter policy follows_delete on public.follows using(follower_id=(select auth.uid()));
alter policy feed_write on public.feed_posts with check(user_id=(select auth.uid()));
