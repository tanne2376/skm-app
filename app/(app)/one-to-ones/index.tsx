import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { useActiveBlock } from '@/hooks/useActiveBlock';
import { supabase } from '@/lib/supabase';
import { formatGBP } from '@/lib/stripe';
import { OneToOneWithDetails } from '@/types';
import { useState } from 'react';

type Tab = 'available' | 'my-sessions';

export default function OneToOnesScreen() {
  const insets = useSafeAreaInsets();
  const { role, session } = useAuth();
  const { data: block } = useActiveBlock();
  const queryClient = useQueryClient();
  const canCreate = role === 'teacher' || role === 'admin';
  const isAdmin = role === 'admin';
  const userId = session?.user.id;

  const [activeTab, setActiveTab] = useState<Tab>('available');
  const effectiveTab: Tab = isAdmin ? 'my-sessions' : activeTab;

  // Available: sessions from others that are still available (RLS already filters out own).
  // Runs for guests too — they can browse but tapping Book routes to login.
  const { data: available, isLoading: loadingAvailable, refetch: refetchAvailable } = useQuery<OneToOneWithDetails[]>({
    queryKey: ['one_to_ones', 'available', userId ?? 'guest'],
    enabled: !isAdmin,
    queryFn: async () => {
      let query = supabase
        .from('one_to_ones')
        .select(`*, teacher:profiles!teacher_id(id, full_name), location:locations(id, name, address), block:blocks!block_id(id, payment_status, payment_method)`)
        .eq('status', 'available')
        .gte('session_date', new Date().toISOString().split('T')[0])
        .order('session_date', { ascending: true })
        .order('start_time', { ascending: true });
      // Signed-in users hide their own creations; guests see everything.
      if (userId) query = query.neq('creator_id', userId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as OneToOneWithDetails[];
    },
  });

  // My Sessions: future sessions I created/teach/booked, plus any with pending cash payment
  const { data: mySessions, isLoading: loadingMy, refetch: refetchMy } = useQuery<OneToOneWithDetails[]>({
    queryKey: ['one_to_ones', 'mine', userId],
    enabled: !!session,
    queryFn: async () => {
      const now = new Date();
      const today = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-');
      const { data, error } = await supabase
        .from('one_to_ones')
        .select(`*, teacher:profiles!teacher_id(id, full_name), student:profiles!student_id(id, full_name), location:locations(id, name, address), block:blocks!block_id(id, payment_status, payment_method)`)
        .or(`creator_id.eq.${userId},teacher_id.eq.${userId},student_id.eq.${userId}`)
        .or(`session_date.gte.${today},and(payment_method.eq.cash,payment_status.eq.pending)`)
        .order('session_date', { ascending: true })
        .order('start_time', { ascending: true });
      if (error) throw error;
      return (data ?? []).filter((oto: OneToOneWithDetails) => {
        const sessionEnd = new Date(`${oto.session_date}T${oto.end_time}`);
        const isPast = sessionEnd < now;
        const isCashPending = oto.payment_method === 'cash' && oto.payment_status === 'pending';
        return !isPast || isCashPending;
      }) as OneToOneWithDetails[];
    },
  });

  const confirmCashMutation = useMutation({
    mutationFn: async (otoId: string) => {
      const { error } = await supabase
        .from('one_to_ones')
        .update({ payment_status: 'paid' })
        .eq('id', otoId)
        .eq('payment_method', 'cash');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['one_to_ones'] });
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const isLoading = effectiveTab === 'available' ? loadingAvailable : loadingMy;
  const items = effectiveTab === 'available' ? available : mySessions;
  const refetch = effectiveTab === 'available' ? refetchAvailable : refetchMy;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'available', label: 'Available' },
    { key: 'my-sessions', label: 'My Sessions' },
  ];

  const isGuest = !session;
  const showGuestMySessions = isGuest && effectiveTab === 'my-sessions';

  return (
    <View style={styles.container}>
      <ScreenHeader title="1-to-1 Sessions" />

      {!isAdmin && (
        <View style={styles.tabs}>
          {tabs.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, activeTab === t.key && styles.tabActive]}
              onPress={() => setActiveTab(t.key)}
            >
              <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {showGuestMySessions ? (
        <View style={styles.guestCardWrap}>
          <Card>
            <Text style={styles.guestTitle}>Log in to see your sessions</Text>
            <Text style={styles.guestBody}>
              Sign in to view 1-to-1 sessions you've booked or created.
            </Text>
            <Button
              variant="primary"
              size="md"
              onPress={() => router.push('/(auth)/login')}
            >
              Sign In
            </Button>
          </Card>
        </View>
      ) : (
      <FlatList
        data={items ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={COLORS.accent} colors={[COLORS.accent]} />}
        ListHeaderComponent={
          <View>
            {block?.is_usable && effectiveTab === 'available' && (
              <View style={styles.blockBanner}>
                <Text style={styles.blockBannerTitle}>
                  Block: {block.sessions_remaining} session{block.sessions_remaining === 1 ? '' : 's'} remaining
                </Text>
                <Text style={styles.blockBannerSub}>
                  {block.expires_at
                    ? `Expires ${new Date(block.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                    : 'Never expires'}
                </Text>
              </View>
            )}
            {canCreate && effectiveTab === 'my-sessions' && (
              <Button
                variant="secondary"
                size="md"
                onPress={() => router.push('/(app)/one-to-ones/create')}
                style={styles.newButton}
              >
                + New Session
              </Button>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const isCreator = item.creator_id === userId || item.teacher_id === userId;
          const isStudentBooking = item.student_id === userId && !isCreator;
          // Block-paid bookings are not cash-confirmed per-1-to-1 — confirmation
          // happens at the block level via Manage → Users.
          const showCashConfirm =
            isCreator
            && item.status === 'booked'
            && item.payment_method === 'cash'
            && item.payment_status === 'pending';

          return (
            <OneToOneCard
              oto={item}
              onPress={() => router.push(`/(app)/one-to-ones/${item.id}`)}
              isMySessionsTab={effectiveTab === 'my-sessions'}
              isCreator={isCreator}
              isStudentBooking={isStudentBooking}
              showCashConfirm={showCashConfirm}
              onConfirmCash={() => {
                Alert.alert(
                  'Confirm Cash Payment',
                  `Mark ${item.student?.full_name} as paid in cash?`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Confirm', onPress: () => confirmCashMutation.mutate(item.id) },
                  ],
                );
              }}
              confirmCashLoading={confirmCashMutation.isPending}
            />
          );
        }}
        ListEmptyComponent={
          !isLoading ? <Text style={styles.emptyText}>No sessions found.</Text> : null
        }
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      />
      )}
    </View>
  );
}

function OneToOneCard({
  oto,
  onPress,
  isMySessionsTab,
  isCreator,
  isStudentBooking,
  showCashConfirm,
  onConfirmCash,
  confirmCashLoading,
}: {
  oto: OneToOneWithDetails;
  onPress: () => void;
  isMySessionsTab: boolean;
  isCreator: boolean;
  isStudentBooking: boolean;
  showCashConfirm: boolean;
  onConfirmCash: () => void;
  confirmCashLoading: boolean;
}) {
  const locationStr = oto.location?.name ?? oto.location_text ?? 'Location TBA';
  const dateStr = new Date(oto.session_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  const isCashPending = oto.status === 'booked' && oto.payment_method === 'cash' && oto.payment_status === 'pending';
  const isBlockPaid = oto.status === 'booked' && oto.payment_method === 'block';
  const isBlockCashPending = isBlockPaid && oto.block?.payment_status === 'pending';

  let badgeLabel: string;
  let badgeVariant: 'success' | 'info' | 'warning' | 'neutral';
  if (isBlockCashPending) {
    badgeLabel = 'Cash Pending (Block)';
    badgeVariant = 'warning';
  } else if (isBlockPaid) {
    badgeLabel = 'Paid with Block';
    badgeVariant = 'success';
  } else if (isCashPending) {
    badgeLabel = 'Cash Pending';
    badgeVariant = 'warning';
  } else if (oto.status === 'available') {
    badgeLabel = 'Available';
    badgeVariant = 'success';
  } else if (oto.status === 'booked') {
    badgeLabel = 'Booked';
    badgeVariant = 'info';
  } else {
    badgeLabel = oto.status.charAt(0).toUpperCase() + oto.status.slice(1);
    badgeVariant = 'neutral';
  }

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <Card>
        {/* "Your upcoming session" indicator for students who booked */}
        {isStudentBooking && oto.status === 'booked' && (
          <View style={styles.upcomingBanner}>
            <Text style={styles.upcomingText}>Your upcoming session</Text>
          </View>
        )}
        <View style={styles.otoRow}>
          <View style={styles.flex}>
            <Text style={styles.otoTitle}>{oto.title}</Text>
            <Text style={styles.otoMeta}>with {oto.teacher?.full_name}</Text>
            <Text style={styles.otoMeta}>{dateStr} · {oto.start_time.slice(0, 5)}–{oto.end_time.slice(0, 5)}</Text>
            <Text style={styles.otoMeta}>{locationStr}</Text>
            {/* Show who booked for the creator */}
            {isMySessionsTab && isCreator && oto.status === 'booked' && oto.student && (
              <Text style={styles.otoStudent}>Student: {oto.student.full_name}</Text>
            )}
          </View>
          <View style={styles.otoRight}>
            <Text style={styles.otoPrice}>{formatGBP(oto.price)}</Text>
            <Badge label={badgeLabel} variant={badgeVariant} />
          </View>
        </View>
        {/* Inline confirm cash button on the card */}
        {showCashConfirm && (
          <View style={styles.cashConfirmRow}>
            <Button
              variant="primary"
              size="sm"
              onPress={() => onConfirmCash()}
              loading={confirmCashLoading}
            >
              Confirm Cash
            </Button>
          </View>
        )}
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.grey[800], marginBottom: 4 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.accent },
  tabText: { color: COLORS.grey[400], fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: COLORS.white },
  list: { padding: 16 },
  newButton: { marginBottom: 16 },
  emptyText: { color: COLORS.grey[600], textAlign: 'center', paddingTop: 60, fontSize: 15 },
  otoRow: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1, gap: 3 },
  otoTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  otoMeta: { color: COLORS.grey[400], fontSize: 13 },
  otoStudent: { color: COLORS.accent, fontSize: 13, fontWeight: '600', marginTop: 4 },
  otoRight: { alignItems: 'flex-end', gap: 6 },
  otoPrice: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  upcomingBanner: {
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  upcomingText: { color: COLORS.success, fontSize: 12, fontWeight: '700' },
  cashConfirmRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.grey[800],
    alignItems: 'flex-end',
  },
  blockBanner: {
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderColor: 'rgba(34,197,94,0.3)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  blockBannerTitle: { color: COLORS.success, fontSize: 14, fontWeight: '700' },
  blockBannerSub: { color: COLORS.grey[400], fontSize: 12, marginTop: 2 },
  guestCardWrap: { padding: 16 },
  guestTitle: { color: COLORS.white, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  guestBody: { color: COLORS.grey[400], fontSize: 14, lineHeight: 20, marginBottom: 16 },
});
