-- ============================================================
-- Integration test: join_session_waitlist RPC
-- ============================================================
-- Purpose: prove the waitlist position bug is fixed end-to-end
-- against a real Postgres instance (RLS + advisory lock + insert).
--
-- The Jest unit test in __tests__/hooks/joinWaitlist.test.ts only
-- confirms the client calls the RPC. This test confirms the RPC
-- itself assigns sequential positions even when each call runs
-- with a different authenticated user (the scenario that broke
-- the old client-side computation).
--
-- How to run (against the local Supabase dev DB):
--   supabase start                 # if not running
--   supabase db reset              # reapplies all migrations
--   psql "$(supabase status -o env | awk -F= '/^DB_URL=/{print $2}' | tr -d '\"')" \
--        -v ON_ERROR_STOP=1 \
--        -f supabase/tests/join_session_waitlist.test.sql
--
-- The script is wrapped in BEGIN/ROLLBACK — it leaves no state
-- behind, so it's safe to rerun.
-- ============================================================

begin;

do $$
declare
  v_student_a uuid := gen_random_uuid();
  v_student_b uuid := gen_random_uuid();
  v_student_c uuid := gen_random_uuid();
  v_template  uuid;
  v_session   uuid;
  v_pos_a smallint;
  v_pos_b smallint;
  v_pos_c smallint;
begin
  -- ----------------------------------------------------------
  -- Set up two students. Inserting into auth.users fires the
  -- handle_new_user trigger, which creates the profiles row.
  -- ----------------------------------------------------------
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (v_student_a, 'wl-test-a@example.test', jsonb_build_object('full_name', 'WL Test A')),
    (v_student_b, 'wl-test-b@example.test', jsonb_build_object('full_name', 'WL Test B')),
    (v_student_c, 'wl-test-c@example.test', jsonb_build_object('full_name', 'WL Test C'));

  -- ----------------------------------------------------------
  -- A class template + a future session to waitlist on.
  -- ----------------------------------------------------------
  insert into class_templates (name, day_of_week, start_time, end_time, capacity, price)
  values ('WL Test Template', 1, '10:00', '11:00', 2, 1500)
  returning id into v_template;

  insert into class_sessions (template_id, session_date, start_time, end_time)
  values (v_template, current_date + 7, '10:00', '11:00')
  returning id into v_session;

  -- ----------------------------------------------------------
  -- Student A joins the waitlist.
  -- ----------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_student_a::text, true);
  v_pos_a := join_session_waitlist(v_session, 'app');

  if v_pos_a <> 1 then
    raise exception 'FAIL: student A expected position 1, got %', v_pos_a;
  end if;

  -- ----------------------------------------------------------
  -- Student B joins the same waitlist. This is the case that
  -- used to return position 1 (because RLS hid A's row from B's
  -- SELECT). With the RPC it should return 2.
  -- ----------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_student_b::text, true);
  v_pos_b := join_session_waitlist(v_session, 'app');

  if v_pos_b <> 2 then
    raise exception 'FAIL: student B expected position 2, got % (REGRESSION — the bug is back)', v_pos_b;
  end if;

  -- ----------------------------------------------------------
  -- Student C piles on for good measure.
  -- ----------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_student_c::text, true);
  v_pos_c := join_session_waitlist(v_session, 'cash');

  if v_pos_c <> 3 then
    raise exception 'FAIL: student C expected position 3, got %', v_pos_c;
  end if;

  -- ----------------------------------------------------------
  -- Sanity check: the rows actually exist with the right
  -- positions when read with RLS off (we're in a DO block
  -- running as the postgres role).
  -- ----------------------------------------------------------
  if (select count(*) from bookings where session_id = v_session and status = 'waitlisted') <> 3 then
    raise exception 'FAIL: expected 3 waitlisted bookings, got %',
      (select count(*) from bookings where session_id = v_session and status = 'waitlisted');
  end if;

  if (select array_agg(waitlist_position order by waitlist_position)
        from bookings where session_id = v_session and status = 'waitlisted')
     <> array[1, 2, 3]::smallint[] then
    raise exception 'FAIL: positions in DB are not [1,2,3]';
  end if;

  -- ----------------------------------------------------------
  -- Duplicate prevention: student A trying to join again must
  -- raise the friendly message.
  -- ----------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_student_a::text, true);
  begin
    perform join_session_waitlist(v_session, 'app');
    raise exception 'FAIL: duplicate join by student A should have raised';
  exception
    when others then
      if sqlerrm not like '%already have a booking%' then
        raise exception 'FAIL: duplicate raised wrong message: %', sqlerrm;
      end if;
  end;

  -- ----------------------------------------------------------
  -- LEAVE BUMP: student B (pos 2) cancels. C should move from
  -- 3 to 2.
  -- ----------------------------------------------------------
  update bookings
  set status = 'cancelled', cancelled_at = now()
  where session_id = v_session and student_id = v_student_b;

  if (select waitlist_position from bookings
        where session_id = v_session and student_id = v_student_c) <> 2 then
    raise exception 'FAIL: after B left, C should be position 2, got %',
      (select waitlist_position from bookings
        where session_id = v_session and student_id = v_student_c);
  end if;
  if (select waitlist_position from bookings
        where session_id = v_session and student_id = v_student_a) <> 1 then
    raise exception 'FAIL: A should still be position 1 after B left';
  end if;

  -- ----------------------------------------------------------
  -- CLAIM BUMP: student A (pos 1) is promoted to confirmed.
  -- C should move from 2 to 1.
  -- ----------------------------------------------------------
  update bookings
  set status = 'confirmed', waitlist_position = null
  where session_id = v_session and student_id = v_student_a;

  if (select waitlist_position from bookings
        where session_id = v_session and student_id = v_student_c) <> 1 then
    raise exception 'FAIL: after A claimed, C should be position 1, got %',
      (select waitlist_position from bookings
        where session_id = v_session and student_id = v_student_c);
  end if;

  -- ----------------------------------------------------------
  -- ROLLBACK BUMP: simulate claim-waitlist-spot's rollback path.
  -- We push A back to waitlisted at position 1. The trigger
  -- should bump C from 1 to 2.
  -- ----------------------------------------------------------
  update bookings
  set status = 'waitlisted', waitlist_position = 1
  where session_id = v_session and student_id = v_student_a;

  if (select waitlist_position from bookings
        where session_id = v_session and student_id = v_student_c) <> 2 then
    raise exception 'FAIL: after A rollback, C should be position 2, got %',
      (select waitlist_position from bookings
        where session_id = v_session and student_id = v_student_c);
  end if;
  if (select waitlist_position from bookings
        where session_id = v_session and student_id = v_student_a) <> 1 then
    raise exception 'FAIL: rolled-back A should be at position 1';
  end if;

  raise notice 'PASS: join order, duplicate rejection, leave-bump, claim-bump, rollback-bump all correct';
end;
$$;

rollback;
