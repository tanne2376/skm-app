import { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, Alert, TouchableOpacity, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SlideUpModal } from '@/components/ui/SlideUpModal';
import { formatGBP } from '@/lib/stripe';
import { BlockTemplate } from '@/types';
import {
  useBlockTemplates,
  useCreateBlockTemplate,
  useUpdateBlockTemplate,
  useDeactivateBlockTemplate,
} from '@/hooks/useBlockTemplates';

function parsePoundsToPence(value: string): number | null {
  const m = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const pounds = Number(m[1]);
  const fractional = (m[2] ?? '').padEnd(2, '0');
  return pounds * 100 + Number(fractional);
}

function parsePositiveInt(value: string): number | null {
  const m = value.trim().match(/^(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

export default function BlocksScreen() {
  const insets = useSafeAreaInsets();
  const { data: templates, isLoading, refetch } = useBlockTemplates({ activeOnly: false });

  const createMutation = useCreateBlockTemplate();
  const updateMutation = useUpdateBlockTemplate();
  const deactivateMutation = useDeactivateBlockTemplate();

  const [modal, setModal] = useState<'add' | BlockTemplate | null>(null);
  const [name, setName] = useState('');
  const [sessions, setSessions] = useState('');
  const [neverExpires, setNeverExpires] = useState(false);
  const [validityDays, setValidityDays] = useState('');
  const [price, setPrice] = useState('');

  function openAdd() {
    setName('');
    setSessions('');
    setNeverExpires(false);
    setValidityDays('');
    setPrice('');
    setModal('add');
  }

  function openEdit(t: BlockTemplate) {
    setName(t.name);
    setSessions(String(t.sessions_count));
    setNeverExpires(t.validity_days === null);
    setValidityDays(t.validity_days === null ? '' : String(t.validity_days));
    setPrice((t.price_pence / 100).toFixed(2));
    setModal(t);
  }

  function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) return Alert.alert('Error', 'Name cannot be empty.');
    const sessionsCount = parsePositiveInt(sessions);
    if (sessionsCount === null) return Alert.alert('Error', 'Sessions must be a positive number.');
    let validity: number | null = null;
    if (!neverExpires) {
      validity = parsePositiveInt(validityDays);
      if (validity === null) return Alert.alert('Error', 'Validity must be a positive number of days.');
    }
    const pricePence = parsePoundsToPence(price);
    if (pricePence === null) return Alert.alert('Error', 'Price must be a valid amount, e.g. 60 or 60.00.');

    const input = {
      name: trimmedName,
      sessions_count: sessionsCount,
      validity_days: validity,
      price_pence: pricePence,
    };

    if (modal === 'add') {
      createMutation.mutate(input, { onSuccess: () => setModal(null) });
    } else if (modal) {
      updateMutation.mutate(
        { id: modal.id, patch: input },
        { onSuccess: () => setModal(null) },
      );
    }
  }

  function confirmDeactivate(t: BlockTemplate) {
    if (t.is_active) {
      Alert.alert(
        'Deactivate Block',
        `Hide "${t.name}" from new purchases? Existing blocks already purchased keep working.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Deactivate', style: 'destructive', onPress: () => deactivateMutation.mutate(t.id) },
        ],
      );
    } else {
      updateMutation.mutate({ id: t.id, patch: { is_active: true } });
    }
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="Manage Blocks" showBack />

      <FlatList
        data={templates ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={refetch}
        ListHeaderComponent={
          <Button variant="secondary" size="md" onPress={openAdd} style={styles.addButton}>
            + Add Block
          </Button>
        }
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <View style={styles.cardRow}>
              <View style={styles.flex}>
                <View style={styles.nameRow}>
                  <Text style={[styles.name, !item.is_active && styles.nameInactive]}>{item.name}</Text>
                  {!item.is_active && <Text style={styles.inactiveBadge}>Inactive</Text>}
                </View>
                <Text style={styles.detail}>
                  {item.sessions_count} session{item.sessions_count === 1 ? '' : 's'} ·{' '}
                  {item.validity_days === null ? 'Never expires' : `Valid for ${item.validity_days} days`}
                </Text>
                <Text style={styles.price}>{formatGBP(item.price_pence)}</Text>
              </View>
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => openEdit(item)}>
                  <Text style={styles.actionEdit}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => confirmDeactivate(item)}>
                  <Text style={[styles.actionToggle, !item.is_active && styles.actionActivate]}>
                    {item.is_active ? 'Deactivate' : 'Activate'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Card>
        )}
        ListEmptyComponent={
          !isLoading ? (
            <Text style={styles.emptyText}>No blocks yet. Add one to make blocks available for purchase.</Text>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />

      <SlideUpModal visible={modal !== null} onDismiss={() => setModal(null)}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{modal === 'add' ? 'Add Block' : 'Edit Block'}</Text>

          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. 5 sessions in 30 days"
            placeholderTextColor={COLORS.grey[600]}
          />

          <Text style={styles.fieldLabel}>Number of Sessions</Text>
          <TextInput
            style={styles.input}
            value={sessions}
            onChangeText={setSessions}
            placeholder="e.g. 5"
            placeholderTextColor={COLORS.grey[600]}
            keyboardType="number-pad"
          />

          <View style={styles.toggleRow}>
            <Text style={styles.fieldLabel}>Never Expires</Text>
            <Switch
              value={neverExpires}
              onValueChange={setNeverExpires}
              trackColor={{ false: COLORS.grey[700], true: COLORS.accent }}
              thumbColor={COLORS.white}
            />
          </View>

          {!neverExpires && (
            <>
              <Text style={styles.fieldLabel}>Valid For (days)</Text>
              <TextInput
                style={styles.input}
                value={validityDays}
                onChangeText={setValidityDays}
                placeholder="e.g. 30"
                placeholderTextColor={COLORS.grey[600]}
                keyboardType="number-pad"
              />
            </>
          )}

          <Text style={styles.fieldLabel}>Price (£)</Text>
          <TextInput
            style={styles.input}
            value={price}
            onChangeText={setPrice}
            placeholder="e.g. 60 or 60.00"
            placeholderTextColor={COLORS.grey[600]}
            keyboardType="decimal-pad"
          />

          <Button
            variant="primary"
            size="md"
            onPress={handleSave}
            loading={createMutation.isPending || updateMutation.isPending}
          >
            Save
          </Button>
        </View>
      </SlideUpModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  list: { padding: 16 },
  addButton: { marginBottom: 16 },
  card: { padding: 14 },
  cardRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  flex: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  nameInactive: { color: COLORS.grey[600] },
  inactiveBadge: { color: COLORS.grey[600], fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  detail: { color: COLORS.grey[400], fontSize: 13 },
  price: { color: COLORS.accent, fontSize: 14, fontWeight: '700', marginTop: 2 },
  actions: { alignItems: 'flex-end', gap: 8 },
  actionEdit: { color: COLORS.accent, fontSize: 14, fontWeight: '600' },
  actionToggle: { color: COLORS.grey[600], fontSize: 14, fontWeight: '600' },
  actionActivate: { color: COLORS.accent },
  emptyText: { color: COLORS.grey[600], textAlign: 'center', paddingTop: 60, fontSize: 15, paddingHorizontal: 30 },
  modalSheet: {
    backgroundColor: COLORS.grey[900],
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderColor: COLORS.grey[800],
    padding: 20, paddingBottom: 40,
  },
  modalHandle: { width: 36, height: 4, backgroundColor: COLORS.grey[700], borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700', marginBottom: 16 },
  fieldLabel: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  input: { backgroundColor: COLORS.grey[800], borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.white, fontSize: 15, borderWidth: 1, borderColor: COLORS.grey[700], marginBottom: 12 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
});
