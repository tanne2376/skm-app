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
import { supabase } from '@/lib/supabase';
import { formatGBP } from '@/lib/stripe';
import { OneToOneWithDetails } from '@/types';
import { useState } from 'react';

type Tab = 'available' | 'my-sessions';

export default function OneToOnesScreen() {
  const insets = useSafeAreaInsets();
  const { role, session } = useAuth();
  const queryClient = useQueryClient();
  const canCreate = role === 'teacher' || role === 'admin';
  const userId = session?.user.id;

  const [activeTab, setActiveTab] = useState<Tab>('available');

  // Available: sessions from others that are still available (RLS already filters out own)
  const { data: available, isLoading: loadingAvailable, refetch: refetchAvailable } = useQuery<OneToOneWithDetails[]>({
    queryKey: ['one_to_ones', 'available', userId],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('one_to_ones')
        .select(`*, teacher:profiles!teacher_id(id, full_name), location:locations(id, name, address)`)
        .eq('status', 'available')
        .neq('creator_id', userId!)
        .gte('session_date', new Date().toISOString().split('T')[0])
        .order('session_date', { ascending: true })
        .order('start_time', { ascending: true });
      if (error) throw error;
      return (data ?? []) as OneToOneWithDetails[];
    },
  });

  // My Sessions: sessions I created (any status) + sessions I booked as student
  const { data: mySessions, isLoading: loadingMy, refetch: refetchMy } = useQuery<OneToOneWithDetails[]>({
    queryKey: ['one_to_ones', 'mine', userId],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('one_to_ones')
        .select(`*, teacher:profiles!teacher_id(id, full_name), student:profiles!student_id(id, full_name), location:locations(id, name, address)`)
        .or(`creator_id.eq.${userId},teacher_id.eq.${userId},student_id.eq.${userId}`)
        .order('session_date', { ascending: true })
        .order('start_time', { ascending: true });
      if (error) throw error;
      return (data ?? []) as OneToOneWithDetails[];
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

  const isLoading = activeTab === 'available' ? loadingAvailable : loadingMy;
  const items = activeTab === 'available' ? available : mySessions;
  const refetch = activeTab === 'available' ? refetchAvailable : refetchMy;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'available', label: 'Available' },
    { key: 'my-sessions', label: 'My Sessions' },
  ];

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="1-to-1 Sessions" />

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

      <FlatList
        data={items ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={COLORS.accent} colors={[COLORS.accent]} />}
        ListHeaderComponent={
          canCreate && activeTab === 'my-sessions' ? (
            <Button
              variant="secondary"
              size="md"
              onPress={() => router.push('/(app)/one-to-ones/create')}
              style={styles.newButton}
            >
              + New Session
            </Button>
          ) : null
        }
        renderItem={({ item }) => {
          const isCreator = item.creator_id === userId || item.teacher_id === userId;
          const isStudentBooking = item.student_id === userId && !isCreator;
          const showCashConfirm = isCreator && item.status === 'booked' && item.payment_method === 'cash' && item.payment_status === 'pending';

          return (
            <OneToOneCard
              oto={item}
              onPress={() => router.push(`/(app)/one-to-ones/${item.id}`)}
              isMySessionsTab={activeTab === 'my-sessions'}
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

  let badgeLabel: string;
  let badgeVariant: 'success' | 'info' | 'warning' | 'neutral';
  if (isCashPending) {
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
});
