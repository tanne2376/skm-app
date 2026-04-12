import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { ClassSessionWithDetails } from '@/types';

export default function MyClassesScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const { data: sessions, isLoading, isFetching, refetch } = useQuery<ClassSessionWithDetails[]>({
    queryKey: ['my_classes', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('class_sessions')
        .select(`
          *,
          class_templates (*),
          bookings (id, student_id, status, payment_method, payment_status)
        `)
        .eq('teacher_id', session!.user.id)
        .gte('session_date', today)
        .lte('session_date', tomorrow)
        .order('session_date', { ascending: true })
        .order('start_time', { ascending: true });
      if (error) throw error;

      return (data ?? []).map((s: any) => ({
        ...s,
        confirmed_count: s.bookings?.filter((b: any) => b.status === 'confirmed').length ?? 0,
        waitlist_count: s.bookings?.filter((b: any) => b.status === 'waitlisted').length ?? 0,
        effective_capacity: s.capacity ?? s.class_templates?.capacity ?? 20,
        effective_price: s.price ?? s.class_templates?.price ?? 1500,
      })) as ClassSessionWithDetails[];
    },
  });

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="My Classes" />
      <FlatList
        data={sessions ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={COLORS.accent} colors={[COLORS.accent]} />}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => router.push(`/(app)/my-classes/${item.id}`)} activeOpacity={0.8}>
            <Card>
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Text style={styles.className}>{item.class_templates?.name}</Text>
                  <Text style={styles.meta}>
                    {new Date(item.session_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {' · '}{item.start_time.slice(0, 5)}–{item.end_time.slice(0, 5)}
                  </Text>
                </View>
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>{item.confirmed_count}/{item.effective_capacity}</Text>
                  <Text style={styles.countLabel}>booked</Text>
                </View>
              </View>
              {item.waitlist_count > 0 && (
                <Text style={styles.waitlistNote}>{item.waitlist_count} on waitlist</Text>
              )}
            </Card>
          </TouchableOpacity>
        )}
        ListEmptyComponent={!isLoading ? <Text style={styles.emptyText}>No upcoming classes assigned to you.</Text> : null}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  list: { padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  className: { color: COLORS.white, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  meta: { color: COLORS.grey[400], fontSize: 13 },
  countBadge: { alignItems: 'center', backgroundColor: COLORS.grey[800], borderRadius: 8, padding: 8, minWidth: 56 },
  countText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  countLabel: { color: COLORS.grey[400], fontSize: 11 },
  waitlistNote: { color: COLORS.warning, fontSize: 12, marginTop: 8 },
  emptyText: { color: COLORS.grey[600], textAlign: 'center', paddingTop: 60, fontSize: 15 },
});
