import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  RefreshControl,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { SlideUpModal } from '@/components/ui/SlideUpModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SessionCard } from '@/components/SessionCard';
import { PaymentMethodSelector } from '@/components/PaymentMethodSelector';
import { useUpcomingSessions } from '@/hooks/useClassSessions';
import { useActiveMembership } from '@/hooks/useActiveMembership';
import { useBookSession, useCancelBooking, useJoinWaitlist } from '@/hooks/useBookSession';
import { useDefaultClassLeaderName } from '@/hooks/useDefaultClassLeader';
import { getClassLeaderName } from '@/lib/teacherName';
import { useRealtimeInvalidate } from '@/hooks/useRealtime';
import { useAuth } from '@/hooks/useAuth';
import { useBookingBlocked } from '@/hooks/useLateCancellations';
import { supabase, invokeFunction } from '@/lib/supabase';
import { ClassSessionWithDetails, PaymentMethod, BookingWithStudent } from '@/types';
import { PaymentStatusBadge } from '@/components/ui/Badge';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { role, session: authSession } = useAuth();
  const isAdmin = role === 'admin';
  const { data: allSessions, isLoading, isFetching, refetch } = useUpcomingSessions();

  // Hide past sessions — admin gets a 2hr buffer after session ends to collect payments
  const now = new Date();
  const sessions = allSessions?.filter((s) => {
    const sessionEnd = new Date(`${s.session_date}T${s.end_time}`);
    const cutoff = isAdmin
      ? new Date(sessionEnd.getTime() + 2 * 60 * 60 * 1000)
      : new Date(`${s.session_date}T${s.start_time}`);
    return cutoff > now && (isAdmin || s.teacher?.id !== authSession?.user.id);
  });
  const { data: membership } = useActiveMembership();
  const { data: blockStatus } = useBookingBlocked();
  const isBlockedFromBooking = !isAdmin && (blockStatus?.blocked ?? false);
  const lateCancelCount = blockStatus?.count ?? 0;
  const bookSession = useBookSession();
  const cancelBooking = useCancelBooking();
  const joinWaitlist = useJoinWaitlist();

  const [selectedSession, setSelectedSession] = useState<ClassSessionWithDetails | null>(null);

  useRealtimeInvalidate('home-bookings', 'bookings', undefined, ['class_sessions']);

  // Can the user book for free with their membership?
  const canUseMembership = (() => {
    if (!membership || membership.status !== 'active') return false;
    if (membership.tier === 'unlimited') return true;
    return membership.weekly_usage_count < 2;
  })();

  function handleBookPress(session: ClassSessionWithDetails) {
    if (session.user_booking) return;

    if (isBlockedFromBooking) {
      Alert.alert(
        'Booking Blocked',
        'You are blocked from booking classes for the rest of this month due to 3 or more late cancellations. Contact an admin if you believe this is an error.',
      );
      return;
    }

    const spotsLeft = session.effective_capacity - session.confirmed_count;
    const isFull = spotsLeft <= 0;

    if (isFull) {
      // Join waitlist directly
      joinWaitlist.mutate(session.id);
      return;
    }

    if (canUseMembership) {
      // Auto-book with membership — no payment needed
      bookSession.mutate({ session, paymentMethod: 'membership' });
      return;
    }

    // Show payment options (card / Apple Pay / cash)
    setSelectedSession(session);
  }

  function handlePaymentSelect(method: PaymentMethod) {
    if (!selectedSession) return;
    setSelectedSession(null);
    bookSession.mutate({ session: selectedSession, paymentMethod: method });
  }

  function handleCancel(session: ClassSessionWithDetails) {
    if (!session.user_booking) return;

    const sessionStart = new Date(`${session.session_date}T${session.start_time}Z`);
    const hoursUntil = (sessionStart.getTime() - Date.now()) / (1000 * 60 * 60);
    const noRefund = hoursUntil <= 3;

    if (session.user_booking.status === 'waitlisted') {
      Alert.alert('Leave Waitlist', 'Remove yourself from the waitlist?', [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => cancelBooking.mutate(session.user_booking!.id) },
      ]);
      return;
    }

    const lateWarning = noRefund
      ? lateCancelCount >= 2
        ? 'Cancelling within 3 hours — no refund. This will be your 3rd late cancellation this month and you will be blocked from booking classes for the rest of the month.'
        : `Cancelling within 3 hours — no refund. This is late cancellation ${lateCancelCount + 1} of 3 this month.`
      : 'Are you sure? You will be refunded.';

    Alert.alert(
      'Cancel Booking',
      lateWarning,
      [
        { text: 'Keep Booking', style: 'cancel' },
        {
          text: noRefund ? 'Cancel (No Refund)' : 'Cancel & Refund',
          style: 'destructive',
          onPress: () => cancelBooking.mutate(session.user_booking!.id, {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: ['late_cancellation_block'] });
            },
          }),
        },
      ],
    );
  }

  const isMutating = bookSession.isPending || cancelBooking.isPending || joinWaitlist.isPending;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Upcoming Classes" />

      <FlatList
        data={sessions ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isFetching}
            onRefresh={refetch}
            tintColor={COLORS.accent}
            colors={[COLORS.accent]}
          />
        }
        renderItem={({ item }) =>
          isAdmin ? (
            <AdminSessionCard session={item} />
          ) : (
            <SessionCard
              session={item}
              onBook={() => handleBookPress(item)}
              onCancel={() => handleCancel(item)}
              isMutating={isMutating}
              freeWithMembership={canUseMembership}
              isBlockedFromBooking={isBlockedFromBooking}
            />
          )
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No upcoming classes this week.</Text>
            </View>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      {/* Payment method modal (only when no membership) */}
      {!isAdmin && (
        <SlideUpModal visible={!!selectedSession} onDismiss={() => setSelectedSession(null)}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{selectedSession?.class_templates?.name}</Text>
            <Text style={styles.modalMeta}>
              {selectedSession?.start_time?.slice(0, 5)}–{selectedSession?.end_time?.slice(0, 5)}
            </Text>
            <View style={styles.modalBody}>
              <PaymentMethodSelector
                price={selectedSession?.effective_price ?? 1500}
                membership={null}
                onSelect={handlePaymentSelect}
                isLoading={isMutating}
              />
            </View>
          </View>
        </SlideUpModal>
      )}
    </View>
  );
}

