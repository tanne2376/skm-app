import { corsHeaders, corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase.ts';
import { stripe } from '../_shared/stripe.ts';
import { membershipWeekStart } from '../_shared/membershipWeek.ts';
import { notify } from '../_shared/notify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  const { sessionId } = await req.json() as { sessionId: string };

  const adminClient = createAdminClient();

  // Get session details
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('*, class_templates(name)')
    .eq('id', sessionId)
    .single();

  if (!session) return errorResponse('Session not found', 404);

  // Get waitlisted bookings in order
  const { data: waitlisted } = await adminClient
    .from('bookings')
    .select('*, profiles(id, stripe_customer_id, push_token)')
    .eq('session_id', sessionId)
    .eq('status', 'waitlisted')
    .order('waitlist_position', { ascending: true });

  if (!waitlisted || waitlisted.length === 0) {
    return jsonResponse({ promoted: false, message: 'No one on waitlist' });
  }

  const sessionPrice = session.price ?? null;
  const { data: priceData } = await adminClient.rpc('get_session_price', { p_session_id: sessionId });
  const amountPence: number = priceData ?? 1500;

  for (const booking of waitlisted) {
    const student = (booking as any).profiles;
    const sessionName = (session as any).class_templates?.name ?? 'Class';

    // Check if student has active membership
    const { data: membership } = await adminClient
      .from('memberships')
      .select('*')
      .eq('student_id', booking.student_id)
      .eq('status', 'active')
      .maybeSingle();

    let promoted = false;

    if (membership) {
      // Check quota for 2x/week
      if (membership.tier === 'unlimited') {
        // Free promotion
        await promoteBooking(adminClient, booking.id, 'membership', 'paid');
        promoted = true;
      } else {
        // two_per_week — check quota
        const weekStart = membershipWeekStart(session.session_date, session.start_time);
        const { count } = await adminClient
          .from('membership_weekly_usage')
          .select('id', { count: 'exact', head: true })
          .eq('membership_id', membership.id)
          .eq('week_start', weekStart);

        if ((count ?? 0) < 2) {
          await promoteBooking(adminClient, booking.id, 'membership', 'paid');
          await adminClient.from('membership_weekly_usage').insert({
            membership_id: membership.id,
            student_id: booking.student_id,
            booking_id: booking.id,
            week_start: weekStart,
          });
          promoted = true;
        }
        // else: quota exceeded — skip to next
      }
    } else if (student?.stripe_customer_id) {
      // Try to charge their saved card
      try {
        // Find their default payment method
        const customer = await stripe.customers.retrieve(student.stripe_customer_id) as any;
        const defaultPm = customer.invoice_settings?.default_payment_method;
        if (!defaultPm) continue; // no saved card — skip

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountPence,
          currency: 'gbp',
          customer: student.stripe_customer_id,
          payment_method: defaultPm,
          confirm: true,
          off_session: true,
          description: `Waitlist promotion: ${sessionName}`,
          metadata: {
            booking_type: 'class',
            session_id: sessionId,
            student_id: booking.student_id,
            booking_id: booking.id,
          },
        });

        if (paymentIntent.status === 'succeeded') {
          await adminClient
            .from('bookings')
            .update({ stripe_payment_intent_id: paymentIntent.id })
            .eq('id', booking.id);
          await promoteBooking(adminClient, booking.id, 'app', 'paid');
          promoted = true;
        }
      } catch (e) {
        console.error(`Charge failed for student ${booking.student_id}:`, e);
        // Skip to next — failed charge
        continue;
      }
    } else {
      // No membership, no saved card — skip
      continue;
    }

    if (promoted) {
      // Decrement waitlist positions for remaining waitlisted students
      await adminClient.rpc('decrement_waitlist_positions', {
        p_session_id: sessionId,
        p_min_position: booking.waitlist_position,
      });

      // Send push notification
      await notify({
        adminClient,
        userId: booking.student_id,
        type: 'waitlist_promotion',
        title: 'You\'re in!',
        body: `A spot opened up for ${sessionName}. Your booking is confirmed.`,
        data: { sessionId },
      });

      return jsonResponse({ promoted: true, studentId: booking.student_id });
    }
  }

  return jsonResponse({ promoted: false, message: 'No eligible waitlisted students' });
});

async function promoteBooking(
  adminClient: any,
  bookingId: string,
  paymentMethod: string,
  paymentStatus: string,
) {
  await adminClient
    .from('bookings')
    .update({
      status: 'confirmed',
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      waitlist_position: null,
    })
    .eq('id', bookingId);
}
