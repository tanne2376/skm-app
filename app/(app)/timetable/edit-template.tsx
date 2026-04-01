import { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, DAY_NAMES } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { ClassTemplate } from '@/types';

export default function EditTemplateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: template, isLoading } = useQuery<ClassTemplate>({
    queryKey: ['class_template', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('class_templates').select('*').eq('id', id).single();
      if (error) throw error;
      return data as ClassTemplate;
    },
  });

  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [capacity, setCapacity] = useState('');
  const [pricePounds, setPricePounds] = useState('');

  useEffect(() => {
    if (template) {
      setName(template.name);
      setStartTime(template.start_time.slice(0, 5));
      setEndTime(template.end_time.slice(0, 5));
      setCapacity(String(template.capacity));
      setPricePounds((template.price / 100).toFixed(2));
    }
  }, [template]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Name is required.');
      if (!startTime.match(/^\d{2}:\d{2}$/)) throw new Error('Start time must be HH:MM.');
      if (!endTime.match(/^\d{2}:\d{2}$/)) throw new Error('End time must be HH:MM.');
      const cap = parseInt(capacity, 10);
      if (isNaN(cap) || cap < 1) throw new Error('Capacity must be a positive number.');
      const price = parseFloat(pricePounds);
      if (isNaN(price) || price < 0) throw new Error('Price must be 0 or more.');

      const { error } = await supabase
        .from('class_templates')
        .update({
          name: name.trim(),
          start_time: startTime,
          end_time: endTime,
          capacity: cap,
          price: Math.round(price * 100),
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['class_templates'] });
      Alert.alert('Updated', 'Recurring schedule updated. Future sessions will reflect this change.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="Edit Recurring Class" showBack />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            ⚠ This updates the recurring schedule. Session overrides are not affected.
          </Text>
          <Text style={styles.infoText}>
            Runs every {DAY_NAMES[template?.day_of_week ?? 1]}
          </Text>
        </View>

        <Card>
          <Field label="Class Name">
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholderTextColor={COLORS.grey[600]} />
          </Field>
          <Field label="Start Time (HH:MM)">
            <TextInput style={styles.input} value={startTime} onChangeText={setStartTime} keyboardType="numbers-and-punctuation" placeholderTextColor={COLORS.grey[600]} />
          </Field>
          <Field label="End Time (HH:MM)">
            <TextInput style={styles.input} value={endTime} onChangeText={setEndTime} keyboardType="numbers-and-punctuation" placeholderTextColor={COLORS.grey[600]} />
          </Field>
          <Field label="Capacity">
            <TextInput style={styles.input} value={capacity} onChangeText={setCapacity} keyboardType="number-pad" placeholderTextColor={COLORS.grey[600]} />
          </Field>
          <Field label="Price (£)">
            <TextInput style={styles.input} value={pricePounds} onChangeText={setPricePounds} keyboardType="decimal-pad" placeholderTextColor={COLORS.grey[600]} />
          </Field>
        </Card>

        <Button variant="primary" size="lg" onPress={() => updateMutation.mutate()} loading={updateMutation.isPending}>
          Save Changes
        </Button>

        <Button variant="secondary" size="md" onPress={() => router.push({ pathname: '/(app)/timetable/edit-session', params: { template_id: id } })}>
          Override a Specific Date Instead
        </Button>
      </ScrollView>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.black },
  content: { padding: 16, gap: 16 },
  infoBox: { backgroundColor: 'rgba(245,158,11,0.1)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)', borderRadius: 10, padding: 14, gap: 4 },
  infoText: { color: COLORS.warning, fontSize: 13 },
  label: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  input: { backgroundColor: COLORS.grey[800], borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.white, fontSize: 15, borderWidth: 1, borderColor: COLORS.grey[700] },
});
