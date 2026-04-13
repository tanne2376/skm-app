import { corsHeaders, corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, getUserFromToken } from '../_shared/supabase.ts';
import { membershipWeekStart } from '../_shared/membershipWeek.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);

  const user = await getUserFromToken(authHeader);
  if (!user) return errorResponse('Unauthorized', 401);

  const { session_id, membership_id } = await req.json() as {
    session_id: string;
    membership_id: string;
  };

  const adminClient = createAdminClient();

  // Verify membership belongs to this user and is active
  const { data: membership } = await adminClient
    .from('memberships')
    .select('*')
    .eq('id', membership_id)
    .eq('student_id', user.id)
    .eq('status', 'active')
    .single();

  if (!membership) return errorResponse('Membership not found or inactive', 403);

  // Check 2x/week quota
  if (membership.tier === 'two_per_week') {
    // Get session date to compute membership week start
    const { data: session } = await adminClient
      .from('class_sessions')
      .select('session_date, start_time')
      .eq('id', session_id)
      .single();
    if (!session) return errorResponse('Session not found', 404);

    const weekStart = membershipWeekStart(session.session_date, session.start_time);

    const { count } = await adminClient
      .from('membership_weekly_usage')
      .select('id', { count: 'exact', head: true })
      .eq('membership_id', membership_id)
      .eq('week_start', weekStart);

    if ((count ?? 0) >= 2) {
      return errorResponse('Weekly class quota reached (2/2). Upgrade to unlimited.', 400);
    }
  }

  // Insert booking
  const { data: booking, error: bookingError } = await adminClient
    .from('bookings')
    .insert({
      session_id,
      student_id: user.id,
      status: 'confirmed',
      payment_method: 'membership',
      payment_status: 'paid',
    })
    .select()
    .single();

  if (bookingError) {
    if (bookingError.code === '23505') return errorResponse('Already booked for this class.', 409);
    throw bookingError;
  }

  // Record weekly usage
  const { data: sessionForUsage } = await adminClient
    .from('class_sessions')
    .select('session_date, start_time')
    .eq('id', session_id)
    .single();

  if (sessionForUsage && membership.tier === 'two_per_week') {
    const weekStart = membershipWeekStart(sessionForUsage.session_date, sessionForUsage.start_time);
    await adminClient.from('membership_weekly_usage').insert({
      membership_id,
      student_id: user.id,
      booking_id: booking.id,
      week_start: weekStart,
    });
  }

  return jsonResponse({ booking_id: booking.id });
});
