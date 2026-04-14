/**
 * Shared helper that sends a push notification only if the recipient
 * has not opted out of the given notification type.
 *
 * Missing keys in notification_preferences are treated as enabled (opt-out model).
 */

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
  adminClient: any;
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
  const { data: profile } = await adminClient
    .from('profiles')
    .select('push_token, notification_preferences')
    .eq('id', userId)
    .single();

  if (!profile?.push_token) return false;

  const prefs = (profile.notification_preferences ?? {}) as Record<string, boolean>;
  if (prefs[type] === false) return false;

  await adminClient.functions.invoke('send-notification', {
    body: {
      pushToken: profile.push_token,
      title,
      body,
      data: data ?? {},
    },
  });

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

  const { data: profiles } = await adminClient
    .from('profiles')
    .select('id, push_token, notification_preferences')
    .in('id', userIds);

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
