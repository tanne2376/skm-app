import { useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { formatGBP } from '@/lib/stripe';
import { OneToOneWithDetails } from '@/types';

type Tab = 'available' | 'my-sessions';

export default function OneToOnesScreen() {
  const insets = useSafeAreaInsets();
  const { role, session } = useAuth();
  const isTeacher = role === 'teacher' || role === 'admin';
  const [activeTab, setActiveTab] = useState<Tab>('available');

  const { data: available, isLoading: loadingAvailable, refetch: refetchAvailable } = useQuery<OneToOneWithDetails[]>({
    queryKey: ['one_to_ones', 'available'],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('one_to_ones')
        .select(`*, teacher:profiles!teacher_id(id, full_name), location:locations(id, name, address)`)
        .eq('status', 'available')
        .gte('session_date', new Date().toISOString().split('T')[0])
        .order('session_date', { ascending: true })
        .order('start_time', { ascending: true });
      if (error) throw error;
      return (data ?? []) as OneToOneWithDetails[];
    },
  });

  const { data: mySessions, isLoading: loadingMy, refetch: refetchMy } = useQuery<OneToOneWithDetails[]>({
    queryKey: ['one_to_ones', 'mine', session?.user.id],
    enabled: !!session && isTeacher,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('one_to_ones')
        .select(`*, teacher:profiles!teacher_id(id, full_name), student:profiles!student_id(id, full_name), location:locations(id, name, address)`)
        .or(`teacher_id.eq.${session!.user.id},creator_id.eq.${session!.user.id}`)
        .order('session_date', { ascending: false });
      if (error) throw error;
      return (data ?? []) as OneToOneWithDetails[];
    },
  });

  const isLoading = activeTab === 'available' ? loadingAvailable : loadingMy;
  const items = activeTab === 'available' ? available : mySessions;
  const refetch = activeTab === 'available' ? refetchAvailable : refetchMy;

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader
        title="1-to-1 Sessions"
        rightElement={
          isTeacher ? (
            <Button variant="ghost" size="sm" onPress={() => router.push('/(app)/one-to-ones/create')}>
              + New
            </Button>
          ) : undefined
        }
      />

      {isTeacher && (
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'available' && styles.tabActive]}
            onPress={() => setActiveTab('available')}
          >
            <Text style={[styles.tabText, activeTab === 'available' && styles.tabTextActive]}>Available</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'my-sessions' && styles.tabActive]}
            onPress={() => setActiveTab('my-sessions')}
          >
            <Text style={[styles.tabText, activeTab === 'my-sessions' && styles.tabTextActive]}>My Sessions</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={items ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={COLORS.accent} colors={[COLORS.accent]} />}
        renderItem={({ item }) => (
          <OneToOneCard oto={item} onPress={() => router.push(`/(app)/one-to-ones/${item.id}`)} showStudent={activeTab === 'my-sessions'} />
        )}
        ListEmptyComponent={
          !isLoading ? <Text style={styles.emptyText}>No sessions found.</Text> : null
        }
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      />
    </View>
  );
}

function OneToOneCard({ oto, onPress, showStudent }: { oto: OneToOneWithDetails; onPress: () => void; showStudent: boolean }) {
  const locationStr = oto.location?.name ?? oto.location_text ?? 'Location TBA';
  const dateStr = new Date(oto.session_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <Card>
        <View style={styles.otoRow}>
          <View style={styles.flex}>
            <Text style={styles.otoTitle}>{oto.title}</Text>
            <Text style={styles.otoMeta}>with {oto.teacher?.full_name}</Text>
            <Text style={styles.otoMeta}>{dateStr} · {oto.start_time.slice(0, 5)}–{oto.end_time.slice(0, 5)}</Text>
            <Text style={styles.otoMeta}>{locationStr}</Text>
            {showStudent && oto.student && (
              <Text style={styles.otoStudent}>Student: {oto.student.full_name}</Text>
            )}
          </View>
          <View style={styles.otoRight}>
            <Text style={styles.otoPrice}>{formatGBP(oto.price)}</Text>
            <Badge
              label={oto.status.charAt(0).toUpperCase() + oto.status.slice(1)}
              variant={oto.status === 'available' ? 'success' : oto.status === 'booked' ? 'info' : 'neutral'}
            />
          </View>
        </View>
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
  emptyText: { color: COLORS.grey[600], textAlign: 'center', paddingTop: 60, fontSize: 15 },
  otoRow: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1, gap: 3 },
  otoTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  otoMeta: { color: COLORS.grey[400], fontSize: 13 },
  otoStudent: { color: COLORS.accent, fontSize: 13, fontWeight: '600', marginTop: 4 },
  otoRight: { alignItems: 'flex-end', gap: 6 },
  otoPrice: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
});
