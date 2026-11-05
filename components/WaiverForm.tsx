import { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { COLORS } from '@/constants';
import { CURRENT_WAIVER_CONTENT as TEXT, WAIVER_VERSION } from '@/constants/waiver';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SignaturePad } from '@/components/SignaturePad';
import { WaiverText, waiverTextStyles } from '@/components/WaiverText';
import { useAuth } from '@/hooks/useAuth';
import { useSignWaiver } from '@/hooks/useWaiver';
import { formatUKDate, fromISODate, isUnder18 } from '@/lib/waiver';
import { Child } from '@/types';

export interface EmergencyContact {
  name: string;
  phone: string;
}

interface WaiverFormProps {
  /** The child being signed for, or null for the account holder's own waiver. */
  child: Child | null;
  signerName: string;
  /** Prefill, e.g. from the previous waiver signed in the same sitting. */
  initialEmergency?: EmergencyContact;
  /** Shown as "Waiver 2 of 3" when signing for several people in a row. */
  progress?: { index: number; total: number };
  intro?: string;
  submitLabel?: string;
  onSigned: (emergency: EmergencyContact) => void;
}

/**
 * The participation waiver for one person. The account holder always signs;
 * for a child they sign as parent/guardian and the child's name and date of
 * birth come from their `children` row.
 */
