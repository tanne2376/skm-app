import { useState } from 'react';
import {
  View, Text, TextInput, FlatList, ScrollView, StyleSheet,
  TouchableOpacity, RefreshControl, Alert, ActivityIndicator,
} from 'react-native';
import { SlideUpModal } from '@/components/ui/SlideUpModal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, DAY_NAMES } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { formatGBP } from '@/lib/stripe';
import { ClassTemplate, Profile } from '@/types';

type ManageTab = 'timetable' | 'users';

interface TemplateWithTeacher extends ClassTemplate {
  default_teacher?: Pick<Profile, 'id' | 'full_name'> | null;
}

interface UserWithLateCancellations {
  user_id: string;
  full_name: string;
  role: string;
  late_cancellation_count: number;
  membership_tier: string | null;
  membership_status: string | null;
  is_blocked: boolean;
  is_manually_blocked: boolean;
  late_cancel_unblocked_until: string | null;
  owed_amount: number;
}

interface LateCancellationHistoryItem {
  id: string;
  kind: 'class' | 'one_to_one';
  session_id: string;
  class_name: string;
  session_date: string;
  session_start_time: string;
  cancelled_at: string;
}

interface UnconfirmedCashSessionItem {
  source_type: 'class' | 'one_to_one' | 'membership' | 'block';
  source_id: string;
  description: string;
  session_date: string;
  amount: number;
}

// Parse a pounds string ("12", "12.5", "12.50") directly into integer pence.
// Returns null on invalid input. Avoids floating-point math on currency.
function parsePoundsToPence(value: string): number | null {
  const m = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const pounds = Number(m[1]);
  const fractional = (m[2] ?? '').padEnd(2, '0');
  return pounds * 100 + Number(fractional);
}

interface PaymentHistoryItem {
  id: string;
  amount: number;
  note: string | null;
  recorded_by_name: string | null;
  recorded_at: string;
}

export default function ManageScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ManageTab>('timetable');

  return (
    <View style={styles.container}>
      <ScreenHeader title="Manage" />

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'timetable' && styles.tabActive]}
          onPress={() => setActiveTab('timetable')}
        >
          <Text style={[styles.tabText, activeTab === 'timetable' && styles.tabTextActive]}>
            Timetable
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'users' && styles.tabActive]}
          onPress={() => setActiveTab('users')}
        >
          <Text style={[styles.tabText, activeTab === 'users' && styles.tabTextActive]}>
            Users
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'timetable' ? <TimetableTab /> : <UsersTab />}
    </View>
  );
}

// ─── Timetable Tab ──────────────────────────────────────────────────────────

