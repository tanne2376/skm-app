import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AddChildForm } from '@/components/AddChildForm';
import { useAuth } from '@/hooks/useAuth';
import { useAddChild, useChildren, useRemoveChild } from '@/hooks/useChildren';
import { useMyWaivers } from '@/hooks/useWaiver';
import { findAdultWaiver, findChildWaiver, formatUKDate, fromISODate } from '@/lib/waiver';
import { Child, Waiver } from '@/types';

/** The account holder and their children, with each person's waiver status. */
export default function FamilyScreen() {
  const { profile } = useAuth();
  const waiversQuery = useMyWaivers();
  const childrenQuery = useChildren();
  const addChild = useAddChild();
  const removeChild = useRemoveChild();
  const [showAddChild, setShowAddChild] = useState(false);

  if (waiversQuery.isPending || childrenQuery.isPending || waiversQuery.isError || childrenQuery.isError) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Family & Waivers" showBack />
        <View style={styles.centered}>
          {waiversQuery.isError || childrenQuery.isError ? (
            <>
              <Text style={styles.muted}>We couldn’t load your family. Check your connection and try again.</Text>
              <Button variant="primary" size="md" onPress={() => { waiversQuery.refetch(); childrenQuery.refetch(); }}>
                Try Again
              </Button>
            </>
          ) : (
            <ActivityIndicator color={COLORS.accent} size="large" />
          )}
        </View>
      </View>
    );
  }

  const waivers = waiversQuery.data;
  const children = childrenQuery.data;

  function confirmRemove(child: Child) {
    Alert.alert('Remove child', `Remove ${child.full_name} from your account?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeChild.mutate(child.id, { onError: (e: Error) => Alert.alert('Could not remove child', e.message) }),
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Family & Waivers" showBack />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={styles.sectionTitle}>You</Text>
          <PersonRow
            name={profile?.full_name ?? ''}
            detail={findAdultWaiver(waivers) ? undefined : 'Needed before you book a class or 1-to-1 for yourself'}
            waiver={findAdultWaiver(waivers)}
            onSign={() => router.push('/sign-waiver')}
          />
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Children</Text>
          {children.length === 0 && !showAddChild && (
            <Text style={styles.muted}>No children on your account yet.</Text>
          )}
          {children.map((c) => {
            const waiver = findChildWaiver(waivers, c.id);
            return (
              <PersonRow
                key={c.id}
                name={c.full_name}
                detail={`Born ${formatUKDate(fromISODate(c.date_of_birth))}`}
                waiver={waiver}
                onSign={() => router.push({ pathname: '/sign-waiver', params: { childId: c.id } })}
                onRemove={waiver ? undefined : () => confirmRemove(c)}
              />
            );
          })}

          {showAddChild ? (
            <View style={styles.addChild}>
              <AddChildForm
                loading={addChild.isPending}
                onAdd={async (child) => {
                  await addChild.mutateAsync(child);
                  setShowAddChild(false);
                }}
              />
            </View>
          ) : (
            <TouchableOpacity style={styles.addChildLink} onPress={() => setShowAddChild(true)} accessibilityRole="button">
              <Feather name="plus" size={16} color={COLORS.accent} />
              <Text style={styles.addChildText}>Add a child to my account</Text>
            </TouchableOpacity>
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

function PersonRow({
  name, detail, waiver, onSign, onRemove,
}: { name: string; detail?: string; waiver?: Waiver; onSign: () => void; onRemove?: () => void }) {
  return (
    <View style={styles.personRow}>
      <View style={styles.flex}>
        <Text style={styles.personName}>{name}</Text>
        {detail && <Text style={styles.personDetail}>{detail}</Text>}
        {waiver ? (
          <Text style={styles.signed}>Waiver signed {formatUKDate(new Date(waiver.signed_at))}</Text>
        ) : (
          <Text style={styles.unsigned}>Waiver not signed</Text>
        )}
      </View>
      <View style={styles.actions}>
        {waiver ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={() => router.push({ pathname: '/(app)/settings/waiver', params: { id: waiver.id } })}
            accessibilityLabel={`View waiver for ${name}`}
          >
            View
          </Button>
        ) : (
          <Button variant="primary" size="sm" onPress={onSign} accessibilityLabel={`Sign waiver for ${name}`}>
            Sign
          </Button>
        )}
        {onRemove && (
          <TouchableOpacity onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${name}`}>
            <Feather name="trash-2" size={18} color={COLORS.grey[500]} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  flex: { flex: 1, gap: 2 },
  muted: { color: COLORS.grey[400], fontSize: 14, textAlign: 'center' },
  sectionTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.grey[800] },
  personName: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  personDetail: { color: COLORS.grey[400], fontSize: 13 },
  signed: { color: COLORS.success, fontSize: 13, fontWeight: '600' },
  unsigned: { color: COLORS.warning, fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  addChild: { marginTop: 12 },
  addChildLink: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 14 },
  addChildText: { color: COLORS.accent, fontSize: 15, fontWeight: '600' },
});
