import { createAdminClient } from '../_shared/supabase.ts';
import { stripe } from '../_shared/stripe.ts';
import { notify, notifyMany, notifyClassJoined } from '../_shared/notify.ts';

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

/**
 * Read current_period_start / current_period_end from a Subscription object.
 * Basil API moved these from top-level Subscription to each SubscriptionItem.
 */
function getSubscriptionPeriod(sub: any): { periodStart: string; periodEnd: string } {
  const item = sub.items?.data?.[0];
  const rawStart = item?.current_period_start ?? sub.current_period_start;
  const rawEnd   = item?.current_period_end   ?? sub.current_period_end;

  const toISO = (v: any) => {
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return new Date(v * 1000).toISOString();
    return new Date().toISOString();
  };

  return { periodStart: toISO(rawStart), periodEnd: toISO(rawEnd) };
}

Deno.serve(async (req) => {
  const sig = req.headers.get('Stripe-Signature');
  const body = await req.text();

  let event: any;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, webhookSecret);
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'sig_fail', msg: err?.message }), { status: 400 });
  }

  const adminClient = createAdminClient();
  const eventType: string = event.type;
  const obj = event.data?.object;

  console.log(`[WEBHOOK DEBUG] Event received: ${eventType}, obj.id: ${obj?.id}`);

  // ── payment_intent.succeeded ────────────────────────────────────────────
  if (eventType === 'payment_intent.succeeded') {
    try {
      const { booking_type, session_id, student_id } = obj?.metadata ?? {};

      if (booking_type === 'class') {
        await adminClient
          .from('bookings')
          .update({ payment_status: 'paid' })
          .eq('stripe_payment_intent_id', obj.id)
          .eq('payment_status', 'pending');

        const { data: profile } = await adminClient
          .from('profiles')
          .select('full_name')
          .eq('id', student_id)
          .single();

        await notifyClassJoined({
          adminClient,
          sessionId: session_id,
          studentName: profile?.full_name ?? 'A student',
        });
      } else if (booking_type === 'one_to_one') {
        await adminClient
          .from('one_to_ones')
          .update({ payment_status: 'paid' })
          .eq('stripe_payment_intent_id', obj.id)
          .eq('payment_status', 'pending');

        // Notify the 1-to-1 owner that it was booked
        const { data: oto } = await adminClient
          .from('one_to_ones')
          .select('teacher_id, creator_id, title, student_id')
          .eq('stripe_payment_intent_id', obj.id)
          .single();
        if (oto) {
          const { data: student } = await adminClient
            .from('profiles')
            .select('full_name')
            .eq('id', oto.student_id)
            .single();
          const ownerId = oto.creator_id ?? oto.teacher_id;
          if (ownerId) {
            await notify({
              adminClient,
              userId: ownerId,
              type: 'one_to_one_booked',
              title: '1-to-1 booked',
              body: `${student?.full_name ?? 'Someone'} booked your session "${oto.title}".`,
              data: { oneToOneId: obj.metadata?.one_to_one_id },
            });
          }
        }
      } else if (booking_type === 'block_purchase') {
        const { error: actErr } = await adminClient.rpc('activate_block_from_stripe', {
          p_payment_intent_id: obj.id,
        });
        if (actErr) throw actErr;

        const { data: block } = await adminClient
          .from('blocks')
          .select('student_id, sessions_total, template_name_snapshot')
          .eq('stripe_payment_intent_id', obj.id)
          .single();

        if (block?.student_id) {
          await notify({
            adminClient,
            userId: block.student_id,
            type: 'block_activated',
            title: 'Block activated',
            body: `Your ${block.template_name_snapshot} (${block.sessions_total} sessions) is ready to use.`,
            data: { screen: 'membership' },
          });
        }
      }
    } catch (err: any) {
      return errResp(eventType, err);
    }
  }

  // ── payment_intent.payment_failed ───────────────────────────────────────
  else if (eventType === 'payment_intent.payment_failed') {
    try {
      const { booking_type } = obj?.metadata ?? {};

      if (booking_type === 'class') {
        await adminClient
          .from('bookings')
          .update({ status: 'cancelled', payment_status: 'pending', cancelled_at: new Date().toISOString() })
          .eq('stripe_payment_intent_id', obj.id);
      } else if (booking_type === 'one_to_one') {
        await adminClient
          .from('one_to_ones')
          .update({ status: 'available', student_id: null, payment_status: null, payment_method: null, stripe_payment_intent_id: null })
          .eq('stripe_payment_intent_id', obj.id);
      } else if (booking_type === 'block_purchase') {
        await adminClient.rpc('activate_block_failed_from_stripe', {
          p_payment_intent_id: obj.id,
        });
      }
    } catch (err: any) {
      return errResp(eventType, err);
    }
  }

  // ── invoice.payment_succeeded OR invoice.paid ───────────────────────────
  else if (eventType === 'invoice.payment_succeeded' || eventType === 'invoice.paid') {
    try {
      const diag: Record<string, any> = { eventType };
      const billingReason = obj?.billing_reason;
      diag.billingReason = billingReason;

      if (billingReason !== 'subscription_create' && billingReason !== 'subscription_cycle') {
        diag.exit = 'billing_reason_mismatch';
        console.log(`[WEBHOOK DEBUG] invoice handler diag:`, JSON.stringify(diag));
        return new Response(JSON.stringify({ received: true, diag }), { headers: { 'Content-Type': 'application/json' } });
      }

      // Basil API moved subscription from top-level to parent.subscription_details
      const rawSub = obj.subscription ?? obj.parent?.subscription_details?.subscription;
      console.log(`[WEBHOOK DEBUG] obj.subscription:`, JSON.stringify(obj.subscription), `obj.parent?.subscription_details?.subscription:`, JSON.stringify(obj.parent?.subscription_details?.subscription));
      const subscriptionId = typeof rawSub === 'string'
        ? rawSub
        : rawSub?.id;
      diag.subscriptionId = subscriptionId;

      if (!subscriptionId) {
        diag.exit = 'no_subscription_id';
        console.log(`[WEBHOOK DEBUG] invoice handler diag:`, JSON.stringify(diag));
        return new Response(JSON.stringify({ received: true, diag }), { headers: { 'Content-Type': 'application/json' } });
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const customerId = typeof subscription.customer === 'string'
        ? subscription.customer
        : (subscription.customer as any)?.id;
      diag.customerId = customerId;

      const priceId = subscription.items.data[0]?.price?.id;
      diag.priceId = priceId;

      const { periodStart, periodEnd } = getSubscriptionPeriod(subscription);
      diag.periodStart = periodStart;
      diag.periodEnd = periodEnd;

      const { data: profile, error: profileErr } = await adminClient
        .from('profiles')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single();
      diag.profileId = profile?.id ?? null;
      diag.profileErr = profileErr?.message ?? null;

      if (!profile) {
        diag.exit = 'no_profile';
        console.log(`[WEBHOOK DEBUG] invoice handler diag:`, JSON.stringify(diag));
        return new Response(JSON.stringify({ received: true, diag }), { headers: { 'Content-Type': 'application/json' } });
      }

      const tier = priceId === Deno.env.get('STRIPE_PRICE_UNLIMITED') ? 'unlimited' : 'two_per_week';
      diag.tier = tier;

      if (billingReason === 'subscription_create') {
        const { data: upsertData, error: upsertErr } = await adminClient.from('memberships').upsert({
          student_id: profile.id,
          tier,
          stripe_subscription_id: subscriptionId,
          stripe_price_id: priceId,
          status: 'active',
          current_period_start: periodStart,
          current_period_end: periodEnd,
        }, { onConflict: 'stripe_subscription_id' }).select();

        diag.upsertData = upsertData;
        diag.upsertErr = upsertErr?.message ?? null;
      } else {
        const { data: updateData, error: updateErr } = await adminClient
          .from('memberships')
          .update({
            status: 'active',
            current_period_start: periodStart,
            current_period_end: periodEnd,
          })
          .eq('stripe_subscription_id', subscriptionId)
          .select();

        diag.updateData = updateData;
        diag.updateErr = updateErr?.message ?? null;
      }

      diag.exit = 'success';
      console.log(`[WEBHOOK DEBUG] invoice handler diag:`, JSON.stringify(diag));
      return new Response(JSON.stringify({ received: true, diag }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err: any) {
      return errResp(eventType, err);
    }
  }

  // ── invoice.payment_failed ─────────────────────────────────────────────
  else if (eventType === 'invoice.payment_failed') {
    try {
      const rawSub = obj.subscription ?? obj.parent?.subscription_details?.subscription;
      const subId = typeof rawSub === 'string' ? rawSub : rawSub?.id;
      if (subId) {
        await adminClient
          .from('memberships')
          .update({ status: 'past_due' })
          .eq('stripe_subscription_id', subId);
      }

      const customerId = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;
      if (customerId) {
        const { data: profile } = await adminClient
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();
        if (profile) {
          await notify({
            adminClient,
            userId: profile.id,
            type: 'membership_renewal',
            title: 'Membership payment failed',
            body: 'Your membership payment could not be processed. Please update your payment method.',
            data: { screen: 'membership' },
          });
        }
      }
    } catch (err: any) {
      return errResp(eventType, err);
    }
  }

  // ── customer.subscription.updated ──────────────────────────────────────
  else if (eventType === 'customer.subscription.updated') {
    try {
      const subStatus = obj?.status;

      // Ignore transient statuses
      if (subStatus === 'incomplete' || subStatus === 'incomplete_expired') {
        return okResp();
      }

      let status: string;
      if (subStatus === 'active' && obj.cancel_at_period_end) {
        status = 'cancelling';
      } else if (subStatus === 'active') {
        status = 'active';
      } else if (subStatus === 'past_due') {
        status = 'past_due';
      } else {
        status = 'cancelled';
      }

      const { periodStart, periodEnd } = getSubscriptionPeriod(obj);

      await adminClient
        .from('memberships')
        .update({
          status,
          current_period_start: periodStart,
          current_period_end: periodEnd,
        })
        .eq('stripe_subscription_id', obj.id);
    } catch (err: any) {
      return errResp(eventType, err);
    }
  }

  // ── customer.subscription.deleted ──────────────────────────────────────
  else if (eventType === 'customer.subscription.deleted') {
    try {
      await adminClient
        .from('memberships')
        .update({ status: 'cancelled' })
        .eq('stripe_subscription_id', obj.id);

      const customerId = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;
      if (customerId) {
        const { data: profile } = await adminClient
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();
        if (profile) {
          await notify({
            adminClient,
            userId: profile.id,
            type: 'membership_renewal',
            title: 'Membership cancelled',
            body: 'Your Switch-Kick Mafia membership has ended.',
            data: { screen: 'membership' },
          });
        }
      }
    } catch (err: any) {
      return errResp(eventType, err);
    }
  }

  // ── Unhandled ──────────────────────────────────────────────────────────
  else {
    console.log(`Unhandled event type: ${eventType}`);
  }

  return okResp();
});

function okResp() {
  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function errResp(eventType: string, err: any) {
  const msg = err?.message ?? String(err);
  console.error(`Webhook error [${eventType}]:`, msg, err?.stack);
  return new Response(JSON.stringify({ error: msg, event_type: eventType }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}
