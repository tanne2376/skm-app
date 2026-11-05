import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SvgXml } from 'react-native-svg';
import { COLORS } from '@/constants';
import {
  WAIVER_FOOTER, WAIVER_GUARDIAN_STATEMENT, WAIVER_PHOTO_CONSENT, WAIVER_PHOTO_CONSENT_CHILD,
} from '@/constants/waiver';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { WaiverText, waiverTextStyles } from '@/components/WaiverText';
import { useMyWaivers } from '@/hooks/useWaiver';
import { formatUKDate, fromISODate } from '@/lib/waiver';

/** Read-only copy of one signed waiver on the account (`?id=`). */
export default function ViewWaiverScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: waivers, isPending } = useMyWaivers();
  const waiver = waivers?.find((w) => w.id === id);
  const title = waiver?.for_child ? `Waiver: ${waiver.child_name}` : 'My Waiver';

  if (isPending || !waiver) {
    return (
      <View style={styles.container}>
        <ScreenHeader title={title} showBack />
        <View style={styles.centered}>
          {isPending ? (
            <ActivityIndicator color={COLORS.accent} size="large" />
          ) : (
            <Text style={styles.muted}>No signed waiver found.</Text>
          )}
        </View>
      </View>
    );
  }

  const signedOn = formatUKDate(new Date(waiver.signed_at));

  return (
    <View style={styles.container}>
      <ScreenHeader title={title} showBack />
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.signedBanner}>Signed on {signedOn}</Text>
        </Card>

        <Card>
          <WaiverText />
        </Card>

        {waiver.for_child && (
          <Card>
            <Text style={waiverTextStyles.heading}>Signed On Behalf Of A Child</Text>
            <Text style={waiverTextStyles.body}>{WAIVER_GUARDIAN_STATEMENT}</Text>
            <Detail label="Child" value={waiver.child_name ?? ''} />
            <Detail
              label="Date of birth"
              value={waiver.child_date_of_birth ? formatUKDate(fromISODate(waiver.child_date_of_birth)) : ''}
            />
            <Detail label="Relationship" value={waiver.guardian_relationship ?? ''} />
          </Card>
        )}

        <Card>
          <Text style={waiverTextStyles.heading}>Emergency Contact</Text>
          <Detail label="Name" value={waiver.emergency_contact_name} />
          <Detail label="Phone" value={waiver.emergency_contact_phone} />
        </Card>

        <Card>
          <Text style={waiverTextStyles.heading}>Optional Photo / Video Consent</Text>
          <Text style={waiverTextStyles.body}>
            {waiver.for_child ? WAIVER_PHOTO_CONSENT_CHILD : WAIVER_PHOTO_CONSENT}
          </Text>
          <Detail label="Answer" value={waiver.photo_consent ? 'Yes' : 'No'} />
        </Card>

        <Card>
          <Text style={waiverTextStyles.heading}>Signature</Text>
          <Detail label={waiver.for_child ? 'Parent/guardian' : 'Signed by'} value={waiver.signer_name} />
          <View style={styles.signatureBox}>
            <SvgXml xml={waiver.signature} width="100%" height="100%" />
          </View>
          <Detail label="Date" value={signedOn} />
        </Card>

        <Text style={styles.footer}>{WAIVER_FOOTER}</Text>
      </ScrollView>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  muted: { color: COLORS.grey[400], fontSize: 15 },
  signedBanner: { color: COLORS.success, fontSize: 15, fontWeight: '700' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.grey[800] },
  detailLabel: { color: COLORS.grey[400], fontSize: 14 },
  detailValue: { color: COLORS.white, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  signatureBox: { marginTop: 12, height: 160, backgroundColor: COLORS.white, borderRadius: 8, overflow: 'hidden' },
  footer: { color: COLORS.grey[500], fontSize: 13, textAlign: 'center' },
});