export function WaiverForm({
  child, signerName, initialEmergency, progress, intro, submitLabel = 'Sign Waiver', onSigned,
}: WaiverFormProps) {
  const signWaiver = useSignWaiver();
  const { profile } = useAuth();
  // Children are signed before the parent, often with the parent as their
  // emergency contact; that can't carry over to the parent's own waiver.
  const prefill = child === null && initialEmergency?.name === signerName ? undefined : initialEmergency;

  const [relationship, setRelationship] = useState('');
  const [emergencyName, setEmergencyName] = useState(prefill?.name ?? '');
  const [emergencyPhone, setEmergencyPhone] = useState(prefill?.phone ?? '');
  // Child waivers only: the signing parent is the emergency contact. Starts
  // ticked when the previous waiver in this sitting used the parent too.
  const [selfContact, setSelfContact] = useState(
    child !== null && prefill?.name === signerName,
  );

  function toggleSelfContact() {
    const next = !selfContact;
    setSelfContact(next);
    if (next) {
      setEmergencyName(signerName);
      if (!emergencyPhone.trim() && profile?.phone) setEmergencyPhone(profile.phone);
    } else {
      setEmergencyName('');
    }
  }
  const [photoConsent, setPhotoConsent] = useState<boolean | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const today = new Date();
  const forChild = child !== null;

  function handleSubmit() {
    const missing: string[] = [];
    if (forChild && !relationship.trim()) missing.push('Your relationship to the child');
    if (!emergencyName.trim()) missing.push('Emergency contact name');
    if (!emergencyPhone.trim()) missing.push('Emergency contact phone');
    if (photoConsent === null) missing.push('Photo / video consent (Yes or No)');
    if (!signature) missing.push('Signature');

    if (missing.length > 0) {
      Alert.alert('Please complete', missing.join('\n'));
      return;
    }
    if (child && !isUnder18(fromISODate(child.date_of_birth))) {
      Alert.alert(
        `${child.full_name} is 18 or over`,
        'Anyone 18 or over needs to sign the waiver with their own account.',
      );
      return;
    }

    const emergency = { name: emergencyName.trim(), phone: emergencyPhone.trim() };
    signWaiver.mutate(
      {
        child_id: child?.id ?? null,
        waiver_version: WAIVER_VERSION,
        emergency_contact_name: emergency.name,
        emergency_contact_phone: emergency.phone,
        photo_consent: photoConsent!,
        guardian_relationship: forChild ? relationship.trim() : null,
        signature: signature!,
      },
      {
        onSuccess: () => onSigned(emergency),
        onError: (e: Error) => Alert.alert('Could not save waiver', e.message),
      },
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
      >
        <Card>
          {progress && progress.total > 1 && (
            <Text style={styles.progress}>Waiver {progress.index + 1} of {progress.total}</Text>
          )}
          {intro && <Text style={styles.intro}>{intro}</Text>}
          {child ? (
            <>
              <Text style={styles.signingFor}>For {child.full_name}</Text>
              <Text style={styles.signingAs}>
                Born {formatUKDate(fromISODate(child.date_of_birth))} · signed by {signerName} as parent/guardian
              </Text>
            </>
          ) : (
            <Text style={styles.signingFor}>For you: {signerName}</Text>
          )}
        </Card>

        <Card>
          <WaiverText />
        </Card>

        {child && (
          <Card>
            <Text style={waiverTextStyles.heading}>Parent / Guardian</Text>
            <Text style={[waiverTextStyles.body, styles.gapBelow]}>{TEXT.guardianStatement}</Text>
            <Field
              label="Your relationship to the child"
              value={relationship}
              onChangeText={setRelationship}
              autoCapitalize="words"
              placeholder="e.g. Mother"
            />
          </Card>
        )}

        <Card>
          <Text style={waiverTextStyles.heading}>Emergency Contact</Text>
          {child && (
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={toggleSelfContact}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selfContact }}
            >
              <View style={[styles.checkbox, selfContact && styles.checkboxChecked]}>
                {selfContact && <Feather name="check" size={16} color={COLORS.white} />}
              </View>
              <Text style={styles.checkboxLabel}>I am the emergency contact</Text>
            </TouchableOpacity>
          )}
          {selfContact ? (
            <>
              <Text style={styles.fieldLabel}>Name</Text>
              <Text style={styles.lockedValue}>{signerName}</Text>
            </>
          ) : (
            <Field label="Name" value={emergencyName} onChangeText={setEmergencyName} autoCapitalize="words" />
          )}
          <Field
            label="Phone"
            value={emergencyPhone}
            onChangeText={setEmergencyPhone}
            keyboardType="phone-pad"
            placeholder="+44 7700 000000"
          />
        </Card>

        <Card>
          <Text style={waiverTextStyles.heading}>Optional Photo / Video Consent</Text>
          <Text style={waiverTextStyles.body}>
            {forChild ? TEXT.photoConsentChild : TEXT.photoConsent}
          </Text>
          <View style={styles.choiceRow}>
            <Choice label="Yes" selected={photoConsent === true} onPress={() => setPhotoConsent(true)} />
            <Choice label="No" selected={photoConsent === false} onPress={() => setPhotoConsent(false)} />
          </View>
        </Card>

        <Card>
          <Text style={waiverTextStyles.heading}>Signature</Text>
          <Text style={[waiverTextStyles.body, styles.gapBelow]}>
            By signing I confirm I have read and understood this acknowledgment.
          </Text>
          <Text style={styles.fieldLabel}>{forChild ? 'Parent/guardian signature' : 'Your signature'}</Text>
          <SignaturePad
            onChange={setSignature}
            onDrawingChange={(d) => setScrollEnabled(!d)}
            accessibilityLabel="Signature pad"
          />
          <Text style={styles.dateLine}>Date: {formatUKDate(today)}</Text>
        </Card>

        <Text style={styles.footer}>{TEXT.footer}</Text>

        <Button variant="primary" size="lg" onPress={handleSubmit} loading={signWaiver.isPending}>
          {submitLabel}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  ...inputProps
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={COLORS.grey[600]} accessibilityLabel={label} {...inputProps} />
    </>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.choice, selected && styles.choiceSelected]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  progress: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  intro: { color: COLORS.white, fontSize: 15, lineHeight: 22, marginBottom: 10 },
  signingFor: { color: COLORS.accent, fontSize: 16, fontWeight: '700' },
  signingAs: { color: COLORS.grey[400], fontSize: 13, marginTop: 4 },
  fieldLabel: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, marginTop: 8 },
  input: { backgroundColor: COLORS.grey[800], borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.white, fontSize: 15, borderWidth: 1, borderColor: COLORS.grey[700], marginBottom: 4 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  checkbox: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: COLORS.grey[600], alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  checkboxLabel: { color: COLORS.white, fontSize: 15, fontWeight: '600', flex: 1 },
  lockedValue: { color: COLORS.white, fontSize: 15, paddingVertical: 12, marginBottom: 4 },
  choiceRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  choice: { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: COLORS.grey[700], alignItems: 'center' },
  choiceSelected: { borderColor: COLORS.accent, backgroundColor: COLORS.accentTint },
  choiceText: { color: COLORS.grey[400], fontSize: 15, fontWeight: '600' },
  choiceTextSelected: { color: COLORS.accent },
  gapBelow: { marginBottom: 8 },
  dateLine: { color: COLORS.grey[400], fontSize: 14, marginTop: 4 },
  footer: { color: COLORS.grey[500], fontSize: 13, textAlign: 'center' },
});
