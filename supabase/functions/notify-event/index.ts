import { corsHeaders, corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient, getUserFromToken } from '../_shared/supabase.ts';
import { notify, notifyMany, notifyClassJoined } from '../_shared/notify.ts';

/**
 * Lightweight edge function for sending notifications from client-side events
 * that don't go through a server-side booking flow (e.g. cash bookings,
 * 1-to-1 creation, session time changes).
 */

type EventType =
  | 'class_booked_cash'
  | 'one_to_one_booked_cash'
  | 'one_to_one_created'
  | 'class_time_changed';

interface EventPayload {
  event: EventType;
  sessionId?: string;
  oneToOneId?: string;
  oldTime?: string;
  newTime?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);

  const user = await getUserFromToken(authHeader);
  if (!user) return errorResponse('Unauthorized', 401);

  let payload: EventPayload;
  try {
    payload = await req.json() as EventPayload;
  } catch {
    return errorResponse('Invalid JSON payload', 400);
  }
  const adminClient = createAdminClient();

  // ── class_booked_cash: notify teacher + admins ────────────────────────
  if (payload.event === 'class_booked_cash' && payload.sessionId) {
    const { data: student } = await adminClient
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    await notifyClassJoined({
      adminClient,
      sessionId: payload.sessionId,
      studentName: student?.full_name ?? 'A student',
      suffix: '(cash)',
    });
  }

  // ── one_to_one_booked_cash: notify the 1-to-1 owner ──────────────────
  else if (payload.event === 'one_to_one_booked_cash' && payload.oneToOneId) {
    const { data: oto } = await adminClient
      .from('one_to_ones')
      .select('teacher_id, creator_id, title')
      .eq('id', payload.oneToOneId)
      .single();

    if (oto) {
      const { data: student } = await adminClient
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();

      const ownerId = oto.creator_id ?? oto.teacher_id;
      if (ownerId) {
        await notify({
          adminClient,
          userId: ownerId,
          type: 'one_to_one_booked',
          title: '1-to-1 booked',
          body: `${student?.full_name ?? 'Someone'} booked your session "${oto.title}" (cash).`,
          data: { oneToOneId: payload.oneToOneId },
        });
      }
    }
  }

  // ── one_to_one_created: notify all students + teachers ────────────────
  else if (payload.event === 'one_to_one_created' && payload.oneToOneId) {
    const { data: oto } = await adminClient
      .from('one_to_ones')
      .select('title, teacher_id, session_date, start_time')
      .eq('id', payload.oneToOneId)
      .single();

    if (oto) {
      const { data: teacher } = await adminClient
        .from('profiles')
        .select('full_name')
        .eq('id', oto.teacher_id)
        .single();

      // Notify all students and teachers except the creator
      const { data: recipients } = await adminClient
        .from('profiles')
        .select('id')
        .in('role', ['student', 'teacher'])
        .neq('id', user.id);

      await notifyMany({
        adminClient,
        userIds: (recipients ?? []).map((r: any) => r.id),
        type: 'one_to_one_available',
        title: 'New 1-to-1 available',
        body: `${teacher?.full_name ?? 'A teacher'} opened a session: "${oto.title}" on ${oto.session_date} at ${oto.start_time.slice(0, 5)}.`,
        data: { oneToOneId: payload.oneToOneId },
      });
    }
  }

  // ── class_time_changed: notify all booked students (not admins) ───────
  else if (payload.event === 'class_time_changed' && payload.sessionId) {
    const { data: session } = await adminClient
      .from('class_sessions')
      .select('session_date, teacher_id, class_templates(name)')
      .eq('id', payload.sessionId)
      .single();

    if (session) {
      const sessionName = (session as any).class_templates?.name ?? 'Class';

      // Get all confirmed + waitlisted bookings for this session
      const { data: bookings } = await adminClient
        .from('bookings')
        .select('student_id')
        .eq('session_id', payload.sessionId)
        .in('status', ['confirmed', 'waitlisted']);

      const recipientIds = (bookings ?? []).map((b: any) => b.student_id);
      if ((session as any).teacher_id && !recipientIds.includes((session as any).teacher_id)) {
        recipientIds.push((session as any).teacher_id);
      }

      // Filter out admins (they made the change)
      const { data: adminProfiles } = await adminClient
        .from('profiles')
        .select('id')
        .eq('role', 'admin');
      const adminIds = new Set((adminProfiles ?? []).map((a: any) => a.id));
      const filtered = recipientIds.filter((id: string) => !adminIds.has(id));

      const timeInfo = payload.oldTime && payload.newTime
        ? `Time changed from ${payload.oldTime} to ${payload.newTime}.`
        : 'The schedule has been updated.';

      await notifyMany({
        adminClient,
        userIds: filtered,
        type: 'class_time_changed',
        title: 'Class time changed',
        body: `${sessionName} on ${session.session_date}: ${timeInfo}`,
        data: { sessionId: payload.sessionId },
      });
    }
  }

  else {
    // Unknown event type
    console.warn(`[notify-event] Unknown event type: ${payload.event}`);
    return errorResponse(`Unknown event type: ${payload.event}`, 400);
  }

  return jsonResponse({ ok: true });
});
