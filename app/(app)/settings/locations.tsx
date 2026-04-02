import { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, Alert, TouchableOpacity } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SlideUpModal } from '@/components/ui/SlideUpModal';
import { supabase } from '@/lib/supabase';

interface Location {
  id: string;
  name: string;
  address: string;
  is_active: boolean;
}

export default function LocationsScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [modal, setModal] = useState<'add' | Location | null>(null);
  const [locName, setLocName] = useState('');
  const [locAddress, setLocAddress] = useState('');

  const { data: locations, isLoading, refetch } = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, address, is_active')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Location[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!locName.trim()) throw new Error('Name cannot be empty.');
      if (!locAddress.trim()) throw new Error('Address cannot be empty.');
      if (modal === 'add') {
        const { error } = await supabase
          .from('locations')
          .insert({ name: locName.trim(), address: locAddress.trim() });
        if (error) throw error;
      } else if (modal) {
        const { error } = await supabase
          .from('locations')
          .update({ name: locName.trim(), address: locAddress.trim() })
          .eq('id', modal.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      setModal(null);
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('locations').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['locations'] }),
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  function openAdd() {
    setLocName('');
    setLocAddress('');
    setModal('add');
  }

  function openEdit(loc: Location) {
    setLocName(loc.name);
    setLocAddress(loc.address);
    setModal(loc);
  }

  function confirmToggle(loc: Location) {
    Alert.alert(
      loc.is_active ? 'Deactivate Location' : 'Activate Location',
      loc.is_active
        ? `Hide "${loc.name}" from future session creation?`
        : `Make "${loc.name}" available again?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: loc.is_active ? 'Deactivate' : 'Activate',
          style: loc.is_active ? 'destructive' : 'default',
          onPress: () => toggleMutation.mutate({ id: loc.id, is_active: !loc.is_active }),
        },
      ],
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="Locations" showBack />

      <FlatList
        data={locations ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={isLoading}
        onRefresh={refetch}
        ListHeaderComponent={
          <Button variant="secondary" size="md" onPress={openAdd} style={styles.addButton}>
            + Add Location
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
                <Text style={styles.address}>{item.address}</Text>
              </View>
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => openEdit(item)}>
                  <Text style={styles.actionEdit}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => confirmToggle(item)}>
                  <Text style={[styles.actionToggle, !item.is_active && styles.actionActivate]}>
                    {item.is_active ? 'Deactivate' : 'Activate'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Card>
        )}
        ListEmptyComponent={
          !isLoading ? <Text style={styles.emptyText}>No locations yet.</Text> : null
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />

      <SlideUpModal visible={modal !== null} onDismiss={() => setModal(null)}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{modal === 'add' ? 'Add Location' : 'Edit Location'}</Text>

          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            style={styles.input}
            value={locName}
            onChangeText={setLocName}
            placeholder="e.g. SKM Main Gym"
            placeholderTextColor={COLORS.grey[600]}
          />

          <Text style={styles.fieldLabel}>Address</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={locAddress}
            onChangeText={setLocAddress}
            placeholder="Full address"
            placeholderTextColor={COLORS.grey[600]}
            multiline
            numberOfLines={2}
          />

          <Button variant="primary" size="md" onPress={() => saveMutation.mutate()} loading={saveMutation.isPending}>
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
  nameInactive: { color: COLORS.grey[500] },
  inactiveBadge: { color: COLORS.grey[500], fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  address: { color: COLORS.grey[400], fontSize: 13 },
  actions: { alignItems: 'flex-end', gap: 8 },
  actionEdit: { color: COLORS.accent, fontSize: 14, fontWeight: '600' },
  actionToggle: { color: COLORS.grey[500], fontSize: 14, fontWeight: '600' },
  actionActivate: { color: COLORS.accent },
  emptyText: { color: COLORS.grey[600], textAlign: 'center', paddingTop: 60, fontSize: 15 },
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
  inputMultiline: { minHeight: 60, textAlignVertical: 'top' },
});
