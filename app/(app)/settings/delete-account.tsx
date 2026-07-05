import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Alert, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { invokeFunction, supabase } from '@/lib/supabase';

const CONFIRM_PHRASE = 'DELETE';

export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (confirmation.trim() !== CONFIRM_PHRASE) {
      Alert.alert('Confirmation required', `Type ${CONFIRM_PHRASE} to confirm.`);
      return;
    }

    Alert.alert(
      'Delete account?',
      'This will cancel your membership, release future bookings, and permanently remove your account. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const { data, error } = await invokeFunction<{
                success?: boolean;
                owed_pence?: number;
              }>('delete-account');
              if (error) {
                Alert.alert('Error', error.message);
                return;
              }
              const owedPence = data?.owed_pence ?? 0;
              if (owedPence > 0) {
                Alert.alert(
                  'Outstanding balance',
                  `You owe £${(owedPence / 100).toFixed(2)} in unpaid cash. Please speak to a teacher at your next class to settle before deleting your account.`,
                );
                return;
              }
              const { error: signOutError } = await supabase.auth.signOut();
              if (signOutError) {
                Alert.alert(
                  'Sign out failed',
                  'Your account was deleted but sign-out failed. Please restart the app.',
                );
                return;
              }
              // AuthGuard handles redirect to login once the session clears.
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="Delete Account" showBack />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={styles.heading}>This is permanent</Text>
          <Text style={styles.body}>
            Deleting your account will:
          </Text>
          <View style={styles.bullets}>
            <Text style={styles.bullet}>• Cancel any active membership immediately.</Text>
            <Text style={styles.bullet}>• Release your future class bookings and 1-to-1 slots.</Text>
            <Text style={styles.bullet}>• Remove your name, phone, and contact details from our records.</Text>
            <Text style={styles.bullet}>• Sign you out and prevent future sign-in with this email.</Text>
          </View>
          <Text style={[styles.body, { marginTop: 12 }]}>
            For accounting purposes, payment records and historic attendance are retained
            but no longer linked to your personal details. See the Privacy Policy for detail.
          </Text>
        </Card>

        <Card>
          <Text style={styles.fieldLabel}>Type {CONFIRM_PHRASE} to confirm</Text>
          <TextInput
            style={styles.input}
            value={confirmation}
            onChangeText={setConfirmation}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={CONFIRM_PHRASE}
            placeholderTextColor={COLORS.grey[600]}
          />
          <Button
            variant="danger"
            size="lg"
            onPress={handleDelete}
            loading={loading}
            disabled={confirmation.trim() !== CONFIRM_PHRASE}
          >
            Delete my account
          </Button>
          <Button
            variant="secondary"
            size="md"
            onPress={() => router.back()}
            style={{ marginTop: 8 }}
          >
            Cancel
          </Button>
        </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  content: { padding: 16, gap: 16 },
  heading: { color: COLORS.white, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  body: { color: COLORS.grey[300], fontSize: 14, lineHeight: 20 },
  bullets: { marginTop: 8, gap: 4 },
  bullet: { color: COLORS.grey[300], fontSize: 14, lineHeight: 20 },
  fieldLabel: {
    color: COLORS.grey[400],
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.grey[800],
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.white,
    fontSize: 15,
    borderWidth: 1,
    borderColor: COLORS.grey[700],
    marginBottom: 16,
    letterSpacing: 2,
  },
});
