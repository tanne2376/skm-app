import { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, Alert,
  TouchableOpacity, Modal, FlatList,
} from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { formatGBP } from '@/lib/stripe';
import { Location, Profile } from '@/types';

export default function CreateOneToOneScreen() {
  const insets = useSafeAreaInsets();
  const { session, role } = useAuth();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [pricePounds, setPricePounds] = useState('');
  const [sessionDate, setSessionDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [locationType, setLocationType] = useState<'predefined' | 'custom'>('predefined');
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [customLocation, setCustomLocation] = useState('');
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  // Admin only: select a teacher
  const [selectedTeacher, setSelectedTeacher] = useState<Pick<Profile, 'id' | 'full_name'> | null>(null);
  const [showTeacherPicker, setShowTeacherPicker] = useState(false);

  const { data: locations } = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('*').eq('is_active', true).order('name');
      return (data ?? []) as Location[];
    },
  });

  const { data: teachers } = useQuery<Pick<Profile, 'id' | 'full_name'>[]>({
    queryKey: ['teachers'],
    enabled: role === 'admin',
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('role', ['teacher', 'admin'])
        .order('full_name');
      return (data ?? []) as Pick<Profile, 'id' | 'full_name'>[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error('Title is required.');
      if (!sessionDate.match(/^\d{4}-\d{2}-\d{2}$/)) throw new Error('Date must be YYYY-MM-DD.');
      if (!startTime.match(/^\d{2}:\d{2}$/)) throw new Error('Start time must be HH:MM.');
      if (!endTime.match(/^\d{2}:\d{2}$/)) throw new Error('End time must be HH:MM.');
      const priceNum = parseFloat(pricePounds);
      if (isNaN(priceNum) || priceNum < 0) throw new Error('Enter a valid price.');
      if (locationType === 'predefined' && !selectedLocation) throw new Error('Select a location.');
      if (locationType === 'custom' && !customLocation.trim()) throw new Error('Enter a location.');

      const teacherId = role === 'admin' ? (selectedTeacher?.id ?? session!.user.id) : session!.user.id;

      const { error } = await supabase.from('one_to_ones').insert({
        creator_id: session!.user.id,
        teacher_id: teacherId,
        title: title.trim(),
        description: description.trim() || null,
        price: Math.round(priceNum * 100),
        session_date: sessionDate,
        start_time: startTime,
        end_time: endTime,
        location_type: locationType,
        location_id: locationType === 'predefined' ? selectedLocation?.id : null,
        location_text: locationType === 'custom' ? customLocation.trim() : selectedLocation?.address ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['one_to_ones'] });
      Alert.alert('Created!', '1-to-1 session is now available for booking.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="Create 1-to-1" showBack />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        <Card>
          <Field label="Title *">
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Pad Work Session" placeholderTextColor={COLORS.grey[600]} />
          </Field>

          <Field label="Description (optional)">
            <TextInput style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} multiline numberOfLines={3} placeholder="What will the session cover?" placeholderTextColor={COLORS.grey[600]} />
          </Field>

          <Field label="Price (£) *">
            <TextInput style={styles.input} value={pricePounds} onChangeText={setPricePounds} keyboardType="decimal-pad" placeholder="e.g. 50" placeholderTextColor={COLORS.grey[600]} />
          </Field>
        </Card>

        <Card>
          <Field label="Date * (YYYY-MM-DD)">
            <TextInput style={styles.input} value={sessionDate} onChangeText={setSessionDate} placeholder="2026-04-15" placeholderTextColor={COLORS.grey[600]} keyboardType="numbers-and-punctuation" />
          </Field>
          <Field label="Start Time * (HH:MM)">
            <TextInput style={styles.input} value={startTime} onChangeText={setStartTime} placeholder="10:00" placeholderTextColor={COLORS.grey[600]} keyboardType="numbers-and-punctuation" />
          </Field>
          <Field label="End Time * (HH:MM)">
            <TextInput style={styles.input} value={endTime} onChangeText={setEndTime} placeholder="11:00" placeholderTextColor={COLORS.grey[600]} keyboardType="numbers-and-punctuation" />
          </Field>
        </Card>

        <Card>
          <Text style={styles.fieldLabel}>Location *</Text>
          <View style={styles.locTypeRow}>
            {(['predefined', 'custom'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.locTypeBtn, locationType === t && styles.locTypeBtnActive]}
                onPress={() => setLocationType(t)}
              >
                <Text style={[styles.locTypeBtnText, locationType === t && styles.locTypeBtnTextActive]}>
                  {t === 'predefined' ? 'Select venue' : 'Custom'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {locationType === 'predefined' ? (
            <TouchableOpacity style={styles.picker} onPress={() => setShowLocationPicker(true)}>
              <Text style={selectedLocation ? styles.pickerSelected : styles.pickerPlaceholder}>
                {selectedLocation?.name ?? 'Choose a location…'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TextInput
              style={styles.input}
              value={customLocation}
              onChangeText={setCustomLocation}
              placeholder="e.g. Unit 5 Gym, SE1 or Online via Zoom"
              placeholderTextColor={COLORS.grey[600]}
            />
          )}
        </Card>

        {role === 'admin' && (
          <Card>
            <Field label="Assign Teacher">
              <TouchableOpacity style={styles.picker} onPress={() => setShowTeacherPicker(true)}>
                <Text style={selectedTeacher ? styles.pickerSelected : styles.pickerPlaceholder}>
                  {selectedTeacher?.full_name ?? 'Self (you) — tap to change'}
                </Text>
              </TouchableOpacity>
            </Field>
          </Card>
        )}

        <Button
          variant="primary"
          size="lg"
          onPress={() => createMutation.mutate()}
          loading={createMutation.isPending}
        >
          Create Session
        </Button>
      </ScrollView>

      {/* Location picker modal */}
      <PickerModal
        visible={showLocationPicker}
        title="Select Location"
        items={locations?.map((l) => ({ id: l.id, label: l.name, sublabel: l.address })) ?? []}
        onSelect={(id) => {
          setSelectedLocation(locations?.find((l) => l.id === id) ?? null);
          setShowLocationPicker(false);
        }}
        onClose={() => setShowLocationPicker(false)}
      />

      {/* Teacher picker modal */}
      <PickerModal
        visible={showTeacherPicker}
        title="Select Teacher"
        items={teachers?.map((t) => ({ id: t.id, label: t.full_name })) ?? []}
        onSelect={(id) => {
          setSelectedTeacher(teachers?.find((t) => t.id === id) ?? null);
          setShowTeacherPicker(false);
        }}
        onClose={() => setShowTeacherPicker(false)}
      />
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function PickerModal({
  visible, title, items, onSelect, onClose,
}: {
  visible: boolean;
  title: string;
  items: { id: string; label: string; sublabel?: string }[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>{title}</Text>
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.modalItem} onPress={() => onSelect(item.id)}>
                <Text style={styles.modalItemLabel}>{item.label}</Text>
                {item.sublabel ? <Text style={styles.modalItemSub}>{item.sublabel}</Text> : null}
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  content: { padding: 16, gap: 16 },
  fieldLabel: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  input: { backgroundColor: COLORS.grey[800], borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.white, fontSize: 15, borderWidth: 1, borderColor: COLORS.grey[700] },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  locTypeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  locTypeBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: COLORS.grey[700], alignItems: 'center' },
  locTypeBtnActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  locTypeBtnText: { color: COLORS.grey[400], fontWeight: '600' },
  locTypeBtnTextActive: { color: COLORS.white },
  picker: { backgroundColor: COLORS.grey[800], borderRadius: 8, paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: COLORS.grey[700] },
  pickerSelected: { color: COLORS.white, fontSize: 15 },
  pickerPlaceholder: { color: COLORS.grey[600], fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: COLORS.grey[900], borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, maxHeight: '70%' },
  modalTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700', marginBottom: 16 },
  modalItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.grey[800] },
  modalItemLabel: { color: COLORS.white, fontSize: 15 },
  modalItemSub: { color: COLORS.grey[400], fontSize: 13, marginTop: 2 },
});
