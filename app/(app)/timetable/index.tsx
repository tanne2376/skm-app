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

export default function TimetableScreen() {
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

  const toggleActiveMutation = useMutation({
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

  const generateSessionsMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('generate-sessions', {});
      if (error) throw new Error(error.message);
    },
    onSuccess: () => Alert.alert('Done', 'Sessions generated for the next 4 weeks.'),
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  // Group templates by day
  const byDay = (templates ?? []).reduce<Record<number, ClassTemplate[]>>((acc, t) => {
    if (!acc[t.day_of_week]) acc[t.day_of_week] = [];
    acc[t.day_of_week].push(t);
    return acc;
  }, {});

  const days = Object.keys(byDay).map(Number).sort((a, b) => a - b);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader
        title="Timetable"
        rightElement={
          <Button variant="ghost" size="sm" onPress={() => generateSessionsMutation.mutate()} loading={generateSessionsMutation.isPending}>
            Sync
          </Button>
        }
      />

      <FlatList
        data={days}
        keyExtractor={(d) => String(d)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={COLORS.accent} colors={[COLORS.accent]} />}
        renderItem={({ item: day }) => (
          <View style={styles.daySection}>
            <Text style={styles.dayHeading}>{DAY_NAMES[day]}</Text>
            {byDay[day].map((template) => (
              <TouchableOpacity
                key={template.id}
                onPress={() => router.push({ pathname: '/(app)/timetable/edit-template', params: { id: template.id } })}
                activeOpacity={0.8}
              >
                <Card style={[styles.templateCard, !template.is_active && styles.templateInactive]}>
                  <View style={styles.row}>
                    <View style={styles.flex}>
                      <Text style={styles.templateName}>{template.name}</Text>
                      <Text style={styles.templateMeta}>
                        {template.start_time.slice(0, 5)}–{template.end_time.slice(0, 5)} · Cap {template.capacity}
                      </Text>
                    </View>
                    <View style={styles.actions}>
                      <Badge label={template.is_active ? 'Active' : 'Inactive'} variant={template.is_active ? 'success' : 'neutral'} />
                      <TouchableOpacity
                        onPress={() =>
                          Alert.alert(
                            template.is_active ? 'Deactivate class?' : 'Activate class?',
                            template.is_active
                              ? 'This will stop this class from appearing on the schedule.'
                              : 'This will resume this class on the schedule.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Confirm', onPress: () => toggleActiveMutation.mutate({ id: template.id, isActive: template.is_active }) },
                            ],
                          )
                        }
                        style={styles.toggleBtn}
                      >
                        <Text style={styles.toggleBtnText}>{template.is_active ? 'Pause' : 'Resume'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </Card>
              </TouchableOpacity>
            ))}
          </View>
        )}
        ListFooterComponent={
          <View style={styles.footer}>
            <Text style={styles.footerNote}>
              Tap a class to edit its recurring schedule or override a specific session.
            </Text>
            <Button
              variant="secondary"
              size="md"
              onPress={() => router.push('/(app)/timetable/edit-session')}
            >
              Override a Specific Session
            </Button>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  list: { padding: 16, gap: 20 },
  daySection: { gap: 10 },
  dayHeading: { color: COLORS.accent, fontSize: 13, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  templateCard: { padding: 12 },
  templateInactive: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  templateName: { color: COLORS.white, fontSize: 15, fontWeight: '700', marginBottom: 3 },
  templateMeta: { color: COLORS.grey[400], fontSize: 13 },
  actions: { alignItems: 'flex-end', gap: 8 },
  toggleBtn: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: COLORS.grey[700] },
  toggleBtnText: { color: COLORS.grey[300], fontSize: 12, fontWeight: '600' },
  footer: { gap: 12, paddingTop: 8 },
  footerNote: { color: COLORS.grey[600], fontSize: 13, textAlign: 'center' },
});
