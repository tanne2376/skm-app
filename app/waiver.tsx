import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AddChildForm } from '@/components/AddChildForm';
import { EmergencyContact, WaiverForm } from '@/components/WaiverForm';
import { useAuth } from '@/hooks/useAuth';
import { useAddChild, useChildren } from '@/hooks/useChildren';
import { useMyWaivers } from '@/hooks/useWaiver';
import { findAdultWaiver, findChildWaiver, formatUKDate, fromISODate } from '@/lib/waiver';
import { Child } from '@/types';

/**
 * First-run waiver. AuthGuard keeps signed-in, verified users here until the
 * account has at least one waiver. They pick who's training — their children
 * (ticked by default) and/or themselves — then sign one waiver per person.
 * A parent who doesn't train needn't sign for themselves until they book.
 */
export default function WaiverScreen() {
  const { profile, signOut } = useAuth();
  const waiversQuery = useMyWaivers();
  const childrenQuery = useChildren();
  const addChild = useAddChild();

  // Children are ticked unless the parent unticks them, so ones added here
  // (or on the register screen) start ticked.
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [meTraining, setMeTraining] = useState<boolean | null>(null); // null = default
  const [showAddChild, setShowAddChild] = useState(false);
  // Signing queue: a Child, or null for the account holder.
  const [queue, setQueue] = useState<(Child | null)[] | null>(null);
  const [position, setPosition] = useState(0);
  const [emergency, setEmergency] = useState<EmergencyContact>();

  function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  }

  const header = (
    <ScreenHeader
      title="Waiver"
      rightElement={
        <TouchableOpacity onPress={handleSignOut} accessibilityRole="button" accessibilityLabel="Sign out" hitSlop={8}>
          <Feather name="log-out" size={20} color={COLORS.accent} />
        </TouchableOpacity>
      }
    />
  );

  if (waiversQuery.isError || childrenQuery.isError) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.centered}>
          <Text style={styles.errorText}>We couldn’t check your waiver. Check your connection and try again.</Text>
          <Button
            variant="primary"
            size="md"
            onPress={() => { waiversQuery.refetch(); childrenQuery.refetch(); }}
            loading={waiversQuery.isFetching || childrenQuery.isFetching}
          >
            Try Again
          </Button>
        </View>
      </View>
    );
  }

  if (waiversQuery.isPending || childrenQuery.isPending) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.accent} size="large" />
        </View>
      </View>
    );
  }

  const waivers = waiversQuery.data;
  const children = childrenQuery.data;

  if (queue) {
    const person = queue[position];
    return (
      <View style={styles.container}>
        {header}
        <WaiverForm
          key={person?.id ?? 'me'}
          child={person}
          signerName={profile?.full_name ?? ''}
          initialEmergency={emergency}
          progress={{ index: position, total: queue.length }}
          intro={position === 0 ? 'Please read and sign the club’s participation acknowledgment. You only need to do this once per person.' : undefined}
          submitLabel={position + 1 < queue.length ? 'Sign & Continue' : 'Sign Waiver'}
          onSigned={(e) => {
            setEmergency(e);
            if (position + 1 < queue.length) setPosition(position + 1);
            else router.replace('/(app)/home');
          }}
        />
      </View>
    );
  }

  const unsignedChildren = children.filter((c) => !findChildWaiver(waivers, c.id));
  const adultSigned = !!findAdultWaiver(waivers);
  const meTicked = !adultSigned && (meTraining ?? children.length === 0);
  const tickedChildren = unsignedChildren.filter((c) => !unticked.has(c.id));

  function toggleChild(id: string) {
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleContinue() {
    const next: (Child | null)[] = [...tickedChildren, ...(meTicked ? [null] : [])];
    if (next.length === 0) {
      Alert.alert('Who’s training?', 'Tick at least one person to sign the waiver for.');
      return;
    }
    setPosition(0);
    setQueue(next);
  }

  return (
    <View style={styles.container}>
      {header}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={styles.intro}>
            Before you can use the app, everyone who trains needs a signed participation waiver. Tick who’s training on this account.
          </Text>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Who’s training?</Text>
          {children.map((c) => {
            const signed = !!findChildWaiver(waivers, c.id);
            return (
              <CheckRow
                key={c.id}
                label={c.full_name}
                hint={signed ? 'Waiver signed' : `Born ${formatUKDate(fromISODate(c.date_of_birth))} · you’ll sign as their parent/guardian`}
                checked={signed || !unticked.has(c.id)}
                disabled={signed}
                onPress={() => toggleChild(c.id)}
              />
            );
          })}
          <CheckRow
            label={children.length > 0 ? 'I am training too' : 'I am training'}
            hint={adultSigned ? 'Waiver signed' : `Sign for yourself, ${profile?.full_name ?? ''}`}
            checked={adultSigned || meTicked}
            disabled={adultSigned}
            onPress={() => setMeTraining(!meTicked)}
          />

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
            <TouchableOpacity
              style={styles.addChildLink}
              onPress={() => setShowAddChild(true)}
              accessibilityRole="button"
            >
              <Feather name="plus" size={16} color={COLORS.accent} />
              <Text style={styles.addChildText}>Add a child to my account</Text>
            </TouchableOpacity>
          )}
        </Card>

        {/* Reached with nothing left to sign (e.g. finished on another device). */}
        {waivers.length > 0 && tickedChildren.length === 0 && !meTicked ? (
          <Button variant="primary" size="lg" onPress={() => router.replace('/(app)/home')}>
            Continue to App
          </Button>
        ) : (
          <Button variant="primary" size="lg" onPress={handleContinue}>
            Continue
          </Button>
        )}
      </ScrollView>
    </View>
  );
}

function CheckRow({
  label, hint, checked, disabled, onPress,
}: { label: string; hint: string; checked: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.checkboxRow}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
    >
      <View style={[styles.checkbox, checked && styles.checkboxChecked, disabled && styles.checkboxDisabled]}>
        {checked && <Feather name="check" size={16} color={COLORS.white} />}
      </View>
      <View style={styles.flex}>
        <Text style={styles.checkboxLabel}>{label}</Text>
        <Text style={styles.checkboxHint}>{hint}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 },
  flex: { flex: 1 },
  errorText: { color: COLORS.grey[300], fontSize: 15, textAlign: 'center' },
  intro: { color: COLORS.white, fontSize: 15, lineHeight: 22 },
  sectionTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.grey[800] },
  checkbox: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: COLORS.grey[600], alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  checkboxDisabled: { opacity: 0.5 },
  checkboxLabel: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  checkboxHint: { color: COLORS.grey[400], fontSize: 13, marginTop: 2 },
  addChild: { marginTop: 12 },
  addChildLink: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 14 },
  addChildText: { color: COLORS.accent, fontSize: 15, fontWeight: '600' },
});
