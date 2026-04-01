import { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
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
import { useRealtimeInvalidate } from '@/hooks/useRealtime';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { ClassSessionWithDetails, PaymentMethod, Profile } from '@/types';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const { data: sessions, isLoading, refetch } = useUpcomingSessions();
  const { data: membership } = useActiveMembership();
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

    const sessionStart = new Date(`${session.session_date}T${session.start_time}`);
    const hoursUntil = (sessionStart.getTime() - Date.now()) / (1000 * 60 * 60);
    const noRefund = hoursUntil <= 3;

    if (session.user_booking.status === 'waitlisted') {
      Alert.alert('Leave Waitlist', 'Remove yourself from the waitlist?', [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => cancelBooking.mutate(session.user_booking!.id) },
      ]);
      return;
    }

    Alert.alert(
      'Cancel Booking',
      noRefund
        ? 'Cancelling within 3 hours — you will not receive a refund.'
        : 'Are you sure? You will be refunded.',
      [
        { text: 'Keep Booking', style: 'cancel' },
        {
          text: noRefund ? 'Cancel (No Refund)' : 'Cancel & Refund',
          style: 'destructive',
          onPress: () => cancelBooking.mutate(session.user_booking!.id),
        },
      ],
    );
  }

  const isMutating = bookSession.isPending || cancelBooking.isPending || joinWaitlist.isPending;

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="Upcoming Classes" />

      <FlatList
        data={sessions ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
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
        <Modal
          visible={!!selectedSession}
          animationType="slide"
          transparent
          onRequestClose={() => setSelectedSession(null)}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={styles.modalDismiss} onPress={() => setSelectedSession(null)} />
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
          </View>
        </Modal>
      )}
    </View>
  );
}

// ─── Admin session card ──────────────────────────────────────────────────────

function AdminSessionCard({ session }: { session: ClassSessionWithDetails }) {
  const queryClient = useQueryClient();
  const [showTeacherPicker, setShowTeacherPicker] = useState(false);

  const dateStr = new Date(session.session_date + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  const spotsLeft = session.effective_capacity - session.confirmed_count;
  const isFull = spotsLeft <= 0;

  const { data: allProfiles } = useQuery<Pick<Profile, 'id' | 'full_name' | 'role'>[]>({
    queryKey: ['all_profiles'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name, role').order('full_name');
      return (data ?? []) as Pick<Profile, 'id' | 'full_name' | 'role'>[];
    },
  });

  const assignTeacher = useMutation({
    mutationFn: async ({ profileId, needsPromotion }: { profileId: string; needsPromotion: boolean }) => {
      if (needsPromotion) {
        const { error: promoteError } = await supabase.from('profiles').update({ role: 'teacher' }).eq('id', profileId);
        if (promoteError) throw promoteError;
      }
      const { error } = await supabase.from('class_sessions').update({ teacher_id: profileId }).eq('id', session.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['class_sessions'] });
      queryClient.invalidateQueries({ queryKey: ['all_profiles'] });
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const cancelSession = useMutation({
    mutationFn: async (reason: string) => {
      const { error } = await supabase
        .from('class_sessions')
        .update({ is_cancelled: true, cancellation_reason: reason })
        .eq('id', session.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['class_sessions'] }),
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  function handleCancelSession() {
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
  }

  function handleSelectTeacher(profile: Pick<Profile, 'id' | 'full_name' | 'role'>) {
    const isStudent = profile.role === 'student';
    if (isStudent) {
      Alert.alert(
        'Promote to Teacher',
        `${profile.full_name} is currently a student. Assigning them will promote their role to teacher.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Promote & Assign',
            onPress: () => {
              assignTeacher.mutate({ profileId: profile.id, needsPromotion: true });
              setShowTeacherPicker(false);
            },
          },
        ],
      );
    } else {
      assignTeacher.mutate({ profileId: profile.id, needsPromotion: false });
      setShowTeacherPicker(false);
    }
  }

  return (
    <Card style={styles.adminCard}>
      <View style={styles.adminHeader}>
        <View style={styles.adminInfo}>
          <Text style={styles.adminClassName}>{session.class_templates?.name}</Text>
          <Text style={styles.adminMeta}>
            {dateStr} · {session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)}
          </Text>
          <TouchableOpacity onPress={() => setShowTeacherPicker(true)}>
            <Text style={session.teacher ? styles.adminTeacher : styles.adminTeacherUnassigned}>
              {session.teacher ? session.teacher.full_name : 'Assign teacher...'}
            </Text>
          </TouchableOpacity>
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
        <Button
          variant="secondary"
          size="sm"
          onPress={() =>
            router.push({ pathname: '/(app)/my-classes/[id]', params: { id: session.id } })
          }
        >
          Roster
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onPress={() =>
            router.push({ pathname: '/(app)/timetable/edit-session', params: { sessionId: session.id } })
          }
        >
          Edit
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

      {/* Teacher picker modal */}
      <Modal visible={showTeacherPicker} animationType="slide" transparent onRequestClose={() => setShowTeacherPicker(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalDismiss} onPress={() => setShowTeacherPicker(false)} />
          <View style={styles.teacherSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.teacherSheetTitle}>Assign Teacher</Text>
            <Text style={styles.teacherSheetSubtitle}>Selecting a student will promote them to teacher</Text>
            <FlatList
              data={allProfiles ?? []}
              keyExtractor={(t) => t.id}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.teacherItem} onPress={() => handleSelectTeacher(item)}>
                  <Text style={styles.teacherItemName}>{item.full_name}</Text>
                  <Text style={[styles.teacherItemRole, item.role === 'student' && styles.teacherItemRoleStudent]}>
                    {item.role}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
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
  adminTeacher: { color: COLORS.grey[400], fontSize: 13, textDecorationLine: 'underline' },
  adminTeacherUnassigned: { color: COLORS.accent, fontSize: 13 },
  adminStats: { alignItems: 'flex-end' },
  adminCount: { color: COLORS.white, fontSize: 22, fontWeight: '800' },
  adminCountFull: { color: COLORS.accent },
  adminStatsLabel: { color: COLORS.grey[400], fontSize: 11 },
  adminWaitlist: { color: COLORS.grey[400], fontSize: 12, marginTop: 2 },
  adminActions: { flexDirection: 'row', gap: 8 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalDismiss: { flex: 1 },
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

  teacherSheet: {
    backgroundColor: COLORS.grey[900],
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderColor: COLORS.grey[800],
    paddingBottom: 40, paddingHorizontal: 20, paddingTop: 12,
    maxHeight: '60%',
  },
  teacherSheetTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  teacherSheetSubtitle: { color: COLORS.grey[400], fontSize: 13, marginBottom: 16 },
  teacherItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.grey[800] },
  teacherItemName: { color: COLORS.white, fontSize: 15 },
  teacherItemRole: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  teacherItemRoleStudent: { color: COLORS.warning },
});
