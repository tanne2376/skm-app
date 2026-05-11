-- ============================================================
-- BLOCK SYSTEM FIXES (PR #19 review)
-- ============================================================
-- 1. Edge functions call create/book RPCs via service-role; auth.uid()
--    is NULL there, so user_id must be passed explicitly.
-- 2. Stale 'active' blocks past expires_at must be transitioned before
--    enforcing the one-active-block rule, otherwise the user is locked
--    out from buying a replacement.
-- 3. The owner-cancel rule was too strict — students need to free their
--    one-active slot to buy a new template even with sessions remaining
--    (sessions are forfeit; UI confirms before calling).
-- 4. Stripe webhook activation must distinguish a real transition from
--    an idempotent re-fire so push notifications don't duplicate, and
--    must not silently cancel a successful purchase on the activation
--    race — it now flags for admin review instead.
-- ============================================================

alter type block_status add value if not exists 'needs_review';

-- ------------------------------------------------------------
-- Helper: transition expired active blocks for one student.
-- Called at the top of every purchase path so the one-active rule
-- never sees a stale 'active' row.
-- ------------------------------------------------------------
create or replace function expire_stale_blocks_for_student(p_student_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update blocks
  set status = 'expired'
  where student_id = p_student_id
    and status = 'active'
    and expires_at is not null
    and expires_at < now();
$$;

-- ============================================================
-- PURCHASE: CASH (now takes explicit p_user_id)
-- ============================================================

drop function if exists create_cash_block_purchase(uuid);

create or replace function create_cash_block_purchase(p_template_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template block_templates%rowtype;
  v_block_id uuid;
  v_now timestamptz := now();
  v_expires_at timestamptz;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required.';
  end if;

  perform expire_stale_blocks_for_student(p_user_id);

  select * into v_template from block_templates where id = p_template_id;
  if not found or not v_template.is_active then
    raise exception 'Block template not available.';
  end if;

  if v_template.validity_days is not null then
    v_expires_at := v_now + (v_template.validity_days || ' days')::interval;
  end if;

  begin
    insert into blocks (
      student_id, template_id,
      template_name_snapshot, sessions_total, validity_days_snapshot, price_pence_snapshot,
      status, payment_method, payment_status,
      activated_at, expires_at
    ) values (
      p_user_id, v_template.id,
      v_template.name, v_template.sessions_count, v_template.validity_days, v_template.price_pence,
      'active', 'cash', 'pending',
      v_now, v_expires_at
    )
    returning id into v_block_id;
  exception when unique_violation then
    raise exception 'You already have an active block.';
  end;

  return v_block_id;
end;
$$;

-- Service-role only: edge function is the sole legitimate caller.
revoke all on function create_cash_block_purchase(uuid, uuid) from authenticated, public;

-- ============================================================
-- PURCHASE: STRIPE PENDING (now takes explicit p_user_id)
-- ============================================================

drop function if exists create_pending_stripe_block_purchase(uuid);

create or replace function create_pending_stripe_block_purchase(p_template_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template block_templates%rowtype;
  v_block_id uuid;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required.';
  end if;

  perform expire_stale_blocks_for_student(p_user_id);

  select * into v_template from block_templates where id = p_template_id;
  if not found or not v_template.is_active then
    raise exception 'Block template not available.';
  end if;

  if exists (
    select 1 from blocks where student_id = p_user_id and status = 'active'
  ) then
    raise exception 'You already have an active block.';
  end if;

  if exists (
    select 1 from blocks
    where student_id = p_user_id
      and status = 'pending_stripe'
      and created_at > now() - interval '15 minutes'
  ) then
    raise exception 'A block purchase is already in progress. Try again in a few minutes.';
  end if;

  insert into blocks (
    student_id, template_id,
    template_name_snapshot, sessions_total, validity_days_snapshot, price_pence_snapshot,
    status, payment_method, payment_status
  ) values (
    p_user_id, v_template.id,
    v_template.name, v_template.sessions_count, v_template.validity_days, v_template.price_pence,
    'pending_stripe', 'stripe', 'pending'
  )
  returning id into v_block_id;

  return v_block_id;
end;
$$;

revoke all on function create_pending_stripe_block_purchase(uuid, uuid) from authenticated, public;

-- ============================================================
-- WEBHOOK: ACTIVATE STRIPE BLOCK
-- ============================================================
-- Returns the block id ONLY on real transition pending_stripe -> active.
-- Returns NULL on idempotent re-fire so the webhook can decide whether to
-- send the activation notification. On the activation race (another active
-- block exists), the new block is parked in 'needs_review' and an admin is
-- expected to refund or manually activate (audit trail is preserved by the
-- status itself).
-- ============================================================

create or replace function activate_block_from_stripe(p_payment_intent_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block blocks%rowtype;
  v_now timestamptz := now();
  v_expires_at timestamptz;
begin
  select * into v_block from blocks where stripe_payment_intent_id = p_payment_intent_id;
  if not found then
    raise exception 'Block not found for payment intent %', p_payment_intent_id;
  end if;

  -- Already active or already terminal: idempotent re-fire, no transition.
  if v_block.status <> 'pending_stripe' then
    return null;
  end if;

  if v_block.validity_days_snapshot is not null then
    v_expires_at := v_now + (v_block.validity_days_snapshot || ' days')::interval;
  end if;

  begin
    update blocks
    set status = 'active',
        payment_status = 'paid',
        activated_at = v_now,
        expires_at = v_expires_at
    where id = v_block.id;
  exception when unique_violation then
    -- Race: another block became active between purchase and webhook.
    -- DO NOT cancel the paid block. Mark for admin review so the charge
    -- is either refunded or the slot is freed and the block activated.
    update blocks
    set status = 'needs_review',
        payment_status = 'paid',
        activated_at = v_now
    where id = v_block.id;
    return null;
  end;

  return v_block.id;
end;
$$;

-- ============================================================
-- BOOK 1-TO-1 WITH BLOCK (now takes explicit p_user_id)
-- ============================================================

drop function if exists book_one_to_one_with_block(uuid);

create or replace function book_one_to_one_with_block(p_one_to_one_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block blocks%rowtype;
  v_oto one_to_ones%rowtype;
  v_new_used smallint;
  v_new_status block_status;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required.';
  end if;

  if is_user_booking_blocked(p_user_id) then
    raise exception 'Booking is currently blocked. Please contact a class leader.'
      using errcode = '42501';
  end if;

  perform expire_stale_blocks_for_student(p_user_id);

  select * into v_block
  from blocks
  where student_id = p_user_id and status = 'active'
  for update;

  if not found then
    raise exception 'You do not have an active block.';
  end if;

  if v_block.expires_at is not null and v_block.expires_at < now() then
    update blocks set status = 'expired' where id = v_block.id;
    raise exception 'Your block has expired.';
  end if;

  if v_block.sessions_used >= v_block.sessions_total then
    update blocks set status = 'exhausted' where id = v_block.id;
    raise exception 'Your block has no sessions remaining.';
  end if;

  if v_block.payment_method = 'cash'
     and v_block.payment_status = 'pending'
     and (now() - v_block.created_at) > interval '72 hours' then
    raise exception 'Your cash block payment must be confirmed by a class leader before you can book.';
  end if;

  select * into v_oto from one_to_ones where id = p_one_to_one_id for update;
  if not found then
    raise exception 'Session not found.';
  end if;
  if v_oto.status <> 'available' then
    raise exception 'Session is no longer available.';
  end if;
  if v_oto.creator_id = p_user_id then
    raise exception 'You cannot book your own session.';
  end if;

  update one_to_ones
  set student_id = p_user_id,
      status = 'booked',
      payment_method = 'block',
      payment_status = 'paid',
      block_id = v_block.id
  where id = p_one_to_one_id;

  v_new_used := v_block.sessions_used + 1;
  v_new_status := case when v_new_used = v_block.sessions_total then 'exhausted'::block_status
                       else v_block.status end;

  update blocks
  set sessions_used = v_new_used,
      status = v_new_status
  where id = v_block.id;

  return p_one_to_one_id;
end;
$$;

revoke all on function book_one_to_one_with_block(uuid, uuid) from authenticated, public;

-- ============================================================
-- CANCEL BLOCK: allow owner to cancel an active block (forfeit slots)
-- ============================================================
-- v1 forbade cancelling an active usable block to avoid accidental
-- forfeit, but that left students unable to free their one-active-block
-- slot to switch templates. UI confirms forfeit before calling.

create or replace function cancel_block(p_block_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role := get_user_role();
  v_block blocks%rowtype;
  v_is_owner boolean;
begin
  select * into v_block from blocks where id = p_block_id;
  if not found then
    raise exception 'Block not found.';
  end if;

  v_is_owner := (v_block.student_id = auth.uid());

  if not v_is_owner and v_role <> 'admin' then
    raise exception 'Not authorised to cancel this block.';
  end if;

  if v_block.status not in ('active', 'exhausted', 'expired') then
    raise exception 'Block is not cancellable.';
  end if;

  update blocks set status = 'cancelled' where id = p_block_id;
end;
$$;

-- ============================================================
-- ABANDON PENDING STRIPE BLOCK
-- ============================================================
-- Called by the client when the user dismisses the PaymentSheet so the
-- 15-minute pending-purchase guard doesn't lock them out of retrying.

create or replace function abandon_pending_stripe_block(p_block_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block blocks%rowtype;
begin
  select * into v_block from blocks where id = p_block_id;
  if not found then
    raise exception 'Block not found.';
  end if;
  if v_block.student_id <> auth.uid() then
    raise exception 'Not authorised to abandon this block.';
  end if;
  if v_block.status <> 'pending_stripe' then
    return; -- idempotent / already terminal
  end if;
  update blocks set status = 'cancelled' where id = p_block_id;
end;
$$;

grant execute on function abandon_pending_stripe_block(uuid) to authenticated;

-- ('needs_review' enum value cannot be referenced in a partial-index
-- WHERE clause inside the same migration that ALTERs the enum, so we
-- skip a partial index here. Listings are expected to be rare; add an
-- index in a follow-up migration if needs_review volume grows.)
