import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, Alert, Switch, TouchableOpacity, FlatList, Modal,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { ClassTemplate, Profile } from '@/types';

export default function EditSessionScreen() {
  const params = useLocalSearchParams<{ template_id?: string; session_id?: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  // If editing existing session, fetch it; otherwise create override for a template
  const sessionId = params.session_id;
  const templateId = params.template_id;

  const [sessionDate, setSessionDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [capacityOverride, setCapacityOverride] = useState('');
  const [priceOverride, setPriceOverride] = useState('');
  const [isCancelled, setIsCancelled] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState<Pick<Profile, 'id' | 'full_name'> | null>(null);
  const [showTeacherPicker, setShowTeacherPicker] = useState(false);

  const { data: existingSession } = useQuery({
    queryKey: ['class_session', sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data } = await supabase.from('class_sessions').select('*, class_templates(*), teacher:profiles!teacher_id(id, full_name)').eq('id', sessionId!).single();
      return data;
    },
  });

  const { data: template } = useQuery<ClassTemplate>({
    queryKey: ['class_template', templateId ?? (existingSession as any)?.template_id],
    enabled: !!(templateId || existingSession),
    queryFn: async () => {
      const tid = templateId ?? (existingSession as any)?.template_id;
      const { data } = await supabase.from('class_templates').select('*').eq('id', tid).single();
      return data as ClassTemplate;
    },
  });

  const { data: allProfiles } = useQuery<Pick<Profile, 'id' | 'full_name' | 'role'>[]>({
    queryKey: ['all_profiles'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name, role').order('full_name');
      return (data ?? []) as Pick<Profile, 'id' | 'full_name' | 'role'>[];
    },
  });

  const promoteToTeacher = useMutation({
    mutationFn: async (profileId: string) => {
      const { error } = await supabase.from('profiles').update({ role: 'teacher' }).eq('id', profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all_profiles'] });
    },
  });

  useEffect(() => {
    if (existingSession) {
      const s = existingSession as any;
      setSessionDate(s.session_date);
      setStartTime(s.start_time.slice(0, 5));
      setEndTime(s.end_time.slice(0, 5));
      setCapacityOverride(s.capacity ? String(s.capacity) : '');
      setPriceOverride(s.price ? (s.price / 100).toFixed(2) : '');
      setIsCancelled(s.is_cancelled);
      setCancellationReason(s.cancellation_reason ?? '');
      setSelectedTeacher(s.teacher ?? null);
    } else if (template) {
      setStartTime(template.start_time.slice(0, 5));
      setEndTime(template.end_time.slice(0, 5));
    }
  }, [existingSession, template]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!sessionDate.match(/^\d{4}-\d{2}-\d{2}$/)) throw new Error('Date must be YYYY-MM-DD.');
      if (!startTime.match(/^\d{2}:\d{2}$/)) throw new Error('Start time must be HH:MM.');
      if (!endTime.match(/^\d{2}:\d{2}$/)) throw new Error('End time must be HH:MM.');

      const tid = templateId ?? (existingSession as any)?.template_id;
      const payload = {
        template_id: tid,
        teacher_id: selectedTeacher?.id ?? null,
        session_date: sessionDate,
        start_time: startTime,
        end_time: endTime,
        capacity: capacityOverride ? parseInt(capacityOverride, 10) : null,
        price: priceOverride ? Math.round(parseFloat(priceOverride) * 100) : null,
        is_cancelled: isCancelled,
        cancellation_reason: isCancelled ? (cancellationReason.trim() || null) : null,
      };

      if (sessionId) {
        const { error } = await supabase.from('class_sessions').update(payload).eq('id', sessionId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('class_sessions').upsert(payload, { onConflict: 'template_id,session_date' });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['class_sessions'] });
      queryClient.invalidateQueries({ queryKey: ['class_session', sessionId] });
      Alert.alert('Saved', 'Session updated.', [{ text: 'OK', onPress: () => router.back() }]);
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title={sessionId ? 'Edit Session' : 'Override Session'} showBack />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {template && (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>Class: {template.name}</Text>
            <Text style={styles.infoText}>Overrides apply to this specific date only.</Text>
          </View>
        )}

        <Card>
          <Field label="Date (YYYY-MM-DD)">
            <TextInput style={styles.input} value={sessionDate} onChangeText={setSessionDate} keyboardType="numbers-and-punctuation" placeholder="2026-04-21" placeholderTextColor={COLORS.grey[600]} editable={!sessionId} />
          </Field>
          <Field label="Start Time (HH:MM)">
            <TextInput style={styles.input} value={startTime} onChangeText={setStartTime} keyboardType="numbers-and-punctuation" placeholderTextColor={COLORS.grey[600]} />
          </Field>
          <Field label="End Time (HH:MM)">
            <TextInput style={styles.input} value={endTime} onChangeText={setEndTime} keyboardType="numbers-and-punctuation" placeholderTextColor={COLORS.grey[600]} />
          </Field>
          <Field label="Capacity Override (leave blank to use default)">
            <TextInput style={styles.input} value={capacityOverride} onChangeText={setCapacityOverride} keyboardType="number-pad" placeholder={`Default: ${template?.capacity ?? '—'}`} placeholderTextColor={COLORS.grey[600]} />
          </Field>
          <Field label="Price Override £ (leave blank for default)">
            <TextInput style={styles.input} value={priceOverride} onChangeText={setPriceOverride} keyboardType="decimal-pad" placeholder={template ? `Default: £${(template.price / 100).toFixed(2)}` : ''} placeholderTextColor={COLORS.grey[600]} />
          </Field>
        </Card>

        <Card>
          <Field label="Assign Teacher">
            <TouchableOpacity style={styles.picker} onPress={() => setShowTeacherPicker(true)}>
              <Text style={selectedTeacher ? styles.pickerSelected : styles.pickerPlaceholder}>
                {selectedTeacher?.full_name ?? 'No teacher assigned'}
              </Text>
            </TouchableOpacity>
          </Field>
        </Card>

        <Card>
          <View style={styles.cancelRow}>
            <Text style={styles.cancelLabel}>Cancel this session</Text>
            <Switch
              value={isCancelled}
              onValueChange={setIsCancelled}
              trackColor={{ false: COLORS.grey[700], true: COLORS.error }}
              thumbColor={COLORS.white}
            />
          </View>
          {isCancelled && (
            <Field label="Cancellation Reason (optional)">
              <TextInput
                style={styles.input}
                value={cancellationReason}
                onChangeText={setCancellationReason}
                placeholder="e.g. Instructor unavailable"
                placeholderTextColor={COLORS.grey[600]}
              />
            </Field>
          )}
        </Card>

        <Button variant="primary" size="lg" onPress={() => saveMutation.mutate()} loading={saveMutation.isPending}>
          Save Session Override
        </Button>
      </ScrollView>

      {/* Teacher picker */}
      <Modal visible={showTeacherPicker} animationType="slide" transparent onRequestClose={() => setShowTeacherPicker(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowTeacherPicker(false)} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Assign Teacher</Text>
            <Text style={styles.modalSubtitle}>Selecting a student will promote them to teacher</Text>
            <TouchableOpacity style={styles.modalItem} onPress={() => { setSelectedTeacher(null); setShowTeacherPicker(false); }}>
              <Text style={styles.modalItemLabel}>No teacher assigned</Text>
            </TouchableOpacity>
            <FlatList
              data={allProfiles ?? []}
              keyExtractor={(t) => t.id}
              renderItem={({ item }) => {
                const isStudent = item.role === 'student';
                return (
                  <TouchableOpacity
                    style={styles.modalItem}
                    onPress={() => {
                      if (isStudent) {
                        Alert.alert(
                          'Promote to Teacher',
                          `${item.full_name} is currently a student. Assigning them will promote their role to teacher.`,
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Promote & Assign',
                              onPress: () => {
                                promoteToTeacher.mutate(item.id);
                                setSelectedTeacher({ id: item.id, full_name: item.full_name });
                                setShowTeacherPicker(false);
                              },
                            },
                          ],
                        );
                      } else {
                        setSelectedTeacher({ id: item.id, full_name: item.full_name });
                        setShowTeacherPicker(false);
                      }
                    }}
                  >
                    <View style={styles.modalItemRow}>
                      <Text style={styles.modalItemLabel}>{item.full_name}</Text>
                      <Text style={[styles.roleBadge, isStudent && styles.roleBadgeStudent]}>
                        {item.role}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
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
  content: { padding: 16, gap: 16 },
  infoBox: { backgroundColor: 'rgba(59,130,246,0.1)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)', borderRadius: 10, padding: 14, gap: 4 },
  infoText: { color: '#60A5FA', fontSize: 13 },
  label: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  input: { backgroundColor: COLORS.grey[800], borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.white, fontSize: 15, borderWidth: 1, borderColor: COLORS.grey[700] },
  picker: { backgroundColor: COLORS.grey[800], borderRadius: 8, paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: COLORS.grey[700] },
  pickerSelected: { color: COLORS.white, fontSize: 15 },
  pickerPlaceholder: { color: COLORS.grey[600], fontSize: 15 },
  cancelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  cancelLabel: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: COLORS.grey[900], borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, maxHeight: '60%' },
  modalTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  modalSubtitle: { color: COLORS.grey[600], fontSize: 13, marginBottom: 16 },
  modalItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.grey[800] },
  modalItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalItemLabel: { color: COLORS.white, fontSize: 15 },
  roleBadge: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  roleBadgeStudent: { color: COLORS.warning },
});
