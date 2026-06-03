import { View, Text, FlatList, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PaymentStatusBadge } from '@/components/ui/Badge';
import { supabase } from '@/lib/supabase';
import { formatGBP } from '@/lib/stripe';

interface RosterRow {
  booking_id: string;
  student_id: string;
  student_name: string;
  booked_at: string;
  payment_method: string;
  payment_status: 'pending' | 'paid' | 'refunded' | 'no_refund';
  membership_id: string | null;
  membership_tier: string | null;
  membership_payment_method: string | null;
  membership_payment_status: string | null;
  follow_up_amount_pence: number | null;
  cash_pending: boolean;
}

export default function MyClassRosterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: sessionData, isLoading: loadingSession } = useQuery({
    queryKey: ['class_session', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_sessions')
        .select('*, class_templates(name)')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: bookings, isLoading: loadingBookings, refetch } = useQuery<RosterRow[]>({
    queryKey: ['roster', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_class_roster', { p_session_id: id });
      if (error) throw error;
      return (data ?? []) as RosterRow[];
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roster', id] });
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const isLoading = loadingSession || loadingBookings;

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  const session = sessionData as any;
  const dateStr = session
    ? new Date(session.session_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    : '';

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="Class Roster" showBack />

      <View style={styles.header}>
        <Text style={styles.className}>{session?.class_templates?.name}</Text>
        <Text style={styles.classTime}>
          {dateStr} · {session?.start_time?.slice(0, 5)}–{session?.end_time?.slice(0, 5)}
        </Text>
        <Text style={styles.bookingCount}>{bookings?.length ?? 0} booked</Text>
      </View>

      <FlatList
        data={[...(bookings ?? [])].sort((a, b) => {
          const aPending = a.cash_pending ? 0 : 1;
          const bPending = b.cash_pending ? 0 : 1;
          return aPending - bPending;
        })}
        keyExtractor={(item) => item.booking_id}
        contentContainerStyle={styles.list}
        onRefresh={refetch}
        refreshing={loadingBookings}
        renderItem={({ item }) => {
          const isMembershipCashPending =
            item.payment_method === 'membership'
            && item.membership_payment_method === 'cash'
            && item.membership_payment_status === 'pending';
          const isBookingCashPending =
            item.payment_method === 'cash' && item.payment_status === 'pending';

          return (
            <Card style={styles.studentCard}>
              <View style={styles.studentRow}>
                <View style={styles.flex}>
                  <Text style={styles.studentName}>{item.student_name}</Text>
                  <View style={styles.badgeRow}>
                    <PaymentStatusBadge
                      status={item.payment_status}
                      method={item.payment_method}
                      membershipCashPending={isMembershipCashPending}
                    />
                    {item.cash_pending && item.follow_up_amount_pence !== null && (
                      <Text style={styles.followUpAmount}>{formatGBP(item.follow_up_amount_pence)}</Text>
                    )}
                  </View>
                  {isMembershipCashPending && (
                    <Text style={styles.followUpHint}>
                      Collect via Manage → Users (covers the whole month, not just this class).
                    </Text>
                  )}
                </View>
                {isBookingCashPending && (
                  <Button
                    variant="primary"
                    size="sm"
                    onPress={() =>
                      Alert.alert(
                        'Confirm Cash Payment',
                        `Mark ${item.student_name} as paid in cash?`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Confirm', onPress: () => confirmCashMutation.mutate(item.booking_id) },
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
          );
        }}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No bookings yet for this class.</Text>
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.black },
  header: { padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.grey[800] },
  className: { color: COLORS.white, fontSize: 20, fontWeight: '800', marginBottom: 4 },
  classTime: { color: COLORS.grey[400], fontSize: 14, marginBottom: 4 },
  bookingCount: { color: COLORS.grey[600], fontSize: 13 },
  list: { padding: 16 },
  studentCard: { padding: 12 },
  studentRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, gap: 6 },
  studentName: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  followUpAmount: { color: COLORS.warning, fontSize: 13, fontWeight: '700' },
  followUpHint: { color: COLORS.grey[600], fontSize: 11, lineHeight: 15 },
  emptyText: { color: COLORS.grey[600], textAlign: 'center', paddingTop: 40, fontSize: 15 },
});
