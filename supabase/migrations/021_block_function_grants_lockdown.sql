-- ============================================================
-- BLOCK FUNCTION GRANT LOCKDOWN
-- ============================================================
-- Supabase appears to grant EXECUTE to the `anon` role directly on
-- new functions, not just via PUBLIC, so the `revoke ... from public`
-- in migration 020 left an anon grant in place. Lock these down so
-- the database advisor stops flagging them and an unauthenticated
-- attacker cannot call any of the SECURITY DEFINER block helpers.
-- ============================================================

-- Service-role only: called from edge functions with explicit user_id.
revoke execute on function create_cash_block_purchase(uuid, uuid) from anon, public;
revoke execute on function create_pending_stripe_block_purchase(uuid, uuid) from anon, public;
revoke execute on function book_one_to_one_with_block(uuid, uuid) from anon, public;

-- Service-role only: called from the Stripe webhook handler.
revoke execute on function activate_block_from_stripe(text) from anon, authenticated, public;
revoke execute on function activate_block_failed_from_stripe(text) from anon, authenticated, public;
revoke execute on function set_block_stripe_payment_intent(uuid, text) from anon, authenticated, public;

-- Internal helper called by other SECURITY DEFINER functions.
revoke execute on function expire_stale_blocks_for_student(uuid) from anon, authenticated, public;

-- Client-callable but only by authenticated users (auth.uid() inside).
revoke execute on function cancel_block(uuid) from anon, public;
revoke execute on function abandon_pending_stripe_block(uuid) from anon, public;
