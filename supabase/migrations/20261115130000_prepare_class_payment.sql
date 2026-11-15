-- One round trip for create-payment-intent's class pre-checks.
--
-- The edge function used to make ~7 sequential PostgREST calls (block check,
-- price, session, capacity, count, profile), each costing 0.5–3 s of API
-- latency. This wraps the same existing helpers in one call; it adds no new
-- rules. Booking-time rules (waiver, kids) stay in the validate_booking trigger.

create or replace function prepare_class_payment(p_user_id uuid, p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_price integer;
  v_is_cancelled boolean;
  v_name text;
  v_level class_level;
  v_capacity smallint;
  v_count bigint;
  v_customer_id text;
begin
  if is_user_booking_blocked(p_user_id) then
    return jsonb_build_object('error', 'blocked');
  end if;

  v_price := get_session_price(p_session_id);
  if coalesce(v_price, 0) = 0 then
    return jsonb_build_object('error', 'not_found');
  end if;

  select s.is_cancelled, t.name, t.level
    into v_is_cancelled, v_name, v_level
  from class_sessions s
  left join class_templates t on t.id = s.template_id
  where s.id = p_session_id;

  if not found or v_is_cancelled then
    return jsonb_build_object('error', 'unavailable');
  end if;
  if v_level = 'kids' then
    return jsonb_build_object('error', 'kids');
  end if;

  v_capacity := get_session_capacity(p_session_id);
  v_count := get_session_booking_count(p_session_id);
  if v_capacity is not null and v_count is not null and v_count >= v_capacity then
    return jsonb_build_object('error', 'full');
  end if;

  select stripe_customer_id into v_customer_id from profiles where id = p_user_id;

  return jsonb_build_object(
    'price', v_price,
    'name', v_name,
    'customer_id', v_customer_id
  );
end;
$$;

revoke execute on function prepare_class_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function prepare_class_payment(uuid, uuid) to service_role;
