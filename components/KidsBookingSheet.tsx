import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS } from '@/constants';
import { SlideUpModal } from '@/components/ui/SlideUpModal';
import { Button } from '@/components/ui/Button';
import { levelButtonStyle } from '@/components/SessionCard';
import { ChildClassState, KidsClassActions } from '@/hooks/useKidsClassActions';
import { Child, ClassSessionWithDetails } from '@/types';

interface KidsBookingSheetProps {
  session: ClassSessionWithDetails | null;
  onDismiss: () => void;
  actions: KidsClassActions;
}

/**
 * "Who is this for?" for a kids class, shown when a tap could mean more than
 * one child: each child with their booking, or what they need before they can
 * book. Kids classes are membership-only, so there's no payment step.
 */
export function KidsBookingSheet({ session, onDismiss, actions }: KidsBookingSheetProps) {
  const { children, ready, isMutating } = actions;

  function renderChild(child: Child) {
    if (!session) return null;
    const state = actions.stateFor(session, child);
    const { status, tone, label } = describe(state, session);
    // Leaving the screen (to sign or view a membership) closes the sheet.
    const leaves = state.kind === 'needs_waiver' || (state.kind === 'needs_membership' && !!state.membership);

    return (
      <View key={child.id} style={styles.childRow}>
        <View style={styles.childInfo}>
          <Text style={styles.childName}>{child.full_name}</Text>
          <Text style={[styles.childStatus, tone === 'ok' && styles.statusOk, tone === 'warn' && styles.statusWarn]}>
            {status}
          </Text>
        </View>
        {label && (
          <View style={styles.actions}>
            <Button
              variant={state.kind === 'bookable' || state.kind === 'claim' ? 'primary' : 'secondary'}
              size="sm"
              style={state.kind === 'bookable' || state.kind === 'claim' ? levelButtonStyle('kids') : undefined}
              loading={isMutating}
              onPress={() => {
                if (leaves) onDismiss();
                actions.act(session, child);
              }}
            >
              {label}
            </Button>
            {state.kind === 'claim' && (
              <Button variant="ghost" size="sm" loading={isMutating} onPress={() => actions.cancel(session, child, state.booking)}>
                Leave
              </Button>
            )}
          </View>
        )}
      </View>
    );
  }

  return (
    <SlideUpModal visible={!!session} onDismiss={onDismiss}>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>{session?.class_templates.name}</Text>
        <Text style={styles.meta}>
          {session?.start_time.slice(0, 5)}–{session?.end_time.slice(0, 5)} · Who is this for?
        </Text>

        {!ready ? null : children && children.length > 0 ? (
          <View style={styles.list}>{children.map(renderChild)}</View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Kids classes are booked for a child on your account. Add your child, sign their waiver, then take out a kids membership.
            </Text>
            <Button
              variant="primary"
              size="md"
              onPress={() => {
                onDismiss();
                router.push('/(app)/settings/family');
              }}
            >
              Add a Child
            </Button>
          </View>
        )}
      </View>
    </SlideUpModal>
  );
}

function describe(state: ChildClassState, session: ClassSessionWithDetails): {
  status: string;
  tone: 'ok' | 'warn' | 'muted';
  label: string | null;
} {
  const isFull = session.confirmed_count >= session.effective_capacity;
  switch (state.kind) {
    case 'booked':
      return { status: 'Booked', tone: 'ok', label: 'Cancel' };
    case 'claim':
      return { status: `A spot opened up — claim within ${state.minutesLeft} min`, tone: 'ok', label: 'Claim' };
    case 'waitlisted':
      return { status: `#${state.booking.waitlist_position} on waitlist`, tone: 'warn', label: 'Leave' };
    case 'needs_waiver':
      return { status: 'Waiver needed before booking', tone: 'warn', label: 'Sign' };
    case 'needs_membership':
      if (!state.membership) return { status: 'Needs a kids membership', tone: 'warn', label: 'Get' };
      return {
        status: state.membership.status === 'past_due'
          ? 'Membership payment failed'
          : 'Membership paused — cash payment overdue',
        tone: 'warn',
        label: 'View',
      };
    case 'blocked':
      return { status: 'Booking blocked — 3+ late cancellations this month', tone: 'warn', label: null };
    case 'bookable':
      return { status: 'Kids membership', tone: 'muted', label: isFull ? 'Join Waitlist' : 'Book' };
  }
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: COLORS.grey[900],
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderColor: COLORS.grey[800],
    paddingBottom: 40, paddingHorizontal: 20, paddingTop: 12,
  },
  handle: {
    width: 36, height: 4, backgroundColor: COLORS.grey[700],
    borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  title: { color: COLORS.white, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  meta: { color: COLORS.grey[400], fontSize: 14, marginBottom: 16 },
  list: { gap: 10 },
  childRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.grey[800], borderRadius: 10, padding: 14,
  },
  childInfo: { flex: 1, gap: 2 },
  childName: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  childStatus: { color: COLORS.grey[400], fontSize: 13 },
  statusOk: { color: COLORS.success },
  statusWarn: { color: COLORS.warning },
  actions: { flexDirection: 'row', gap: 6 },
  empty: { gap: 16 },
  emptyText: { color: COLORS.grey[400], fontSize: 14, lineHeight: 20 },
});
