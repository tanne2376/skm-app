-- ============================================================
-- FIX: get_user_late_cancellation_history return-type mismatch
-- ============================================================
-- The 20260915230037 security hotfix (NULL-bypass fix) recreated this
-- function without the `::text` cast on cs.start_time, even though the
-- RETURNS TABLE signature declares session_start_time as text. Postgres
-- has no implicit cast from `time` to `text`, so every call that gets
-- past the auth guard (i.e. every real caller -- a student viewing their
-- own history, or an admin viewing someone else's) fails at RETURN QUERY
-- with "structure of query does not match function result type". The
-- app's useQuery only checks `historyLoading`, not the query error, so
-- the failure silently renders as "No late cancellations recorded" even
-- when late_cancellation_count > 0 (confirmed live: get_users_with_late_
-- cancellations counts all late_cancellations rows for the current
-- month, this function returned zero rows for a user with exactly one).
-- ============================================================

create or replace function public.get_user_late_cancellation_history(p_user_id uuid)
returns table(id uuid, session_id uuid, class_name text, session_date date, session_start_time text, cancelled_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is distinct from p_user_id and coalesce(get_user_role()::text, '') <> 'admin' then
    return;
  end if;

  return query
  select
    lc.id,
    lc.session_id,
    ct.name as class_name,
    cs.session_date,
    cs.start_time::text as session_start_time,
    lc.cancelled_at
  from late_cancellations lc
  join class_sessions cs on cs.id = lc.session_id
  join class_templates ct on ct.id = cs.template_id
  where lc.user_id = p_user_id
  order by lc.cancelled_at desc;
end;
$function$;

grant execute on function public.get_user_late_cancellation_history(uuid) to authenticated;
revoke execute on function public.get_user_late_cancellation_history(uuid) from anon;
revoke execute on function public.get_user_late_cancellation_history(uuid) from public;