function TimetableTab() {
  const queryClient = useQueryClient();

  const [editingTemplate, setEditingTemplate] = useState<TemplateWithTeacher | null>(null);
  const [showTeacherPicker, setShowTeacherPicker] = useState(false);
  const [showAddClass, setShowAddClass] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editTeacher, setEditTeacher] = useState<Pick<Profile, 'id' | 'full_name'> | null>(null);
  const [editCapacity, setEditCapacity] = useState('');

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
      const { data, error } = await supabase
        .from('class_templates')
        .select('*, default_teacher:profiles!teacher_id(id, full_name)')
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true });
      if (error) throw error;

      return (data ?? []) as TemplateWithTeacher[];
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
    setEditCapacity(String(template.capacity));
    setEditingTemplate(template);
  }

  const updateTemplate = useMutation({
    mutationFn: async () => {
      if (!editingTemplate) return;
      if (!editName.trim()) throw new Error('Name cannot be empty.');
      if (!editStart.match(/^\d{2}:\d{2}$/) || !editEnd.match(/^\d{2}:\d{2}$/)) throw new Error('Times must be HH:MM.');
      const cap = parseInt(editCapacity, 10);
      if (isNaN(cap) || cap <= 0) throw new Error('Capacity must be a positive number.');

      const teacherChanged = editTeacher?.id !== editingTemplate.default_teacher?.id;

      const { error } = await supabase
        .from('class_templates')
        .update({
          name: editName.trim(),
          start_time: editStart,
          end_time: editEnd,
          capacity: cap,
          teacher_id: editTeacher?.id ?? null,
        })
        .eq('id', editingTemplate.id);
      if (error) throw error;

      // Propagate the leader change to already-generated future sessions so
      // existing bookings reflect the new leader. New sessions inherit
      // automatically via generate_sessions_ahead.
      if (teacherChanged) {
        const today = new Date().toISOString().split('T')[0];
        const { error: sessionError } = await supabase
          .from('class_sessions')
          .update({ teacher_id: editTeacher?.id ?? null })
          .eq('template_id', editingTemplate.id)
          .gte('session_date', today);
        if (sessionError) throw sessionError;
      }
    },
    onSuccess: () => {
      invalidateAll();
      setShowTeacherPicker(false);
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
      setShowTeacherPicker(false);
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
    <>
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
      <SlideUpModal
        visible={!!editingTemplate}
        onDismiss={() => { setShowTeacherPicker(false); setEditingTemplate(null); }}
        fullScreen={showTeacherPicker}
      >
        {!showTeacherPicker ? (
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

            <Text style={styles.fieldLabel}>Capacity</Text>
            <TextInput style={styles.input} value={editCapacity} onChangeText={setEditCapacity} keyboardType="number-pad" placeholderTextColor={COLORS.grey[600]} />

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
        ) : (
          <View style={[styles.modalSheet, { flex: 1 }]}>
            <View style={styles.modalHandle} />
            <View style={styles.pickerHeader}>
              <TouchableOpacity onPress={() => setShowTeacherPicker(false)}>
                <Text style={styles.pickerBack}>← Back</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Assign Class Leader</Text>
              <Text style={styles.modalSubtitle}>Students will be promoted to teacher on assignment</Text>
            </View>
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
        )}
      </SlideUpModal>

      {/* Add class modal */}
      <SlideUpModal visible={showAddClass} onDismiss={() => setShowAddClass(false)}>
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
      </SlideUpModal>
    </>
  );
}

// ─── Users Tab ──────────────────────────────────────────────────────────────

function UsersTab() {
  const queryClient = useQueryClient();
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [recordingPaymentFor, setRecordingPaymentFor] = useState<UserWithLateCancellations | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');

  const { data: users, isLoading, refetch } = useQuery<UserWithLateCancellations[]>({
    queryKey: ['admin_users_late_cancellations'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_users_with_late_cancellations');
      if (error) throw error;
      return (data ?? []) as UserWithLateCancellations[];
    },
  });

  const { data: history, isLoading: historyLoading } = useQuery<LateCancellationHistoryItem[]>({
    queryKey: ['late_cancellation_history', expandedUserId],
    enabled: !!expandedUserId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_user_late_cancellation_history', {
        p_user_id: expandedUserId,
      });
      if (error) throw error;
      return (data ?? []) as LateCancellationHistoryItem[];
    },
  });

  const { data: unconfirmedSessions, isLoading: unconfirmedLoading } = useQuery<UnconfirmedCashSessionItem[]>({
    queryKey: ['unconfirmed_cash_sessions', expandedUserId],
    enabled: !!expandedUserId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_user_unconfirmed_cash_sessions', {
        p_user_id: expandedUserId,
      });
      if (error) throw error;
      return (data ?? []) as UnconfirmedCashSessionItem[];
    },
  });

  const { data: paymentHistory, isLoading: paymentHistoryLoading } = useQuery<PaymentHistoryItem[]>({
    queryKey: ['payment_history', expandedUserId],
    enabled: !!expandedUserId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_user_payment_history', {
        p_user_id: expandedUserId,
      });
      if (error) throw error;
      return (data ?? []) as PaymentHistoryItem[];
    },
  });

  const unblockMutation = useMutation({
    mutationFn: async (userId: string) => {
      const now = new Date();
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const y = endOfMonth.getFullYear();
      const m = String(endOfMonth.getMonth() + 1).padStart(2, '0');
      const d = String(endOfMonth.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;

      const { error } = await supabase
        .from('profiles')
        .update({ late_cancel_unblocked_until: dateStr })
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin_users_late_cancellations'] });
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const setManualBlockMutation = useMutation({
    mutationFn: async ({ userId, blocked }: { userId: string; blocked: boolean }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ is_manually_blocked: blocked })
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin_users_late_cancellations'] });
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async ({ userId, amount, note }: { userId: string; amount: number; note: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('payments_received').insert({
        user_id: userId,
        amount,
        note: note.trim() || null,
        recorded_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin_users_late_cancellations'] });
      queryClient.invalidateQueries({ queryKey: ['payment_history', expandedUserId] });
      setRecordingPaymentFor(null);
      setPaymentAmount('');
      setPaymentNote('');
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const confirmCashItemMutation = useMutation({
    mutationFn: async (item: UnconfirmedCashSessionItem) => {
      if (item.source_type === 'membership') {
        const { error } = await supabase.rpc('confirm_cash_membership', { p_membership_id: item.source_id });
        if (error) throw error;
      } else if (item.source_type === 'block') {
        const { error } = await supabase.rpc('confirm_cash_block_payment', { p_block_id: item.source_id });
        if (error) throw error;
      } else {
        throw new Error(`Cash confirmation not supported for "${item.source_type}".`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin_users_late_cancellations'] });
      queryClient.invalidateQueries({ queryKey: ['unconfirmed_cash_sessions', expandedUserId] });
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  function handleConfirmCashItem(item: UnconfirmedCashSessionItem, userName: string) {
    Alert.alert(
      'Confirm Cash Payment',
      `Mark ${userName}'s ${item.description.toLowerCase()} (${formatGBP(item.amount)}) as paid in cash?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => confirmCashItemMutation.mutate(item) },
      ],
    );
  }

  function handleUnblock(user: UserWithLateCancellations) {
    Alert.alert(
      'Unblock User',
      `Allow ${user.full_name} to book classes for the rest of this month? They still have ${user.late_cancellation_count} late cancellations recorded.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unblock', onPress: () => unblockMutation.mutate(user.user_id) },
      ],
    );
  }

  function handleToggleManualBlock(user: UserWithLateCancellations) {
    const next = !user.is_manually_blocked;
    Alert.alert(
      next ? 'Block User' : 'Remove Manual Block',
      next
        ? `Block ${user.full_name} from booking any classes or 1-to-1s? They will not be able to book until you unblock them.`
        : `Remove the manual block on ${user.full_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: next ? 'Block' : 'Remove Block',
          style: next ? 'destructive' : 'default',
          onPress: () => setManualBlockMutation.mutate({ userId: user.user_id, blocked: next }),
        },
      ],
    );
  }

  function handleSubmitPayment() {
    if (!recordingPaymentFor) return;
    const pence = parsePoundsToPence(paymentAmount);
    if (pence === null || pence <= 0) {
      Alert.alert('Invalid amount', 'Enter an amount in pounds, e.g. 12.50.');
      return;
    }
    if (pence > recordingPaymentFor.owed_amount) {
      Alert.alert(
        'Amount exceeds owed',
        `${recordingPaymentFor.full_name} owes ${formatGBP(recordingPaymentFor.owed_amount)}. Enter that or less.`,
      );
      return;
    }
    recordPaymentMutation.mutate({
      userId: recordingPaymentFor.user_id,
      amount: pence,
      note: paymentNote,
    });
  }

  function formatMembership(user: UserWithLateCancellations): string {
    if (!user.membership_tier) return 'No membership';
    const tierLabel = user.membership_tier === 'two_per_week' ? '2x/week' : 'Unlimited';
    const statusLabel = user.membership_status === 'cancelling' ? ' (cancelling)' : '';
    return `${tierLabel}${statusLabel}`;
  }

  function toggleExpand(userId: string) {
    setExpandedUserId(prev => prev === userId ? null : userId);
  }

  return (
    <>
      <FlatList
        data={users ?? []}
        keyExtractor={(item) => item.user_id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={COLORS.accent} />}
        renderItem={({ item }) => {
          const isExpanded = expandedUserId === item.user_id;
          const lateCancelBlocked = item.is_blocked && !item.is_manually_blocked;
          return (
            <TouchableOpacity onPress={() => toggleExpand(item.user_id)} activeOpacity={0.7}>
              <Card style={styles.userCard}>
                <View style={styles.userRow}>
                  <View style={styles.userInfo}>
                    <Text style={styles.userName}>{item.full_name}</Text>
                    <Text style={styles.userMeta}>
                      {item.role} · {formatMembership(item)}
                    </Text>
                    {item.owed_amount > 0 && (
                      <Text style={styles.userOwed}>Owes {formatGBP(item.owed_amount)}</Text>
                    )}
                  </View>
                  <View style={styles.userRight}>
                    {item.late_cancellation_count > 0 && (
                      <Text style={[
                        styles.userCancelCount,
                        item.late_cancellation_count >= 3 && styles.userCancelCountBlocked,
                      ]}>
                        {item.late_cancellation_count}
                      </Text>
                    )}
                    {item.is_blocked && <Badge label="Blocked" variant="error" />}
                  </View>
                </View>

                {isExpanded && (
                  <View style={styles.expandedSection}>
                    <View style={styles.actionsRow}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onPress={() => setRecordingPaymentFor(item)}
                        style={{ flex: 1 }}
                      >
                        Record Payment
                      </Button>
                      <Button
                        variant={item.is_manually_blocked ? 'secondary' : 'danger'}
                        size="sm"
                        onPress={() => handleToggleManualBlock(item)}
                        loading={setManualBlockMutation.isPending}
                        style={{ flex: 1 }}
                      >
                        {item.is_manually_blocked ? 'Remove Block' : 'Block User'}
                      </Button>
                    </View>

                    {lateCancelBlocked && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onPress={() => handleUnblock(item)}
                        loading={unblockMutation.isPending}
                        style={styles.unblockButton}
                      >
                        Unblock for Late Cancellations
                      </Button>
                    )}

                    <Text style={styles.expandedHeading}>
                      Owed {item.owed_amount > 0 ? formatGBP(item.owed_amount) : '£0.00'}
                    </Text>
                    {unconfirmedLoading && <ActivityIndicator color={COLORS.accent} style={{ marginTop: 8 }} />}
                    {!unconfirmedLoading && !paymentHistoryLoading
                      && (unconfirmedSessions ?? []).length === 0
                      && (paymentHistory ?? []).length === 0 && (
                      <Text style={styles.noHistory}>No outstanding cash payments.</Text>
                    )}
                    {!unconfirmedLoading && (unconfirmedSessions ?? []).length > 0 && (
                      <Text style={styles.subHeading}>Unconfirmed Cash Sessions</Text>
                    )}
                    {!unconfirmedLoading && (unconfirmedSessions ?? []).map((b) => (
                      <View key={`${b.source_type}-${b.source_id}`} style={styles.historyRow}>
                        <View style={styles.owedRowTop}>
                          <Text style={styles.historyClass}>{b.description}</Text>
                          <Text style={styles.owedAmount}>{formatGBP(b.amount)}</Text>
                        </View>
                        <Text style={styles.historyDate}>
                          {b.source_type === 'membership'
                            ? `Membership · started ${new Date(b.session_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                            : b.source_type === 'block'
                              ? `Block · purchased ${new Date(b.session_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                              : `${b.source_type === 'one_to_one' ? '1-to-1' : 'Class'} · ${new Date(b.session_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`}
                        </Text>
                        {(b.source_type === 'membership' || b.source_type === 'block') && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onPress={() => handleConfirmCashItem(b, item.full_name)}
                            loading={confirmCashItemMutation.isPending}
                            style={styles.confirmCashButton}
                          >
                            Confirm Cash Received
                          </Button>
                        )}
                      </View>
                    ))}
                    {(paymentHistory ?? []).length > 0 && (
                      <>
                        <Text style={[styles.expandedHeading, { marginTop: 16 }]}>Payments Recorded</Text>
                        {(paymentHistory ?? []).map((p) => (
                          <View key={p.id} style={styles.historyRow}>
                            <View style={styles.owedRowTop}>
                              <Text style={styles.historyClass}>
                                {p.note ?? 'Cash received'}
                              </Text>
                              <Text style={styles.paymentAmount}>−{formatGBP(p.amount)}</Text>
                            </View>
                            <Text style={styles.historyDate}>
                              {new Date(p.recorded_at).toLocaleDateString('en-GB', {
                                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                              })}
                              {p.recorded_by_name ? ` · by ${p.recorded_by_name}` : ''}
                            </Text>
                          </View>
                        ))}
                      </>
                    )}

                    <Text style={[styles.expandedHeading, { marginTop: 16 }]}>Late Cancellation History</Text>
                    {historyLoading && <ActivityIndicator color={COLORS.accent} style={{ marginTop: 8 }} />}
                    {!historyLoading && (history ?? []).length === 0 && (
                      <Text style={styles.noHistory}>No late cancellations recorded.</Text>
                    )}
                    {!historyLoading && (history ?? []).map((h) => (
                      <View key={h.id} style={styles.historyRow}>
                        <Text style={styles.historyClass}>
                          {h.kind === 'one_to_one' ? '1-to-1 · ' : ''}{h.class_name}
                        </Text>
                        <Text style={styles.historyDate}>
                          {new Date(h.session_date + 'T00:00:00').toLocaleDateString('en-GB', {
                            weekday: 'short', day: 'numeric', month: 'short',
                          })} · {h.session_start_time.slice(0, 5)}
                        </Text>
                        <Text style={styles.historyCancelled}>
                          Cancelled {new Date(h.cancelled_at).toLocaleDateString('en-GB', {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          })}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </Card>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          !isLoading ? (
            <Text style={styles.emptyText}>No users found.</Text>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />

      <SlideUpModal
        visible={!!recordingPaymentFor}
        onDismiss={() => {
          setRecordingPaymentFor(null);
          setPaymentAmount('');
          setPaymentNote('');
        }}
      >
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Record Payment</Text>
          {recordingPaymentFor && (
            <Text style={styles.modalSubtitle}>
              {recordingPaymentFor.full_name} · owes {formatGBP(recordingPaymentFor.owed_amount)}
            </Text>
          )}

          <Text style={styles.fieldLabel}>Amount (£)</Text>
          <TextInput
            style={styles.input}
            value={paymentAmount}
            onChangeText={setPaymentAmount}
            placeholder="0.00"
            keyboardType="decimal-pad"
            placeholderTextColor={COLORS.grey[600]}
          />

          <Text style={styles.fieldLabel}>Note (optional)</Text>
          <TextInput
            style={styles.input}
            value={paymentNote}
            onChangeText={setPaymentNote}
            placeholder="e.g. cash for last 2 sessions"
            placeholderTextColor={COLORS.grey[600]}
          />

          <Button
            variant="primary"
            size="md"
            onPress={handleSubmitPayment}
            loading={recordPaymentMutation.isPending}
          >
            Record
          </Button>
        </View>
      </SlideUpModal>
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  list: { padding: 16, gap: 16 },

  // Tab bar
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.grey[800], marginHorizontal: 16 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.accent },
  tabText: { color: COLORS.grey[400], fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: COLORS.white },

  // Timetable
  daySection: { gap: 10 },
  dayHeading: { color: COLORS.accent, fontSize: 13, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },

  card: { padding: 14 },
  cardName: { color: COLORS.white, fontSize: 15, fontWeight: '700', marginBottom: 3 },
  cardMeta: { color: COLORS.grey[400], fontSize: 13 },
  cardLeader: { color: COLORS.grey[600], fontSize: 12, marginTop: 2 },

  emptyText: { color: COLORS.grey[600], textAlign: 'center', paddingTop: 60, fontSize: 15 },

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

  pickerHeader: { marginBottom: 8 },
  pickerBack: { color: COLORS.accent, fontSize: 15, fontWeight: '600', marginBottom: 12 },
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

  // Users tab
  userCard: { padding: 14 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  userInfo: { flex: 1 },
  userName: { color: COLORS.white, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  userMeta: { color: COLORS.grey[400], fontSize: 13 },
  userOwed: { color: COLORS.error, fontSize: 13, fontWeight: '700', marginTop: 4 },
  userRight: { alignItems: 'flex-end', gap: 4 },
  userCancelCount: { color: COLORS.warning, fontSize: 20, fontWeight: '800' },
  userCancelCountBlocked: { color: COLORS.error },

  expandedSection: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.grey[800] },
  expandedHeading: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  subHeading: { color: COLORS.grey[600], fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 },
  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  unblockButton: { marginBottom: 12, alignSelf: 'flex-start' },
  noHistory: { color: COLORS.grey[600], fontSize: 13 },

  historyRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.grey[800] },
  historyClass: { color: COLORS.white, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  historyDate: { color: COLORS.grey[400], fontSize: 12 },
  historyCancelled: { color: COLORS.grey[600], fontSize: 11, marginTop: 2 },
  owedRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  owedAmount: { color: COLORS.error, fontSize: 14, fontWeight: '700' },
  paymentAmount: { color: COLORS.success, fontSize: 14, fontWeight: '700' },
  confirmCashButton: { alignSelf: 'flex-start', marginTop: 8 },
});
