import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { COLORS } from '@/constants';
import { SlideUpModal } from '@/components/ui/SlideUpModal';
import { supabase } from '@/lib/supabase';
import { formatUKDate, fromISODate } from '@/lib/waiver';
import { Child, Profile, Waiver } from '@/types';

type WaiverSummary = Pick<
  Waiver,
  | 'id' | 'child_id' | 'child_name' | 'child_date_of_birth' | 'guardian_relationship'
  | 'emergency_contact_name' | 'emergency_contact_phone' | 'photo_consent' | 'signed_at'
>;

interface UserDetails extends Pick<Profile, 'id' | 'full_name' | 'phone' | 'role' | 'created_at'> {
  email: string | null;
  children: Pick<Child, 'id' | 'full_name' | 'date_of_birth'>[];
  waivers: WaiverSummary[];
}

/** Round "default account picture" button that opens the details sheet. */
export function UserAvatarButton({ onPress, name }: { onPress: () => void; name: string }) {
  return (
    <TouchableOpacity
      style={styles.avatarButton}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`View details for ${name}`}
    >
      <Feather name="user" size={18} color={COLORS.accent} />
    </TouchableOpacity>
  );
}

interface UserDetailsSheetProps {
  userId: string | null;
  /** Shown in the header while the details load. */
  fallbackName?: string;
  /** Already known by the caller (e.g. "Unlimited (active)"). */
  membershipLabel?: string;
  onDismiss: () => void;
}

/** Admin view of one user: contact details, children and each person's waiver. */
export function UserDetailsSheet({ userId, fallbackName, membershipLabel, onDismiss }: UserDetailsSheetProps) {
  const { data, isPending, isError, refetch } = useQuery<UserDetails | null>({
    queryKey: ['admin_user_details', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_user_details', { p_user_id: userId });
      if (error) throw error;
      return data as UserDetails | null;
    },
  });

  // The account holder first, then each child, each with their waiver (if any).
  const people = data
    ? [
        { key: 'self', name: data.full_name, dob: null as string | null, waiver: data.waivers.find((w) => !w.child_id) },
        ...data.children.map((c) => ({
          key: c.id, name: c.full_name, dob: c.date_of_birth, waiver: data.waivers.find((w) => w.child_id === c.id),
        })),
      ]
    : [];

  return (
    <SlideUpModal visible={!!userId} onDismiss={onDismiss} maxHeight="85%">
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={styles.avatarLarge}>
            <Feather name="user" size={28} color={COLORS.accent} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.name}>{data?.full_name ?? fallbackName}</Text>
            {data && <Text style={styles.meta}>{data.role} · joined {formatUKDate(new Date(data.created_at))}</Text>}
          </View>
        </View>

        {isError ? (
          <View style={styles.centered}>
            <Text style={styles.muted}>Couldn’t load this user’s details.</Text>
            <TouchableOpacity onPress={() => refetch()} accessibilityRole="button">
              <Text style={styles.link}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : isPending || !data ? (
          <View style={styles.centered}>
            {isPending ? <ActivityIndicator color={COLORS.accent} /> : <Text style={styles.muted}>User not found.</Text>}
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.heading}>Contact</Text>
            <Row label="Email" value={data.email ?? '—'} onPress={data.email ? () => open(`mailto:${data.email}`) : undefined} />
            <Row label="Phone" value={data.phone ?? '—'} onPress={data.phone ? () => open(`tel:${data.phone}`) : undefined} />
            {membershipLabel && <Row label="Membership" value={membershipLabel} />}

            {people.map((person) => (
              <View key={person.key}>
                <Text style={[styles.heading, styles.headingSpaced]}>
                  {person.key === 'self' ? 'Waiver' : `Child: ${person.name}`}
                </Text>
                {person.dob && <Row label="Date of birth" value={formatUKDate(fromISODate(person.dob))} />}
                {person.waiver ? (
                  <>
                    <Row
                      label="Emergency contact"
                      value={person.waiver.emergency_contact_name}
                    />
                    <Row
                      label="Emergency phone"
                      value={person.waiver.emergency_contact_phone}
                      onPress={() => open(`tel:${person.waiver!.emergency_contact_phone}`)}
                    />
                    {person.waiver.guardian_relationship && (
                      <Row label="Parent/guardian" value={`${data.full_name} (${person.waiver.guardian_relationship})`} />
                    )}
                    <Row label="Photo consent" value={person.waiver.photo_consent ? 'Yes' : 'No'} />
                    <Row label="Signed" value={formatUKDate(new Date(person.waiver.signed_at))} />
                  </>
                ) : (
                  <Text style={styles.unsigned}>
                    {person.key === 'self' && data.children.length > 0
                      ? 'Not signed (only needed if they train)'
                      : 'Waiver not signed'}
                  </Text>
                )}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </SlideUpModal>
  );
}

function open(url: string) {
  Linking.openURL(url).catch(() => Alert.alert('Error', 'Unable to open this link.'));
}

function Row({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const text = <Text style={[styles.rowValue, onPress && styles.link]}>{value}</Text>;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {onPress ? (
        <TouchableOpacity onPress={onPress} accessibilityRole="link" style={styles.rowValueWrap}>{text}</TouchableOpacity>
      ) : (
        <View style={styles.rowValueWrap}>{text}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatarButton: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.grey[800],
    borderWidth: 1.5, borderColor: COLORS.accent, alignItems: 'center', justifyContent: 'center',
  },
  sheet: {
    backgroundColor: COLORS.grey[900],
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderColor: COLORS.grey[800],
    padding: 20, paddingBottom: 40, gap: 12, flexShrink: 1,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.grey[700], alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarLarge: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.grey[800],
    borderWidth: 1.5, borderColor: COLORS.accent, alignItems: 'center', justifyContent: 'center',
  },
  flex: { flex: 1 },
  name: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  meta: { color: COLORS.grey[400], fontSize: 13, marginTop: 2, textTransform: 'capitalize' },
  centered: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  muted: { color: COLORS.grey[400], fontSize: 14 },
  content: { paddingBottom: 24 },
  heading: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  headingSpaced: { marginTop: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.grey[800] },
  rowLabel: { color: COLORS.grey[400], fontSize: 14 },
  rowValueWrap: { flexShrink: 1 },
  rowValue: { color: COLORS.white, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  link: { color: COLORS.accent },
  unsigned: { color: COLORS.warning, fontSize: 14, fontWeight: '600', paddingVertical: 10 },
});
