// Stripe Connect revenue-split support.
//
// Feature-flagged by the presence of STRIPE_CONNECTED_ACCOUNT_ID: when unset,
// every helper below is a no-op and payments behave exactly as before
// (100% to the platform account). Set it once the gym owner's connected
// account is onboarded (test or live) to start splitting revenue via
// Stripe destination charges — no other code path changes.
//
// STRIPE_PLATFORM_FEE_BPS defaults to 500 (5.00%). The connected account
// receives (amount - application_fee_amount); Stripe's processing fee is
// deducted from the platform's application_fee_amount share (not from the
// connected account) because we don't set `on_behalf_of` — this matches
// "gym owner gets 95%, platform gets 5% minus Stripe fees".

const connectedAccountId = Deno.env.get('STRIPE_CONNECTED_ACCOUNT_ID') || undefined;
const platformFeeBps = Number(Deno.env.get('STRIPE_PLATFORM_FEE_BPS') ?? '500');

// Fail loud on a malformed secret rather than silently sending Stripe an
// invalid application_fee_percent (max 2 decimal places, 0-100%) or a
// negative/NaN application_fee_amount.
if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10000) {
  throw new Error(
    `STRIPE_PLATFORM_FEE_BPS must be an integer from 0 through 10000 (got ${Deno.env.get('STRIPE_PLATFORM_FEE_BPS')})`,
  );
}

export function isConnectEnabled(): boolean {
  return Boolean(connectedAccountId);
}

export function platformFeeAmount(amountPence: number): number {
  return Math.round((amountPence * platformFeeBps) / 10000);
}

/** Spread into `stripe.paymentIntents.create(...)` params. */
export function connectChargeParams(amountPence: number): Record<string, unknown> {
  if (!connectedAccountId) return {};
  return {
    application_fee_amount: platformFeeAmount(amountPence),
    transfer_data: { destination: connectedAccountId },
  };
}

/**
 * Spread into `stripe.subscriptions.create(...)` params. Applies to every
 * invoice the subscription generates (including one-time invoice items
 * added to the same invoice), since the fee is computed on invoice total.
 */
export function connectSubscriptionParams(): Record<string, unknown> {
  if (!connectedAccountId) return {};
  return {
    application_fee_percent: platformFeeBps / 100,
    transfer_data: { destination: connectedAccountId },
  };
}

/**
 * Spread into `stripe.refunds.create(...)` params for a FULL refund only.
 * Reverses the transfer to the connected account and refunds the
 * platform's application fee, so a full refund doesn't leave the platform
 * out of pocket for money it already forwarded. Only valid on charges that
 * were actually created as destination charges — safe to spread
 * unconditionally since it no-ops when Connect is disabled.
 */
export function connectRefundParams(): Record<string, unknown> {
  if (!connectedAccountId) return {};
  return { reverse_transfer: true, refund_application_fee: true };
}
