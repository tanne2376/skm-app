import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { COLORS, CANCELLATION_WINDOW_HOURS, CLASS_LEVELS } from '@/constants';
import { ClassLevel, ClassSessionWithDetails } from '@/types';
import { formatGBP } from '@/lib/stripe';
import { getClassLeaderName } from '@/lib/teacherName';
import { useDefaultClassLeaderName } from '@/hooks/useDefaultClassLeader';
import { Card } from './ui/Card';
import { Badge, BookingStatusBadge } from './ui/Badge';
import { Button } from './ui/Button';

interface SessionCardProps {
  session: ClassSessionWithDetails;
  onBook: () => void;
  onCancel: () => void;
  onClaim: () => void;
  isMutating?: boolean;
  isAdmin?: boolean;
  freeWithMembership?: boolean;
  isBlockedFromBooking?: boolean;
}

const CLAIM_WINDOW_MS = 60 * 60 * 1000;

// Darker status colours that stay readable on the white card body.
const ON_WHITE = { success: '#15803D', warning: '#B45309', error: '#DC2626' } as const;

/** Button style that fills a primary button with the class level's colour. */
export function levelButtonStyle(level: ClassLevel | undefined): ViewStyle {
  return { backgroundColor: CLASS_LEVELS[level ?? 'general'].band };
}

/**
 * Timetable-style class card: white body under a level-coloured top line,
 * with a tinted footer naming the level. Shared by the student SessionCard
 * and the admin home card.
 */
