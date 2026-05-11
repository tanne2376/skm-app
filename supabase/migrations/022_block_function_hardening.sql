-- ============================================================
-- BLOCK FUNCTION HARDENING (PR #19 follow-up)
-- ============================================================
-- 1. refund_block_slot was missed by 021's lockdown — revoke it.
-- 2. cancel_block and abandon_pending_stripe_block already have anon
--    revoked in 021, but their auth.uid() guards fail open (return
--    NULL) when called without a session. Add explicit null checks
--    so a future grant change can't silently undo the protection.
-- ============================================================

revoke execute on function refund_block_slot(uuid) from anon, authenticated, public;

-- ------------------------------------------------------------
-- cancel_block: explicit "Not authenticated" guard
-- ------------------------------------------------------------

create or replace function cancel_block(p_block_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role user_role;
  v_block blocks%rowtype;
  v_is_owner boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  v_role := get_user_role();

  select * into v_block from blocks where id = p_block_id;
  if not found then
    raise exception 'Block not found.';
  end if;

  v_is_owner := (v_block.student_id = v_user_id);

  if not v_is_owner and v_role is distinct from 'admin' then
    raise exception 'Not authorised to cancel this block.';
  end if;

  if v_block.status not in ('active', 'exhausted', 'expired') then
    raise exception 'Block is not cancellable.';
  end if;

  update blocks set status = 'cancelled' where id = p_block_id;
end;
$$;

-- ------------------------------------------------------------
-- abandon_pending_stripe_block: explicit "Not authenticated" guard
-- ------------------------------------------------------------

create or replace function abandon_pending_stripe_block(p_block_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_block blocks%rowtype;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_block from blocks where id = p_block_id;
  if not found then
    raise exception 'Block not found.';
  end if;
  if v_block.student_id <> v_user_id then
    raise exception 'Not authorised to abandon this block.';
  end if;
  if v_block.status <> 'pending_stripe' then
    return; -- idempotent / already terminal
  end if;
  update blocks set status = 'cancelled' where id = p_block_id;
end;
$$;
