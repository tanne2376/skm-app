import { StyleSheet, Text, View } from 'react-native';
import { COLORS, CANCELLATION_WINDOW_HOURS } from '@/constants';
import { ClassSessionWithDetails } from '@/types';
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
  isMutating?: boolean;
  isAdmin?: boolean;
  freeWithMembership?: boolean;
  isBlockedFromBooking?: boolean;
}

export function SessionCard({ session, onBook, onCancel, isMutating = false, isAdmin = false, freeWithMembership = false, isBlockedFromBooking = false }: SessionCardProps) {
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

  if (session.is_cancelled) {
    return (
      <Card style={styles.cancelled}>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.className}>{session.class_templates.name}</Text>
            <Text style={styles.meta}>{dateStr} · {timeStr} · {teacherName}</Text>
          </View>
          <Badge label="Cancelled" variant="error" />
        </View>
        {session.cancellation_reason ? (
          <Text style={styles.cancellationReason}>{session.cancellation_reason}</Text>
        ) : null}
      </Card>
    );
  }

  return (
    <Card style={isPast ? styles.pastCard : undefined}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.className}>{session.class_templates.name}</Text>
          <Text style={styles.meta}>{dateStr} · {timeStr} · {teacherName}</Text>
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
        </View>
      </View>

      {/* Actions */}
      {!isPast && (
        <View style={styles.actionRow}>
          {/* Blocked from booking */}
          {!userBooking && isBlockedFromBooking && (
            <Text style={styles.blockedWarning}>
              Blocked from booking — 3+ late cancellations this month
            </Text>
          )}

          {/* Not booked, spots available → Book */}
          {!userBooking && !isFull && !isBlockedFromBooking && (
            <Button
              variant="primary"
              size="sm"
              onPress={onBook}
              loading={isMutating}
              style={styles.actionButton}
            >
              Book
            </Button>
          )}

          {/* Not booked, full → Add to Waitlist */}
          {!userBooking && isFull && !isBlockedFromBooking && (
            <Button
              variant="secondary"
              size="sm"
              onPress={onBook}
              loading={isMutating}
              style={styles.actionButton}
            >
              Add to Waitlist
            </Button>
          )}

          {/* Confirmed, outside cancellation window */}
          {userBooking?.status === 'confirmed' && !withinCancellationWindow && (
            <Button
              variant="ghost"
              size="sm"
              onPress={onCancel}
              loading={isMutating}
              style={styles.cancelButton}
            >
              Cancel Booking
            </Button>
          )}

          {/* Confirmed, within cancellation window */}
          {userBooking?.status === 'confirmed' && withinCancellationWindow && (
            <View>
              <Text style={styles.noRefundWarning}>
                Cancelling within {CANCELLATION_WINDOW_HOURS}hrs — no refund
              </Text>
              <Button
                variant="danger"
                size="sm"
                onPress={onCancel}
                loading={isMutating}
                style={styles.actionButton}
              >
                Cancel (No Refund)
              </Button>
            </View>
          )}

          {/* Waitlisted → show position + leave */}
          {userBooking?.status === 'waitlisted' && (
            <View style={styles.waitlistRow}>
              <Text style={styles.waitlistPosition}>
                #{userBooking.waitlist_position} on waitlist
              </Text>
              <Button
                variant="ghost"
                size="sm"
                onPress={onCancel}
                loading={isMutating}
              >
                Leave Waitlist
              </Button>
            </View>
          )}
        </View>
      )}

      {isPast && <Text style={styles.pastLabel}>Class has ended</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rightColumn: { alignItems: 'flex-end', gap: 4 },
  actionRow: { marginTop: 12, gap: 8 },
  actionButton: { alignSelf: 'flex-start' },
  cancelButton: { alignSelf: 'flex-start' },
  waitlistRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  cancelled: { opacity: 0.6 },
  pastCard: { opacity: 0.5 },

  className: { color: COLORS.white, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  meta: { color: COLORS.grey[400], fontSize: 13, marginBottom: 2 },
  price: { color: COLORS.grey[400], fontSize: 13 },
  priceFree: { color: COLORS.success },
  spots: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
  spotsFull: { color: COLORS.accent },
  waitlistPosition: { color: COLORS.warning, fontSize: 13, flex: 1 },
  noRefundWarning: { color: COLORS.warning, fontSize: 12, marginBottom: 6 },
  blockedWarning: { color: COLORS.error, fontSize: 12, fontWeight: '600' },
  pastLabel: { color: COLORS.grey[600], fontSize: 12, marginTop: 8 },
  cancellationReason: { color: COLORS.grey[400], fontSize: 13, marginTop: 8, fontStyle: 'italic' },
});