export function ClassCardShell({
  title, level, cancelled = false, style, children,
}: {
  title: string;
  level: ClassLevel | undefined;
  cancelled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const levelStyle = CLASS_LEVELS[level ?? 'general'];
  return (
    <Card style={[styles.card, { borderTopColor: cancelled ? COLORS.grey[700] : levelStyle.band }, style]}>
      <View style={styles.body}>
        <Text style={styles.className} numberOfLines={2}>{title}</Text>
        {children}
      </View>
      {!cancelled && (
        <View style={[styles.footer, { backgroundColor: levelStyle.tint }]}>
          <Text style={styles.levelText}>{levelStyle.label}</Text>
        </View>
      )}
    </Card>
  );
}

export function SessionCard({ session, onBook, onCancel, onClaim, isMutating = false, isAdmin = false, freeWithMembership = false, isBlockedFromBooking = false }: SessionCardProps) {
  const { data: defaultLeaderName } = useDefaultClassLeaderName();
  const now = new Date();
  const sessionStart = new Date(`${session.session_date}T${session.start_time}`);
  const isPast = sessionStart < now;
  const hoursUntil = (sessionStart.getTime() - now.getTime()) / (1000 * 60 * 60);
  const withinCancellationWindow = hoursUntil > 0 && hoursUntil <= CANCELLATION_WINDOW_HOURS;
  const spotsLeft = session.effective_capacity - session.confirmed_count;
  const isFull = spotsLeft <= 0;
  const userBooking = session.user_booking;

  const timeStr = `${session.start_time.slice(0, 5)}–${session.end_time.slice(0, 5)}`;
  const dateStr = new Date(session.session_date + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  const teacherName = getClassLeaderName(session, defaultLeaderName);
  const claimStartedAt = userBooking?.claim_window_started_at
    ? new Date(userBooking.claim_window_started_at).getTime()
    : null;
  const claimActive =
    claimStartedAt !== null && now.getTime() - claimStartedAt < CLAIM_WINDOW_MS;
  const claimMinutesLeft = claimActive
    ? Math.max(1, Math.ceil((CLAIM_WINDOW_MS - (now.getTime() - claimStartedAt!)) / 60000))
    : 0;
  const title = session.class_templates.name;
  const level = session.class_templates.level;

  if (session.is_cancelled) {
    return (
      <ClassCardShell title={title} level={level} cancelled style={styles.cancelled}>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.time}>{timeStr}</Text>
              <Text style={styles.meta}>{dateStr} · {teacherName}</Text>
            </View>
            <Badge label="Cancelled" variant="error" />
          </View>
          {session.cancellation_reason ? (
            <Text style={styles.cancellationReason}>{session.cancellation_reason}</Text>
          ) : null}
      </ClassCardShell>
    );
  }

  return (
    <ClassCardShell title={title} level={level} style={isPast && styles.pastCard}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.time}>{timeStr}</Text>
          <Text style={styles.meta}>{dateStr} · {teacherName}</Text>
          <Text style={[styles.price, freeWithMembership && styles.priceFree]}>
            {freeWithMembership ? 'Free with membership' : formatGBP(session.effective_price)}
          </Text>
        </View>
        <View style={styles.rightColumn}>
          {isAdmin && !isPast && (
            <Text style={[styles.spots, isFull && styles.spotsFull]}>
              {session.confirmed_count}/{session.effective_capacity}
            </Text>
          )}
          {isFull && !userBooking && <Badge label="Full" variant="error" />}
          {userBooking && <BookingStatusBadge status={userBooking.status} />}

          {/* Primary action sits beside the details to keep the card short */}
          {!isPast && !userBooking && !isBlockedFromBooking && (
            <Button
              variant={isFull ? 'secondary' : 'primary'}
              size="sm"
              onPress={onBook}
              loading={isMutating}
              style={isFull ? undefined : levelButtonStyle(level)}
            >
              {isFull ? 'Join Waitlist' : 'Book'}
            </Button>
          )}
          {!isPast && userBooking?.status === 'confirmed' && (
            <Button
              variant={withinCancellationWindow ? 'danger' : 'secondary'}
              size="sm"
              onPress={onCancel}
              loading={isMutating}
            >
              {withinCancellationWindow ? 'Cancel (No Refund)' : 'Cancel Booking'}
            </Button>
          )}
          {!isPast && userBooking?.status === 'waitlisted' && !claimActive && (
            <Button
              variant="secondary"
              size="sm"
              onPress={onCancel}
              loading={isMutating}
            >
              Leave Waitlist
            </Button>
          )}
        </View>
      </View>

      {/* Full-width notices below the details */}
      {!isPast && !userBooking && isBlockedFromBooking && (
        <Text style={[styles.blockedWarning, styles.notice]}>
          Blocked from booking — 3+ late cancellations this month
        </Text>
      )}
      {!isPast && userBooking?.status === 'confirmed' && withinCancellationWindow && (
        <Text style={[styles.noRefundWarning, styles.notice]}>
          Cancelling within {CANCELLATION_WINDOW_HOURS}hrs — no refund
        </Text>
      )}
      {!isPast && userBooking?.status === 'waitlisted' && !claimActive && (
        <Text style={[styles.waitlistPosition, styles.notice]}>
          #{userBooking.waitlist_position} on waitlist
        </Text>
      )}
      {!isPast && userBooking?.status === 'waitlisted' && claimActive && (
        <View style={[styles.claimBox, styles.notice]}>
          <Text style={styles.claimTitle}>A spot just opened up!</Text>
          <Text style={styles.claimSub}>
            Claim within {claimMinutesLeft} min or it rolls to the next person.
          </Text>
          <View style={styles.claimActions}>
            <Button variant="primary" size="sm" onPress={onClaim} loading={isMutating} style={levelButtonStyle(level)}>
              Claim my spot
            </Button>
            <Button variant="secondary" size="sm" onPress={onCancel} loading={isMutating}>
              Leave Waitlist
            </Button>
          </View>
        </View>
      )}

      {isPast && <Text style={styles.pastLabel}>Class has ended</Text>}
    </ClassCardShell>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rightColumn: { alignItems: 'flex-end', justifyContent: 'center', gap: 6, alignSelf: 'center' },
  notice: { marginTop: 10 },
  claimActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  cancelled: { opacity: 0.6 },
  pastCard: { opacity: 0.5 },

  card: { padding: 0, overflow: 'hidden', borderWidth: 0, borderTopWidth: 6 },
  body: { padding: 16, backgroundColor: COLORS.white },
  footer: { paddingVertical: 6, alignItems: 'center' },
  levelText: { color: COLORS.black, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  className: { color: COLORS.black, fontSize: 15, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 },
  time: { color: COLORS.black, fontSize: 20, fontWeight: '800', marginBottom: 2 },
  meta: { color: COLORS.grey[700], fontSize: 13, marginBottom: 2 },
  price: { color: COLORS.grey[700], fontSize: 13 },
  priceFree: { color: ON_WHITE.success, fontWeight: '600' },
  spots: { color: COLORS.black, fontSize: 13, fontWeight: '700' },
  spotsFull: { color: COLORS.accent },
  waitlistPosition: { color: ON_WHITE.warning, fontWeight: '600', fontSize: 13 },
  claimBox: {
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
    padding: 12,
    gap: 8,
  },
  claimTitle: { color: ON_WHITE.success, fontSize: 14, fontWeight: '700' },
  claimSub: { color: COLORS.grey[700], fontSize: 12 },
  noRefundWarning: { color: ON_WHITE.warning, fontWeight: '600', fontSize: 12 },
  blockedWarning: { color: ON_WHITE.error, fontSize: 12, fontWeight: '600' },
  pastLabel: { color: COLORS.grey[700], fontSize: 12, marginTop: 8 },
  cancellationReason: { color: COLORS.grey[700], fontSize: 13, marginTop: 8, fontStyle: 'italic' },
});
