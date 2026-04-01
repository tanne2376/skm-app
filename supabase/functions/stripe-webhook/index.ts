import { createAdminClient } from '../_shared/supabase.ts';
import { stripe } from '../_shared/stripe.ts';

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

Deno.serve(async (req) => {
  const sig = req.headers.get('Stripe-Signature');
  const body = await req.text();

  let event: any;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return new Response('Bad Request', { status: 400 });
  }

  const adminClient = createAdminClient();

  try {
    switch (event.type) {
      // ── Class / 1-to-1 payment confirmed ─────────────────────────────────
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        const { booking_type, session_id, one_to_one_id, student_id } = pi.metadata;

        if (booking_type === 'class') {
          // Idempotent: only update if still pending
          await adminClient
            .from('bookings')
            .update({ payment_status: 'paid' })
            .eq('stripe_payment_intent_id', pi.id)
            .eq('payment_status', 'pending');

          // Send push notification
          const { data: profile } = await adminClient
            .from('profiles')
            .select('push_token, full_name')
            .eq('id', student_id)
            .single();

          const { data: session } = await adminClient
            .from('class_sessions')
            .select('session_date, start_time, class_templates(name)')
            .eq('id', session_id)
            .single();

          if (profile?.push_token && session) {
            const sessionName = (session as any).class_templates?.name;
            await adminClient.functions.invoke('send-notification', {
              body: {
                pushToken: profile.push_token,
                title: 'Booking confirmed! 🥊',
                body: `${sessionName} on ${session.session_date} at ${session.start_time.slice(0, 5)}`,
                data: { sessionId: session_id },
              },
            });
          }

        } else if (booking_type === 'one_to_one') {
          await adminClient
            .from('one_to_ones')
            .update({ payment_status: 'paid' })
            .eq('stripe_payment_intent_id', pi.id)
            .eq('payment_status', 'pending');
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        const { booking_type, session_id } = pi.metadata;

        if (booking_type === 'class') {
          await adminClient
            .from('bookings')
            .update({ status: 'cancelled', payment_status: 'pending', cancelled_at: new Date().toISOString() })
            .eq('stripe_payment_intent_id', pi.id);
        } else if (booking_type === 'one_to_one') {
          await adminClient
            .from('one_to_ones')
            .update({ status: 'available', student_id: null, payment_status: null, payment_method: null, stripe_payment_intent_id: null })
            .eq('stripe_payment_intent_id', pi.id);
        }
        break;
      }

      // ── Membership: first invoice paid → create membership row ───────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.billing_reason !== 'subscription_create' && invoice.billing_reason !== 'subscription_cycle') break;

        const subscriptionId = invoice.subscription;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const customerId = subscription.customer as string;
        const priceId = subscription.items.data[0]?.price?.id;

        // Find user by Stripe customer ID
        const { data: profile } = await adminClient
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();
        if (!profile) break;

        const tier = priceId === Deno.env.get('STRIPE_PRICE_UNLIMITED') ? 'unlimited' : 'two_per_week';

        if (invoice.billing_reason === 'subscription_create') {
          // Create new membership
          await adminClient.from('memberships').insert({
            student_id: profile.id,
            tier,
            stripe_subscription_id: subscriptionId,
            stripe_price_id: priceId,
            status: 'active',
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          });
        } else {
          // Renewal: update period dates
          await adminClient
            .from('memberships')
            .update({
              status: 'active',
              current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
              current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            })
            .eq('stripe_subscription_id', subscriptionId);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await adminClient
          .from('memberships')
          .update({ status: 'past_due' })
          .eq('stripe_subscription_id', invoice.subscription);

        // Notify user
        const customerId = invoice.customer as string;
        const { data: profile } = await adminClient
          .from('profiles')
          .select('push_token')
          .eq('stripe_customer_id', customerId)
          .single();
        if (profile?.push_token) {
          await adminClient.functions.invoke('send-notification', {
            body: {
              pushToken: profile.push_token,
              title: 'Membership payment failed',
              body: 'Your membership payment could not be processed. Please update your payment method.',
              data: { screen: 'membership' },
            },
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await adminClient
          .from('memberships')
          .update({
            status: sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : 'cancelled',
            current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          })
          .eq('stripe_subscription_id', sub.id);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await adminClient
          .from('memberships')
          .update({ status: 'cancelled' })
          .eq('stripe_subscription_id', sub.id);

        const customerId = sub.customer as string;
        const { data: profile } = await adminClient
          .from('profiles')
          .select('push_token')
          .eq('stripe_customer_id', customerId)
          .single();
        if (profile?.push_token) {
          await adminClient.functions.invoke('send-notification', {
            body: {
              pushToken: profile.push_token,
              title: 'Membership cancelled',
              body: 'Your Switch-Kick Mafia membership has ended.',
              data: { screen: 'membership' },
            },
          });
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
