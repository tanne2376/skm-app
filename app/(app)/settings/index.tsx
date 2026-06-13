import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Alert, TouchableOpacity, Linking } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

const PRIVACY_URL = 'https://tanne2376.github.io/skm-app/privacy.html';
const TERMS_URL = 'https://tanne2376.github.io/skm-app/terms.html';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { session, profile, role, signOut } = useAuth();
  const queryClient = useQueryClient();

  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [editing, setEditing] = useState(false);

  const isTeacherOrAdmin = role === 'teacher' || role === 'admin';

  // Guest layout: no profile/account/sign-out, but keep Legal + About visible.
  if (!session) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Settings" />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Card>
            <Text style={styles.guestTitle}>Sign in to your account</Text>
            <Text style={styles.guestBody}>
              Create an account or sign in to book classes, manage your membership, and view your bookings.
            </Text>
            <Button
              variant="primary"
              size="md"
              onPress={() => router.push('/(auth)/login')}
              style={styles.guestPrimary}
            >
              Sign In
            </Button>
            <Button
              variant="secondary"
              size="md"
              onPress={() => router.push('/(auth)/register')}
            >
              Create Account
            </Button>
          </Card>

          <Card>
            <Text style={styles.sectionTitle}>Legal</Text>
            <View style={styles.adminLinks}>
              <SettingsRow
                label="Privacy Policy"
                onPress={() => Linking.openURL(PRIVACY_URL).catch(() =>
                  Alert.alert('Error', 'Unable to open Privacy Policy.')
                )}
              />
              <SettingsRow
                label="Terms of Service"
                onPress={() => Linking.openURL(TERMS_URL).catch(() =>
                  Alert.alert('Error', 'Unable to open Terms of Service.')
                )}
              />
            </View>
          </Card>

          <Card>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.sectionDesc}>Switch-Kick Mafia · v1.0.0</Text>
            <Text style={[styles.sectionDesc, { marginTop: 4 }]}>Built for SKM</Text>
          </Card>
        </ScrollView>
      </View>
    );
  }

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      if (!fullName.trim()) throw new Error('Name cannot be empty.');
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim(), phone: phone.trim() || null })
        .eq('id', profile!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      setEditing(false);
      Alert.alert('Saved', 'Profile updated.');
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  }

  const roleLabel = role === 'admin' ? 'Admin' : role === 'teacher' ? 'Teacher' : 'Student';
  const roleVariant = role === 'admin' ? 'error' : role === 'teacher' ? 'info' : 'neutral';

  return (
    <View style={styles.container}>
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* Profile */}
        <Card>
          <View style={styles.profileHeader}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{profile?.full_name?.charAt(0)?.toUpperCase() ?? '?'}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.profileName}>{profile?.full_name}</Text>
              <Badge label={roleLabel} variant={roleVariant} />
            </View>
            <TouchableOpacity onPress={() => setEditing(!editing)}>
              <Text style={styles.editBtn}>{editing ? 'Cancel' : 'Edit'}</Text>
            </TouchableOpacity>
          </View>

          {editing && (
            <View style={styles.editForm}>
              <Text style={styles.fieldLabel}>Full Name</Text>
              <TextInput
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
                placeholderTextColor={COLORS.grey[600]}
              />
              <Text style={styles.fieldLabel}>Phone</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="+44 7700 000000"
                placeholderTextColor={COLORS.grey[600]}
              />
              <Button
                variant="primary"
                size="md"
                onPress={() => updateProfileMutation.mutate()}
                loading={updateProfileMutation.isPending}
                style={{ marginTop: 8 }}
              >
                Save Profile
              </Button>
            </View>
          )}
        </Card>

        {/* Notifications */}
        <Card>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <View style={styles.adminLinks}>
            <SettingsRow label="Notification Preferences" onPress={() => router.push('/(app)/settings/notifications')} />
          </View>
        </Card>

        {/* 1-to-1 Sessions (teachers + admins) */}
        {isTeacherOrAdmin && (
          <Card>
            <Text style={styles.sectionTitle}>1-to-1 Sessions</Text>
            <View style={styles.adminLinks}>
              <SettingsRow label="Session Defaults" onPress={() => router.push('/(app)/settings/defaults')} />
              {role === 'admin' && (
                <>
                  <SettingsRow label="Manage Locations" onPress={() => router.push('/(app)/settings/locations')} />
                  <SettingsRow label="Manage Blocks" onPress={() => router.push('/(app)/settings/blocks')} />
                </>
              )}
            </View>
          </Card>
        )}

        {/* Account */}
        <Card>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.adminLinks}>
            <SettingsRow label="Change Password" onPress={() => router.push('/(app)/settings/change-password')} />
            <SettingsRow label="Delete Account" onPress={() => router.push('/(app)/settings/delete-account')} />
          </View>
        </Card>

        {/* Legal */}
        <Card>
          <Text style={styles.sectionTitle}>Legal</Text>
          <View style={styles.adminLinks}>
            <SettingsRow 
              label="Privacy Policy" 
              onPress={() => Linking.openURL(PRIVACY_URL).catch(() => 
                Alert.alert('Error', 'Unable to open Privacy Policy.')
              )} 
            />
            <SettingsRow 
              label="Terms of Service" 
              onPress={() => Linking.openURL(TERMS_URL).catch(() =>
                Alert.alert('Error', 'Unable to open Terms of Service.')
              )} 
            />
          </View>
        </Card>

        {/* App info */}
        <Card>
          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.sectionDesc}>Switch-Kick Mafia · v1.0.0</Text>
          <Text style={[styles.sectionDesc, { marginTop: 4 }]}>Built for SKM</Text>
        </Card>

        {/* Sign out */}
        <Button variant="danger" size="lg" onPress={handleSignOut}>
          Sign Out
        </Button>
      </ScrollView>

    </View>
  );
}

function SettingsRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.settingsRow} onPress={onPress}>
      <Text style={styles.settingsRowLabel}>{label}</Text>
      <Text style={styles.settingsRowArrow}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  content: { padding: 16, gap: 16 },
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: COLORS.accent, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: COLORS.white, fontSize: 20, fontWeight: '800' },
  flex: { flex: 1, gap: 4 },
  profileName: { color: COLORS.white, fontSize: 17, fontWeight: '700' },
  editBtn: { color: COLORS.accent, fontSize: 14, fontWeight: '600' },
  editForm: { marginTop: 16, gap: 8 },
  fieldLabel: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  input: { backgroundColor: COLORS.grey[800], borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.white, fontSize: 15, borderWidth: 1, borderColor: COLORS.grey[700], marginBottom: 12 },
  sectionTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  sectionDesc: { color: COLORS.grey[400], fontSize: 14 },
  adminLinks: { marginTop: 8, gap: 4 },
  settingsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.grey[800] },
  settingsRowLabel: { color: COLORS.white, fontSize: 15 },
  settingsRowArrow: { color: COLORS.grey[600], fontSize: 20 },
  guestTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  guestBody: { color: COLORS.grey[400], fontSize: 14, lineHeight: 20, marginBottom: 16 },
  guestPrimary: { marginBottom: 8 },
});
