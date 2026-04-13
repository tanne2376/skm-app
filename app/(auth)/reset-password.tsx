import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { COLORS } from '@/constants';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export default function ResetPasswordScreen() {
  const { clearPasswordRecovery } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleReset() {
    if (!newPassword || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields.');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      clearPasswordRecovery();
      Alert.alert('Success', 'Password updated. You are now signed in.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Set New Password</Text>
        <Text style={styles.subtitle}>Enter your new password below.</Text>

        <Text style={styles.label}>New Password</Text>
        <TextInput
          style={styles.input}
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          placeholderTextColor={COLORS.grey[600]}
          placeholder="••••••••"
        />

        <Text style={styles.label}>Confirm Password</Text>
        <TextInput
          style={styles.input}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          placeholderTextColor={COLORS.grey[600]}
          placeholder="••••••••"
        />

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleReset}
          disabled={isLoading}
        >
          {isLoading
            ? <ActivityIndicator color={COLORS.white} />
            : <Text style={styles.buttonText}>Save Password</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: COLORS.white,
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.grey[400],
    lineHeight: 22,
    marginBottom: 32,
  },
  label: {
    color: COLORS.grey[400],
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: COLORS.grey[900],
    borderWidth: 1,
    borderColor: COLORS.grey[800],
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: COLORS.white,
    fontSize: 16,
  },
  button: {
    backgroundColor: COLORS.accent,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 32,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
