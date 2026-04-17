import { corsHeaders, corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, getUserFromToken } from '../_shared/supabase.ts';
import { membershipWeekStart } from '../_shared/membershipWeek.ts';
import { notify, notifyMany } from '../_shared/notify.ts';

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

  // Check late cancellation block
  const { data: isBlocked, error: blockedError } = await adminClient.rpc('is_user_booking_blocked', { p_user_id: user.id });
  if (blockedError) return errorResponse('Failed to check booking eligibility', 500);
  if (isBlocked) {
    return errorResponse('You are blocked from booking classes this month due to 3 or more late cancellations.', 403);
  }

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

  // Notify teacher + admins: student joined
  const { data: sessionDetails } = await adminClient
    .from('class_sessions')
    .select('session_date, teacher_id, capacity, class_templates(name, capacity)')
    .eq('id', session_id)
    .single();

  if (sessionDetails) {
    const { data: studentProfile } = await adminClient
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    const sessionName = (sessionDetails as any).class_templates?.name ?? 'Class';
    const notifyIds: string[] = [];
    if ((sessionDetails as any).teacher_id) notifyIds.push((sessionDetails as any).teacher_id);
    const { data: admins } = await adminClient.from('profiles').select('id').eq('role', 'admin');
    for (const a of admins ?? []) {
      if (!notifyIds.includes(a.id)) notifyIds.push(a.id);
    }

    await notifyMany({
      adminClient,
      userIds: notifyIds,
      type: 'class_joined',
      title: 'Student joined class',
      body: `${studentProfile?.full_name ?? 'A student'} booked ${sessionName} on ${sessionDetails.session_date}.`,
      data: { sessionId: session_id },
    });

    // Check if class is now full
    const effectiveCapacity = (sessionDetails as any).capacity ?? (sessionDetails as any).class_templates?.capacity ?? 20;
    const { count: confirmedCount } = await adminClient
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', session_id)
      .eq('status', 'confirmed');
    if (confirmedCount !== null && confirmedCount >= effectiveCapacity && (sessionDetails as any).teacher_id) {
      await notify({
        adminClient,
        userId: (sessionDetails as any).teacher_id,
        type: 'class_full',
        title: 'Class is full',
        body: `${sessionName} on ${sessionDetails.session_date} has reached capacity (${effectiveCapacity}).`,
        data: { sessionId: session_id },
      });
    }
  }

  return jsonResponse({ booking_id: booking.id });
});