// ─── Admin session card ──────────────────────────────────────────────────────

function AdminSessionCard({ session }: { session: ClassSessionWithDetails }) {
  const queryClient = useQueryClient();
  const [showTimeEditor, setShowTimeEditor] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showCancelInput, setShowCancelInput] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [editStart, setEditStart] = useState(session.start_time.slice(0, 5));
  const [editEnd, setEditEnd] = useState(session.end_time.slice(0, 5));
  const { data: defaultLeaderName } = useDefaultClassLeaderName();
  const teacherName = getClassLeaderName(session, defaultLeaderName);

  const dateStr = new Date(session.session_date + 'T00:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  const spotsLeft = session.effective_capacity - session.confirmed_count;
  const isFull = spotsLeft <= 0;

  const { data: rosterBookings, isLoading: rosterLoading } = useQuery<BookingWithStudent[]>({
    queryKey: ['roster', session.id],
    enabled: showRoster,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('*, profiles(id, full_name)')
        .eq('session_id', session.id)
        .eq('status', 'confirmed')
        .order('booked_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as BookingWithStudent[];
    },
  });

  const confirmCashMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase
        .from('bookings')
        .update({ payment_status: 'paid' })
        .eq('id', bookingId)
        .eq('payment_method', 'cash');
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['roster', session.id] }),
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const updateTime = useMutation({
    mutationFn: async () => {
      if (!editStart.match(/^\d{2}:\d{2}$/) || !editEnd.match(/^\d{2}:\d{2}$/)) {
        throw new Error('Times must be HH:MM format.');
      }
      const { error } = await supabase
        .from('class_sessions')
        .update({ start_time: editStart, end_time: editEnd })
        .eq('id', session.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['class_sessions'] });
      setShowTimeEditor(false);
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const cancelSession = useMutation({
    mutationFn: async (reason: string) => {
      const { data, error } = await invokeFunction<{
        cancelled?: boolean; refundCount?: number; membershipSlotsReleased?: number;
      }>('cancel-class-session', { sessionId: session.id, reason });
      if (error) throw new Error(error.message ?? 'Failed to cancel session.');
      return data!;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['class_sessions'] });
      const refunds = data?.refundCount ?? 0;
      const slots = data?.membershipSlotsReleased ?? 0;
      if (refunds || slots) {
        Alert.alert(
          'Session cancelled',
          [
            refunds && `${refunds} student${refunds === 1 ? '' : 's'} refunded`,
            slots && `${slots} membership slot${slots === 1 ? '' : 's'} returned`,
          ].filter(Boolean).join(' · '),
        );
      }
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  function handleCancelSession() {
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Cancel Session',
        'Enter a reason (shown to students):',
        [
          { text: 'Back', style: 'cancel' },
          {
            text: 'Cancel Session',
            style: 'destructive',
            onPress: (reason?: string) => cancelSession.mutate(reason ?? 'Session cancelled'),
          },
        ],
        'plain-text',
        '',
      );
    } else {
      setCancelReason('');
      setShowCancelInput(true);
    }
  }

  function confirmCancelSession() {
    cancelSession.mutate(cancelReason.trim() || 'Session cancelled');
    setShowCancelInput(false);
  }

  return (
    <Card style={styles.adminCard}>
      <View style={styles.adminHeader}>
        <View style={styles.adminInfo}>
          <Text style={styles.adminClassName}>{session.class_templates?.name}</Text>
          <Text style={styles.adminMeta}>
            {dateStr} · {session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)}
          </Text>
          <Text style={styles.adminTeacher}>{teacherName}</Text>
        </View>
        <View style={styles.adminStats}>
          <Text style={[styles.adminCount, isFull && styles.adminCountFull]}>
            {session.confirmed_count}/{session.effective_capacity}
          </Text>
          <Text style={styles.adminStatsLabel}>confirmed</Text>
          {session.waitlist_count > 0 && (
            <Text style={styles.adminWaitlist}>+{session.waitlist_count} waiting</Text>
          )}
        </View>
      </View>

      <View style={styles.adminActions}>
        <Button variant="secondary" size="sm" onPress={() => setShowRoster(true)}>
          Roster
        </Button>
        <Button variant="secondary" size="sm" onPress={() => setShowTimeEditor(true)}>
          Edit Time
        </Button>
        <Button
          variant="danger"
          size="sm"
          onPress={handleCancelSession}
          loading={cancelSession.isPending}
        >
          Cancel
        </Button>
      </View>

      {/* Roster modal */}
      <Modal visible={showRoster} animationType="slide" onRequestClose={() => setShowRoster(false)}>
        <View style={styles.rosterModal}>
          <View style={styles.rosterHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rosterTitle}>{session.class_templates?.name}</Text>
              <Text style={styles.rosterMeta}>
                {dateStr} · {session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)}
              </Text>
              <Text style={styles.rosterCount}>{rosterBookings?.length ?? 0} booked</Text>
            </View>
            <TouchableOpacity onPress={() => setShowRoster(false)}>
              <Text style={styles.rosterClose}>Done</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={[...(rosterBookings ?? [])].sort((a, b) => {
              const aPending = a.payment_method === 'cash' && a.payment_status === 'pending' ? 0 : 1;
              const bPending = b.payment_method === 'cash' && b.payment_status === 'pending' ? 0 : 1;
              return aPending - bPending;
            })}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => (
              <Card style={styles.rosterCard}>
                <View style={styles.rosterRow}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text style={styles.rosterName}>{item.profiles?.full_name}</Text>
                    <PaymentStatusBadge status={item.payment_status} method={item.payment_method} />
                  </View>
                  {item.payment_method === 'cash' && item.payment_status === 'pending' && (
                    <Button
                      variant="primary"
                      size="sm"
                      onPress={() =>
                        Alert.alert(
                          'Confirm Cash Payment',
                          `Mark ${item.profiles?.full_name} as paid in cash?`,
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Confirm', onPress: () => confirmCashMutation.mutate(item.id) },
                          ],
                        )
                      }
                      loading={confirmCashMutation.isPending}
                    >
                      Confirm Cash
                    </Button>
                  )}
                </View>
              </Card>
            )}
            ListEmptyComponent={
              rosterLoading ? null : (
                <Text style={styles.rosterEmpty}>No bookings yet for this class.</Text>
              )
            }
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          />
        </View>
      </Modal>

      {/* Time editor modal */}
      <SlideUpModal visible={showTimeEditor} onDismiss={() => setShowTimeEditor(false)}>
        <View style={styles.timeSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.timeSheetTitle}>Edit Time</Text>
          <Text style={styles.timeSheetSubtitle}>{session.class_templates?.name} — {dateStr}</Text>
          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Text style={styles.timeLabel}>Start</Text>
              <TextInput
                style={styles.timeInput}
                value={editStart}
                onChangeText={setEditStart}
                placeholder="09:00"
                placeholderTextColor={COLORS.grey[600]}
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <View style={styles.timeField}>
              <Text style={styles.timeLabel}>End</Text>
              <TextInput
                style={styles.timeInput}
                value={editEnd}
                onChangeText={setEditEnd}
                placeholder="10:00"
                placeholderTextColor={COLORS.grey[600]}
                keyboardType="numbers-and-punctuation"
              />
            </View>
          </View>
          <Button
            variant="primary"
            size="md"
            onPress={() => updateTime.mutate()}
            loading={updateTime.isPending}
          >
            Save
          </Button>
        </View>
      </SlideUpModal>

      {/* Cancel session reason modal */}
      <SlideUpModal visible={showCancelInput} onDismiss={() => setShowCancelInput(false)}>
        <View style={styles.timeSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.timeSheetTitle}>Cancel Session</Text>
          <Text style={styles.timeSheetSubtitle}>Enter a reason (shown to students):</Text>
          <TextInput
            style={styles.timeInput}
            value={cancelReason}
            onChangeText={setCancelReason}
            placeholder="Session cancelled"
            placeholderTextColor={COLORS.grey[600]}
            autoFocus
          />
          <View style={[styles.adminActions, { marginTop: 16 }]}>
            <Button variant="secondary" size="md" onPress={() => setShowCancelInput(false)}>
              Back
            </Button>
            <Button
              variant="danger"
              size="md"
              onPress={confirmCancelSession}
              loading={cancelSession.isPending}
            >
              Cancel Session
            </Button>
          </View>
        </View>
      </SlideUpModal>
    </Card>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  list: { padding: 16, paddingTop: 12 },
  separator: { height: 12 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: COLORS.grey[600], fontSize: 15 },

  adminCard: { padding: 14, gap: 12 },
  adminHeader: { flexDirection: 'row', gap: 8 },
  adminInfo: { flex: 1, gap: 3 },
  adminClassName: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  adminMeta: { color: COLORS.grey[400], fontSize: 13 },
  adminTeacher: { color: COLORS.grey[400], fontSize: 13 },
  adminStats: { alignItems: 'flex-end' },
  adminCount: { color: COLORS.white, fontSize: 22, fontWeight: '800' },
  adminCountFull: { color: COLORS.accent },
  adminStatsLabel: { color: COLORS.grey[400], fontSize: 11 },
  adminWaitlist: { color: COLORS.grey[400], fontSize: 12, marginTop: 2 },
  adminActions: { flexDirection: 'row', gap: 8 },

  modalSheet: {
    backgroundColor: COLORS.grey[900],
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderColor: COLORS.grey[800],
    paddingBottom: 40, paddingHorizontal: 20, paddingTop: 12,
  },
  modalHandle: {
    width: 36, height: 4, backgroundColor: COLORS.grey[700],
    borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  modalTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  modalMeta: { color: COLORS.grey[400], fontSize: 14, marginBottom: 20 },
  modalBody: { gap: 8 },

  rosterModal: { flex: 1, backgroundColor: COLORS.black },
  rosterHeader: { flexDirection: 'row', alignItems: 'flex-start', padding: 16, paddingTop: 60, borderBottomWidth: 1, borderBottomColor: COLORS.grey[800] },
  rosterTitle: { color: COLORS.white, fontSize: 20, fontWeight: '800', marginBottom: 4 },
  rosterMeta: { color: COLORS.grey[400], fontSize: 14, marginBottom: 4 },
  rosterCount: { color: COLORS.grey[600], fontSize: 13 },
  rosterClose: { color: COLORS.accent, fontSize: 16, fontWeight: '600' },
  rosterCard: { padding: 12 },
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rosterName: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  rosterEmpty: { color: COLORS.grey[600], textAlign: 'center', paddingTop: 40, fontSize: 15 },

  timeSheet: {
    backgroundColor: COLORS.grey[900],
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderColor: COLORS.grey[800],
    paddingBottom: 40, paddingHorizontal: 20, paddingTop: 12,
  },
  timeSheetTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  timeSheetSubtitle: { color: COLORS.grey[400], fontSize: 13, marginBottom: 20 },
  timeRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  timeField: { flex: 1 },
  timeLabel: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  timeInput: { backgroundColor: COLORS.grey[800], borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.white, fontSize: 16, fontWeight: '600', borderWidth: 1, borderColor: COLORS.grey[700], textAlign: 'center' },
});
