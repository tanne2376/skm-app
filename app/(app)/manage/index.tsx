import { useState } from 'react';
import {
  View, Text, TextInput, FlatList, ScrollView, StyleSheet,
  TouchableOpacity, RefreshControl, Alert, Modal,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, DAY_NAMES } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { ClassTemplate, Profile } from '@/types';

interface TemplateWithTeacher extends ClassTemplate {
  default_teacher?: Pick<Profile, 'id' | 'full_name'> | null;
}

export default function ManageScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [editingTemplate, setEditingTemplate] = useState<TemplateWithTeacher | null>(null);
  const [showTeacherPicker, setShowTeacherPicker] = useState(false);
  const [showAddClass, setShowAddClass] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editTeacher, setEditTeacher] = useState<Pick<Profile, 'id' | 'full_name'> | null>(null);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newDay, setNewDay] = useState(1);
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [newCapacity, setNewCapacity] = useState('20');
  const [newPrice, setNewPrice] = useState('15.00');

  const { data: templates, isLoading, refetch } = useQuery<TemplateWithTeacher[]>({
    queryKey: ['class_templates_with_teachers'],
    queryFn: async () => {
      const { data: tpls, error } = await supabase
        .from('class_templates')
        .select('*')
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true });
      if (error) throw error;

      const today = new Date().toISOString().split('T')[0];
      const { data: sessions } = await supabase
        .from('class_sessions')
        .select('template_id, teacher:profiles!teacher_id(id, full_name)')
        .gte('session_date', today)
        .order('session_date', { ascending: true });

      const teacherByTemplate = new Map<string, Pick<Profile, 'id' | 'full_name'> | null>();
      for (const s of (sessions ?? []) as any[]) {
        if (!teacherByTemplate.has(s.template_id)) {
          teacherByTemplate.set(s.template_id, s.teacher ?? null);
        }
      }

      return (tpls ?? []).map((t: any) => ({
        ...t,
        default_teacher: teacherByTemplate.get(t.id) ?? null,
      })) as TemplateWithTeacher[];
    },
  });

  const { data: allProfiles } = useQuery<Pick<Profile, 'id' | 'full_name' | 'role'>[]>({
    queryKey: ['all_profiles'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name, role').order('full_name');
      return (data ?? []) as Pick<Profile, 'id' | 'full_name' | 'role'>[];
    },
  });

  function openEdit(template: TemplateWithTeacher) {
    setEditName(template.name);
    setEditStart(template.start_time.slice(0, 5));
    setEditEnd(template.end_time.slice(0, 5));
    setEditTeacher(template.default_teacher ?? null);
    setEditingTemplate(template);
  }

  const updateTemplate = useMutation({
    mutationFn: async () => {
      if (!editingTemplate) return;
      if (!editName.trim()) throw new Error('Name cannot be empty.');
      if (!editStart.match(/^\d{2}:\d{2}$/) || !editEnd.match(/^\d{2}:\d{2}$/)) throw new Error('Times must be HH:MM.');

      const { error } = await supabase
        .from('class_templates')
        .update({ name: editName.trim(), start_time: editStart, end_time: editEnd })
        .eq('id', editingTemplate.id);
      if (error) throw error;

      // Update teacher on all future sessions if changed
      if (editTeacher?.id !== editingTemplate.default_teacher?.id) {
        const today = new Date().toISOString().split('T')[0];
        await supabase
          .from('class_sessions')
          .update({ teacher_id: editTeacher?.id ?? null })
          .eq('template_id', editingTemplate.id)
          .gte('session_date', today);
      }
    },
    onSuccess: () => {
      invalidateAll();
      setEditingTemplate(null);
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('class_templates')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      setEditingTemplate(null);
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const addTemplate = useMutation({
    mutationFn: async () => {
      if (!newName.trim()) throw new Error('Name is required.');
      if (!newStart.match(/^\d{2}:\d{2}$/) || !newEnd.match(/^\d{2}:\d{2}$/)) throw new Error('Times must be HH:MM.');
      const cap = parseInt(newCapacity, 10);
      const price = Math.round(parseFloat(newPrice) * 100);
      if (isNaN(cap) || cap <= 0) throw new Error('Capacity must be a positive number.');
      if (isNaN(price) || price < 0) throw new Error('Invalid price.');

      const { error } = await supabase.from('class_templates').insert({
        name: newName.trim(),
        day_of_week: newDay,
        start_time: newStart,
        end_time: newEnd,
        capacity: cap,
        price,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      setShowAddClass(false);
      setNewName(''); setNewStart(''); setNewEnd(''); setNewCapacity('20'); setNewPrice('15.00');
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const assignTeacher = useMutation({
    mutationFn: async ({ profileId, needsPromotion }: { profileId: string; needsPromotion: boolean }) => {
      if (needsPromotion) {
        const { error } = await supabase.from('profiles').update({ role: 'teacher' }).eq('id', profileId);
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['all_profiles'] }),
  });

  function handleSelectTeacher(profile: Pick<Profile, 'id' | 'full_name' | 'role'>) {
    if (profile.role === 'student') {
      Alert.alert(
        'Promote to Teacher',
        `${profile.full_name} is currently a student. Assigning them will promote their role to teacher.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Promote & Assign',
            onPress: () => {
              assignTeacher.mutate({ profileId: profile.id, needsPromotion: true });
              setEditTeacher({ id: profile.id, full_name: profile.full_name });
              setShowTeacherPicker(false);
            },
          },
        ],
      );
    } else {
      setEditTeacher({ id: profile.id, full_name: profile.full_name });
      setShowTeacherPicker(false);
    }
  }

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['class_templates_with_teachers'] });
    queryClient.invalidateQueries({ queryKey: ['class_sessions'] });
    queryClient.invalidateQueries({ queryKey: ['all_profiles'] });
  }

  const byDay = (templates ?? []).filter(t => t.is_active).reduce<Record<number, TemplateWithTeacher[]>>((acc, t) => {
    if (!acc[t.day_of_week]) acc[t.day_of_week] = [];
    acc[t.day_of_week].push(t);
    return acc;
  }, {});
  const days = Object.keys(byDay).map(Number).sort((a, b) => a - b);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Manage" />

      <ScrollView
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={COLORS.accent} />}
      >
        <Button variant="secondary" size="md" onPress={() => setShowAddClass(true)} style={{ marginBottom: 8 }}>
          + Add Class
        </Button>
        {days.length === 0 && !isLoading && (
          <Text style={styles.emptyText}>No classes yet.</Text>
        )}
        {days.map((day) => (
          <View key={day} style={styles.daySection}>
            <Text style={styles.dayHeading}>{DAY_NAMES[day]}</Text>
            {byDay[day].map((template) => (
              <TouchableOpacity key={template.id} onPress={() => openEdit(template)} activeOpacity={0.7}>
                <Card style={styles.card}>
                  <Text style={styles.cardName}>{template.name}</Text>
                  <Text style={styles.cardMeta}>
                    {template.start_time.slice(0, 5)}–{template.end_time.slice(0, 5)} · Cap {template.capacity}
                  </Text>
                  <Text style={styles.cardLeader}>
                    {template.default_teacher?.full_name ?? 'No leader assigned'}
                  </Text>
                </Card>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>

      {/* Edit class modal */}
      {!!editingTemplate && <Modal visible animationType="slide" transparent onRequestClose={() => setEditingTemplate(null)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setEditingTemplate(null)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Edit Class</Text>

            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholderTextColor={COLORS.grey[600]} />

            <View style={styles.timeRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Start</Text>
                <TextInput style={styles.input} value={editStart} onChangeText={setEditStart} keyboardType="numbers-and-punctuation" placeholderTextColor={COLORS.grey[600]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>End</Text>
                <TextInput style={styles.input} value={editEnd} onChangeText={setEditEnd} keyboardType="numbers-and-punctuation" placeholderTextColor={COLORS.grey[600]} />
              </View>
            </View>

            <Text style={styles.fieldLabel}>Class Leader</Text>
            <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTeacherPicker(true)}>
              <Text style={editTeacher ? styles.pickerBtnText : styles.pickerBtnPlaceholder}>
                {editTeacher?.full_name ?? 'None assigned'}
              </Text>
            </TouchableOpacity>

            <View style={styles.editActions}>
              <Button variant="primary" size="md" onPress={() => updateTemplate.mutate()} loading={updateTemplate.isPending} style={{ flex: 1 }}>
                Save
              </Button>
              <Button
                variant="danger"
                size="md"
                onPress={() =>
                  Alert.alert('Delete Class', `Remove "${editingTemplate?.name}" from the timetable?`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => deleteTemplate.mutate(editingTemplate!.id) },
                  ])
                }
                loading={deleteTemplate.isPending}
                style={{ flex: 1 }}
              >
                Delete
              </Button>
            </View>
          </View>
        </View>
      </Modal>}

      {/* Teacher picker modal */}
      {showTeacherPicker && <Modal visible animationType="slide" transparent onRequestClose={() => setShowTeacherPicker(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowTeacherPicker(false)} />
          <View style={[styles.modalSheet, { maxHeight: '60%' }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Assign Class Leader</Text>
            <Text style={styles.modalSubtitle}>Selecting a student will promote them to teacher</Text>
            <FlatList
              data={allProfiles ?? []}
              keyExtractor={(p) => p.id}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.pickerItem} onPress={() => handleSelectTeacher(item)}>
                  <Text style={styles.pickerName}>{item.full_name}</Text>
                  <Text style={[styles.pickerRole, item.role === 'student' && styles.pickerRoleStudent]}>
                    {item.role}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>}

      {/* Add class modal */}
      {showAddClass && <Modal visible animationType="slide" transparent onRequestClose={() => setShowAddClass(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowAddClass(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Add Class</Text>

            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput style={styles.input} value={newName} onChangeText={setNewName} placeholder="e.g. Kickboxing" placeholderTextColor={COLORS.grey[600]} />

            <Text style={styles.fieldLabel}>Day</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[styles.dayChip, newDay === d && styles.dayChipActive]}
                  onPress={() => setNewDay(d)}
                >
                  <Text style={[styles.dayChipText, newDay === d && styles.dayChipTextActive]}>
                    {DAY_NAMES[d].slice(0, 3)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.timeRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Start</Text>
                <TextInput style={styles.input} value={newStart} onChangeText={setNewStart} placeholder="09:00" keyboardType="numbers-and-punctuation" placeholderTextColor={COLORS.grey[600]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>End</Text>
                <TextInput style={styles.input} value={newEnd} onChangeText={setNewEnd} placeholder="10:00" keyboardType="numbers-and-punctuation" placeholderTextColor={COLORS.grey[600]} />
              </View>
            </View>

            <View style={styles.timeRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Capacity</Text>
                <TextInput style={styles.input} value={newCapacity} onChangeText={setNewCapacity} keyboardType="number-pad" placeholderTextColor={COLORS.grey[600]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Price</Text>
                <TextInput style={styles.input} value={newPrice} onChangeText={setNewPrice} keyboardType="decimal-pad" placeholderTextColor={COLORS.grey[600]} />
              </View>
            </View>

            <Button variant="primary" size="md" onPress={() => addTemplate.mutate()} loading={addTemplate.isPending}>
              Add Class
            </Button>
          </View>
        </View>
      </Modal>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  list: { padding: 16, gap: 16 },
  daySection: { gap: 10 },
  dayHeading: { color: COLORS.accent, fontSize: 13, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },

  card: { padding: 14 },
  cardName: { color: COLORS.white, fontSize: 15, fontWeight: '700', marginBottom: 3 },
  cardMeta: { color: COLORS.grey[400], fontSize: 13 },
  cardLeader: { color: COLORS.grey[600], fontSize: 12, marginTop: 2 },

  emptyText: { color: COLORS.grey[600], textAlign: 'center', paddingTop: 60, fontSize: 15 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: COLORS.grey[900],
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderColor: COLORS.grey[800],
    padding: 20, paddingBottom: 40,
  },
  modalHandle: { width: 36, height: 4, backgroundColor: COLORS.grey[700], borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700', marginBottom: 16 },
  modalSubtitle: { color: COLORS.grey[600], fontSize: 13, marginBottom: 16 },

  fieldLabel: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  input: { backgroundColor: COLORS.grey[800], borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.white, fontSize: 15, borderWidth: 1, borderColor: COLORS.grey[700], marginBottom: 12 },
  timeRow: { flexDirection: 'row', gap: 12 },
  editActions: { flexDirection: 'row', gap: 12, marginTop: 4 },

  pickerBtn: { backgroundColor: COLORS.grey[800], borderRadius: 8, paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: COLORS.grey[700], marginBottom: 16 },
  pickerBtnText: { color: COLORS.white, fontSize: 15 },
  pickerBtnPlaceholder: { color: COLORS.grey[600], fontSize: 15 },

  pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.grey[800] },
  pickerName: { color: COLORS.white, fontSize: 15 },
  pickerRole: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  pickerRoleStudent: { color: COLORS.warning },

  dayChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: COLORS.grey[800], marginRight: 8 },
  dayChipActive: { backgroundColor: COLORS.accent },
  dayChipText: { color: COLORS.grey[400], fontSize: 13, fontWeight: '600' },
  dayChipTextActive: { color: COLORS.white },
});
