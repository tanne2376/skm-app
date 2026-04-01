import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, DAY_NAMES } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { supabase } from '@/lib/supabase';
import { ClassTemplate } from '@/types';

export default function ManageScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: templates, isLoading, refetch } = useQuery<ClassTemplate[]>({
    queryKey: ['class_templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('class_templates')
        .select('*')
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ClassTemplate[];
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('class_templates')
        .update({ is_active: !isActive })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['class_templates'] }),
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('generate-sessions', {});
      if (error) throw new Error(error.message);
    },
    onSuccess: () => Alert.alert('Done', 'Sessions generated for the next 4 weeks.'),
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const byDay = (templates ?? []).reduce<Record<number, ClassTemplate[]>>((acc, t) => {
    if (!acc[t.day_of_week]) acc[t.day_of_week] = [];
    acc[t.day_of_week].push(t);
    return acc;
  }, {});

  const days = Object.keys(byDay).map(Number).sort((a, b) => a - b);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader
        title="Manage"
        rightElement={
          <Button
            variant="ghost"
            size="sm"
            onPress={() => syncMutation.mutate()}
            loading={syncMutation.isPending}
          >
            Sync Sessions
          </Button>
        }
      />

      <FlatList
        data={days}
        keyExtractor={(d) => String(d)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor={COLORS.accent}
            colors={[COLORS.accent]}
          />
        }
        ListHeaderComponent={
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Timetable</Text>
            <Button
              variant="secondary"
              size="sm"
              onPress={() => router.push('/(app)/timetable/edit-session')}
            >
              Override Specific Session
            </Button>
          </View>
        }
        renderItem={({ item: day }) => (
          <View style={styles.daySection}>
            <Text style={styles.dayHeading}>{DAY_NAMES[day]}</Text>
            {byDay[day].map((template) => (
              <TouchableOpacity
                key={template.id}
                onPress={() =>
                  router.push({
                    pathname: '/(app)/timetable/edit-template',
                    params: { id: template.id },
                  })
                }
                activeOpacity={0.8}
              >
                <Card style={[styles.card, !template.is_active && styles.cardInactive]}>
                  <View style={styles.row}>
                    <View style={styles.flex}>
                      <Text style={styles.name}>{template.name}</Text>
                      <Text style={styles.meta}>
                        {template.start_time.slice(0, 5)}–{template.end_time.slice(0, 5)} · Cap {template.capacity}
                      </Text>
                    </View>
                    <View style={styles.actions}>
                      <Badge
                        label={template.is_active ? 'Active' : 'Paused'}
                        variant={template.is_active ? 'success' : 'neutral'}
                      />
                      <TouchableOpacity
                        style={styles.toggleBtn}
                        onPress={() =>
                          Alert.alert(
                            template.is_active ? 'Pause class?' : 'Resume class?',
                            template.is_active
                              ? 'This stops it appearing on the schedule.'
                              : 'This resumes it on the schedule.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Confirm',
                                onPress: () =>
                                  toggleMutation.mutate({ id: template.id, isActive: template.is_active }),
                              },
                            ],
                          )
                        }
                      >
                        <Text style={styles.toggleText}>
                          {template.is_active ? 'Pause' : 'Resume'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </Card>
              </TouchableOpacity>
            ))}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  list: { padding: 16, gap: 20 },
  section: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  sectionTitle: { color: COLORS.white, fontSize: 18, fontWeight: '800' },
  daySection: { gap: 10 },
  dayHeading: {
    color: COLORS.accent,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  card: { padding: 12 },
  cardInactive: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  name: { color: COLORS.white, fontSize: 15, fontWeight: '700', marginBottom: 3 },
  meta: { color: COLORS.grey[400], fontSize: 13 },
  actions: { alignItems: 'flex-end', gap: 8 },
  toggleBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.grey[700],
  },
  toggleText: { color: COLORS.grey[300], fontSize: 12, fontWeight: '600' },
});
