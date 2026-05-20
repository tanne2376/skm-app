// JWT: ❌ (called from cancel-booking with service-role)
//
// Offer a now-vacant spot to the next eligible waitlister.
//
// Auto-charge is intentionally gone. The waitlister claims the spot
// manually via `claim-waitlist-spot` within a 1-hour window. If they
// don't, the next promotion call rotates them to the back of the
// queue and offers the spot to the next person.
//
// Called when:
//   1. A confirmed booking is cancelled (cancel-booking invokes us)
//   2. An admin-driven session change reopens capacity
//
// For each open seat (effective_capacity - confirmed_count) we
// either find a waitlister with an unexpired active claim
// (nothing to do — they already have the offer), expire stale
// claims, or assign a fresh claim to the next eligible person.

import { corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase.ts';
import { notify } from '../_shared/notify.ts';

const CLAIM_WINDOW_MS = 60 * 60 * 1000; // 1 hour

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  const { sessionId } = await req.json() as { sessionId: string };

  const adminClient = createAdminClient();

  const { data: session } = await adminClient
    .from('class_sessions')
    .select('*, class_templates(name, capacity)')
    .eq('id', sessionId)
    .single();

  if (!session) return errorResponse('Session not found', 404);

  const capacity =
    (session as any).capacity ?? (session as any).class_templates?.capacity ?? 20;

  // Live confirmed bookings
  const { count: confirmedCount } = await adminClient
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('status', 'confirmed');

  const openSpots = Math.max(0, capacity - (confirmedCount ?? 0));
  if (openSpots === 0) {
    return jsonResponse({ offered: 0, message: 'No open spots' });
  }

  // Fetch waitlisted bookings ordered by current position
  const { data: waitlisted } = await adminClient
    .from('bookings')
    .select('id, student_id, waitlist_position, claim_window_started_at')
    .eq('session_id', sessionId)
    .eq('status', 'waitlisted')
    .order('waitlist_position', { ascending: true });

  if (!waitlisted || waitlisted.length === 0) {
    return jsonResponse({ offered: 0, message: 'No one on waitlist' });
  }

  const now = Date.now();
  const sessionName = (session as any).class_templates?.name ?? 'Class';

  // Rotate stale (>1hr) offers to the back of the queue.
  // Bumping their waitlist_position past max ensures they fall to the
  // end without colliding with anyone else's position.
  const maxPos = waitlisted.reduce(
    (m, b) => Math.max(m, b.waitlist_position ?? 0),
    0,
  );
  let nextBackPos = maxPos + 1;
  const rotatedIds: string[] = [];
  for (const b of waitlisted) {
    if (!b.claim_window_started_at) continue;
    const startedAt = new Date(b.claim_window_started_at).getTime();
    if (now - startedAt >= CLAIM_WINDOW_MS) {
      await adminClient
        .from('bookings')
        .update({
          claim_window_started_at: null,
          waitlist_position: nextBackPos,
        })
        .eq('id', b.id);
      rotatedIds.push(b.id);
      nextBackPos++;
    }
  }

  // Re-read with the new ordering after rotation. We only need to
  // refetch if anything actually rotated.
  let queue = waitlisted;
  if (rotatedIds.length > 0) {
    const { data: refetched } = await adminClient
      .from('bookings')
      .select('id, student_id, waitlist_position, claim_window_started_at')
      .eq('session_id', sessionId)
      .eq('status', 'waitlisted')
      .order('waitlist_position', { ascending: true });
    queue = refetched ?? [];
  }

  // Assign offers up to openSpots. Skip waitlisters who already have
  // an active (non-expired) claim — they were already offered.
  let offered = 0;
  let assigned = 0;
  const newlyOffered: string[] = [];

  for (const b of queue) {
    if (offered >= openSpots) break;

    const hasActiveClaim =
      b.claim_window_started_at &&
      now - new Date(b.claim_window_started_at).getTime() < CLAIM_WINDOW_MS;

    if (hasActiveClaim) {
      offered++;
      continue;
    }

    // Assign a fresh claim to this person.
    const { error: assignError } = await adminClient
      .from('bookings')
      .update({ claim_window_started_at: new Date().toISOString() })
      .eq('id', b.id);
    if (assignError) {
      console.error(`[promote-waitlist] failed to assign claim ${b.id}:`, assignError.message);
      continue;
    }
    newlyOffered.push(b.student_id);
    offered++;
    assigned++;

    try {
      await notify({
        adminClient,
        userId: b.student_id,
        type: 'waitlist_promotion',
        title: 'A spot opened up!',
        body: `${sessionName} on ${session.session_date} has a spot for you. Claim it within 1 hour or it rolls to the next person.`,
        data: { sessionId, bookingId: b.id },
      });
    } catch (err) {
      console.error('[promote-waitlist] notify failed', err);
    }
  }

  return jsonResponse({
    offered,
    assigned,
    rotated: rotatedIds.length,
    newlyOfferedStudentIds: newlyOffered,
  });
});
