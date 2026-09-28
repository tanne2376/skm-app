-- ============================================================
-- REPAIR: missing DDL from migration 024 (one_to_one_late_cancellations)
-- ============================================================
-- schema_migrations claims 024 was applied, but none of its DDL exists on
-- this project (same failure mode 026 repaired for 017/018):
--   * late_cancellations has no one_to_one_id column, so every 1-to-1
--     late-cancel insert in cancel-one-to-one fails (swallowed as
--     non-fatal) and 1-to-1 strikes are never recorded.
--   * get_user_late_cancellation_history has the pre-024 shape (no `kind`,
--     class rows only), which 036 and 20260916165846 then preserved.
--
-- Everything below is idempotent so it is safe on a database where 024
-- did apply. The history RPC keeps the NULL-safe auth guard from 036.
-- ============================================================

alter table late_cancellations
  alter column booking_id drop not null,
  alter column session_id drop not null;

alter table late_cancellations
  add column if not exists one_to_one_id uuid references one_to_ones(id) on delete cascade;

alter table late_cancellations
  drop constraint if exists late_cancellations_source_check;

alter table late_cancellations
  add constraint late_cancellations_source_check check (
    (booking_id is not null and session_id is not null and one_to_one_id is null)
    or
    (booking_id is null and session_id is null and one_to_one_id is not null)
  );

alter table late_cancellations
  drop constraint if exists late_cancellations_booking_id_unique;

create unique index if not exists late_cancellations_booking_id_key
  on late_cancellations (booking_id)
  where booking_id is not null;

create unique index if not exists late_cancellations_one_to_one_id_key
  on late_cancellations (one_to_one_id)
  where one_to_one_id is not null;

-- ============================================================
-- HISTORY RPC: restore the 024 seven-column shape (class + 1-to-1)
-- ============================================================
-- Return type changes, so the function must be dropped first.
drop function if exists public.get_user_late_cancellation_history(uuid);

create function public.get_user_late_cancellation_history(p_user_id uuid)
returns table (
  id uuid,
  kind text,
  session_id uuid,
  class_name text,
  session_date date,
  session_start_time text,
  cancelled_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is distinct from p_user_id and coalesce(get_user_role()::text, '') <> 'admin' then
    return;
  end if;

  return query
  select
    lc.id,
    'class'::text as kind,
    lc.session_id,
    ct.name as class_name,
    cs.session_date,
    cs.start_time::text as session_start_time,
    lc.cancelled_at
  from late_cancellations lc
  join class_sessions cs on cs.id = lc.session_id
  join class_templates ct on ct.id = cs.template_id
  where lc.user_id = p_user_id
    and lc.booking_id is not null
  union all
  select
    lc.id,
    'one_to_one'::text as kind,
    lc.one_to_one_id as session_id,
    oto.title as class_name,
    oto.session_date,
    oto.start_time::text as session_start_time,
    lc.cancelled_at
  from late_cancellations lc
  join one_to_ones oto on oto.id = lc.one_to_one_id
  where lc.user_id = p_user_id
    and lc.one_to_one_id is not null
  order by cancelled_at desc;
end;
$$;

revoke execute on function public.get_user_late_cancellation_history(uuid) from public;
revoke execute on function public.get_user_late_cancellation_history(uuid) from anon;
grant execute on function public.get_user_late_cancellation_history(uuid) to authenticated;
grant execute on function public.get_user_late_cancellation_history(uuid) to service_role;
