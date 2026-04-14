/**
 * Shared helper that sends a push notification only if the recipient
 * has not opted out of the given notification type.
 *
 * Missing keys in notification_preferences are treated as enabled (opt-out model).
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

type NotificationType =
  | 'waitlist_promotion'
  | 'one_to_one_available'
  | 'upcoming_class'
  | 'class_joined'
  | 'class_left'
  | 'one_to_one_booked'
  | 'class_full'
  | 'class_time_changed'
  | 'membership_renewal';

interface NotifyParams {
  adminClient: SupabaseClient;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Send a push notification to a single user, respecting their preferences.
 * Returns true if the notification was sent, false if skipped.
 */
export async function notify({
  adminClient,
  userId,
  type,
  title,
  body,
  data,
}: NotifyParams): Promise<boolean> {
  const { data: profile, error } = await adminClient
    .from('profiles')
    .select('push_token, notification_preferences')
    .eq('id', userId)
    .single();

  if (error) {
    console.error(`[notify] Failed to fetch profile ${userId}:`, error.message);
    return false;
  }
  if (!profile?.push_token) return false;

  const prefs = (profile.notification_preferences ?? {}) as Record<string, boolean>;
  if (prefs[type] === false) return false;

  const { error: invokeError } = await adminClient.functions.invoke('send-notification', {
    body: {
      pushToken: profile.push_token,
      title,
      body,
      data: data ?? {},
    },
  });

  if (invokeError) {
    console.error(`[notify] send-notification failed for ${userId}:`, invokeError.message);
    return false;
  }

  return true;
}

/**
 * Send a push notification to multiple users, respecting each user's preferences.
 */
export async function notifyMany({
  adminClient,
  userIds,
  type,
  title,
  body,
  data,
}: Omit<NotifyParams, 'userId'> & { userIds: string[] }): Promise<void> {
  if (userIds.length === 0) return;

  const { data: profiles, error } = await adminClient
    .from('profiles')
    .select('id, push_token, notification_preferences')
    .in('id', userIds);

  if (error) {
    console.error(`[notifyMany] Failed to fetch profiles:`, error.message);
    return;
  }
  if (!profiles || profiles.length === 0) return;

  const sends: Promise<void>[] = [];
  for (const profile of profiles) {
    if (!profile.push_token) continue;
    const prefs = (profile.notification_preferences ?? {}) as Record<string, boolean>;
    if (prefs[type] === false) continue;

    sends.push(
      adminClient.functions.invoke('send-notification', {
        body: {
          pushToken: profile.push_token,
          title,
          body,
          data: data ?? {},
        },
      }),
    );
  }

  await Promise.allSettled(sends);
}

/**
 * Shared helper: notify teacher + admins when a student joins a class,
 * and notify teacher if the class is now full.
 */
export async function notifyClassJoined({
  adminClient,
  sessionId,
  studentName,
  suffix,
}: {
  adminClient: SupabaseClient;
  sessionId: string;
  studentName: string;
  suffix?: string;
}): Promise<void> {
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('session_date, teacher_id, capacity, template_id, class_templates(name, capacity)')
    .eq('id', sessionId)
    .single();

  if (!session) return;

  const sessionName = (session as any).class_templates?.name ?? 'Class';

  // Build deduplicated recipient list: teacher + admins
  const notifyIds = new Set<string>();
  if ((session as any).teacher_id) notifyIds.add((session as any).teacher_id);
  const { data: admins } = await adminClient.from('profiles').select('id').eq('role', 'admin');
  for (const a of admins ?? []) notifyIds.add(a.id);

  await notifyMany({
    adminClient,
    userIds: Array.from(notifyIds),
    type: 'class_joined',
    title: 'Student joined class',
    body: `${studentName} booked ${sessionName} on ${session.session_date}${suffix ? ` ${suffix}` : ''}.`,
    data: { sessionId },
  });

  // Check if class is now full → notify teacher
  const effectiveCapacity = (session as any).capacity ?? (session as any).class_templates?.capacity ?? 20;
  const { count } = await adminClient
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('status', 'confirmed');

  if (count !== null && count >= effectiveCapacity && (session as any).teacher_id) {
    await notify({
      adminClient,
      userId: (session as any).teacher_id,
      type: 'class_full',
      title: 'Class is full',
      body: `${sessionName} on ${session.session_date} has reached capacity (${effectiveCapacity}).`,
      data: { sessionId },
    });
  }
}
