import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Alert } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';

export default function ChangePasswordScreen() {
  const insets = useSafeAreaInsets();

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    if (!oldPassword || !newPassword || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Error', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      // Verify old password by re-authenticating
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error('Could not retrieve account email.');

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: oldPassword,
      });
      if (signInError) throw new Error('Current password is incorrect.');

      // Update to new password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) throw updateError;

      Alert.alert('Success', 'Password updated.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="Change Password" showBack />

      <View style={styles.content}>
        <Card>
          <Text style={styles.fieldLabel}>Current Password</Text>
          <TextInput
            style={styles.input}
            value={oldPassword}
            onChangeText={setOldPassword}
            secureTextEntry
            autoComplete="current-password"
            placeholderTextColor={COLORS.grey[600]}
          />

          <Text style={styles.fieldLabel}>New Password</Text>
          <TextInput
            style={styles.input}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoComplete="new-password"
            placeholderTextColor={COLORS.grey[600]}
          />

          <Text style={styles.fieldLabel}>Confirm New Password</Text>
          <TextInput
            style={styles.input}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoComplete="new-password"
            placeholderTextColor={COLORS.grey[600]}
          />

          <Button
            variant="primary"
            size="lg"
            onPress={handleSave}
            loading={loading}
            style={{ marginTop: 8 }}
          >
            Save
          </Button>
        </Card>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  content: { padding: 16 },
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
  },
});
