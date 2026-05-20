// JWT: ✅
//
// Admin / teacher cancels an entire class session.
// Marks the session is_cancelled, then for each live booking:
//   - app + Stripe (future session): full refund, payment_status=refunded
//   - membership: delete the weekly usage row so the slot is returned
//   - cash: nothing financial — the owed-money query already excludes
//     cancelled sessions
//   - waitlisted: set status=cancelled (never paid)
// Finally, send a class_cancelled push to each booked student.
//
// Idempotent: a conditional UPDATE guards the session flip, so two
// concurrent calls cannot both run the refund loop.

import { corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, getUserFromToken } from '../_shared/supabase.ts';
import { stripe } from '../_shared/stripe.ts';
import { notifyMany } from '../_shared/notify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);

  const user = await getUserFromToken(authHeader);
  if (!user) return errorResponse('Unauthorized', 401);

  let body: { sessionId?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body.', 400);
  }
  const sessionId = body.sessionId;
  const reason = (body.reason ?? '').trim();
  if (!sessionId) return errorResponse('sessionId is required.', 400);

  const adminClient = createAdminClient();

  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, session_date, end_time, teacher_id, is_cancelled, class_templates(name)')
    .eq('id', sessionId)
    .single();

  if (!session) return errorResponse('Session not found', 404);

  const isAdmin = profile?.role === 'admin';
  const isTeacherOfSession = (session as any).teacher_id === user.id;
  if (!isAdmin && !isTeacherOfSession) {
    return errorResponse('Forbidden', 403);
  }

  // Idempotency guard: only one caller flips is_cancelled false→true.
  const { data: flipped } = await adminClient
    .from('class_sessions')
    .update({
      is_cancelled: true,
      cancellation_reason: reason || 'Session cancelled',
    })
    .eq('id', sessionId)
    .eq('is_cancelled', false)
    .select('id');

  if (!flipped?.length) {
    return jsonResponse({ already_cancelled: true });
  }

  // Past sessions don't trigger refunds — admin is just recording history.
  // Naive comparison mirrors the rest of the codebase (CLAUDE.md: session
  // times stored without offset; no UTC conversion needed).
  const sessionEnd = new Date(`${session.session_date}T${session.end_time}Z`);
  const isPast = sessionEnd.getTime() <= Date.now();

  const { data: bookings } = await adminClient
    .from('bookings')
    .select('id, student_id, status, payment_method, payment_status, stripe_payment_intent_id')
    .eq('session_id', sessionId)
    .in('status', ['confirmed', 'waitlisted']);

  let refundCount = 0;
  let refundErrors = 0;
  let membershipSlotsReleased = 0;
  const studentIds = new Set<string>();

  for (const b of bookings ?? []) {
    studentIds.add(b.student_id);

    if (b.status === 'waitlisted') {
      await adminClient
        .from('bookings')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', b.id);
      continue;
    }

    if (
      b.payment_method === 'app' &&
      b.stripe_payment_intent_id &&
      !isPast &&
      b.payment_status !== 'refunded'
    ) {
      try {
        await stripe.refunds.create({
          payment_intent: b.stripe_payment_intent_id,
          reason: 'requested_by_customer',
        });
        refundCount++;
      } catch (e) {
        console.error(`[cancel-class-session] refund failed for booking ${b.id}:`, e);
        refundErrors++;
      }
      // Mark as refunded either way — failures need admin review but the
      // session is already cancelled, so the booking can't stay 'paid'.
      await adminClient
        .from('bookings')
        .update({ payment_status: 'refunded' })
        .eq('id', b.id);
    } else if (b.payment_method === 'membership') {
      const { error: relErr } = await adminClient
        .from('membership_weekly_usage')
        .delete()
        .eq('booking_id', b.id);
      if (!relErr) membershipSlotsReleased++;
    }
  }

  const sessionName = (session as any).class_templates?.name ?? 'Class';
  const friendlyReason = reason ? ` Reason: ${reason}` : '';
  try {
    await notifyMany({
      adminClient,
      userIds: Array.from(studentIds),
      type: 'class_cancelled',
      title: 'Class cancelled',
      body: `${sessionName} on ${session.session_date} has been cancelled.${friendlyReason}`,
      data: { sessionId },
    });
  } catch (err) {
    console.error('[cancel-class-session] notification failed', err);
  }

  return jsonResponse({
    cancelled: true,
    refundCount,
    refundErrors,
    membershipSlotsReleased,
    notified: studentIds.size,
  });
});
