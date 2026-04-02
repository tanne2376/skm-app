import { useEffect } from 'react';
import { Tabs, Redirect, useRouter, useSegments } from 'expo-router';
import { Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { COLORS } from '@/constants';
import { registerForPushNotifications } from '@/lib/notifications';

export default function AppLayout() {
  const { session, role, isLoading } = useAuth();

  useEffect(() => {
    if (session) {
      registerForPushNotifications().catch(() => {});
    }
  }, [session]);

  if (isLoading) return null;
  if (!session) return <Redirect href="/(auth)/login" />;

  const isTeacher = role === 'teacher';
  const isAdmin = role === 'admin';
  const isTeacherOrAdmin = isTeacher || isAdmin;

  // Tab visibility by role:
  //   student:  Home | 1-to-1s | Membership | Settings
  //   teacher:  Home | 1-to-1s | My Classes | Membership | Settings
  //   admin:    Home | 1-to-1s | Manage | Settings

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.grey[900],
          borderTopColor: COLORS.grey[800],
          borderTopWidth: 1,
          paddingBottom: Platform.OS === 'ios' ? 20 : 8,
          height: Platform.OS === 'ios' ? 84 : 64,
        },
        tabBarActiveTintColor: COLORS.white,
        tabBarInactiveTintColor: COLORS.grey[600],
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
      }}
    >
      {/* ── Visible to all ──────────────────────────────────────── */}
      {/* Directories without _layout.tsx are discovered as "dir/index" */}
      <Tabs.Screen
        name="home/index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused, color }) => <Feather name="home" size={20} color={color} />,
        }}
      />

      {/* Directories with _layout.tsx are discovered as just "dir" */}
      <Tabs.Screen
        name="one-to-ones"
        options={{
          title: '1-to-1s',
          tabBarIcon: ({ focused, color }) => <Feather name="users" size={20} color={color} />,
        }}
      />

      {/* ── Teachers only ───────────────────────────────────────── */}
      <Tabs.Screen
        name="my-classes"
        options={{
          title: 'My Classes',
          tabBarIcon: ({ focused, color }) => <Feather name="clipboard" size={20} color={color} />,
          href: isTeacher ? undefined : null,
        }}
      />

      {/* ── Students + teachers (not admins) ────────────────────── */}
      <Tabs.Screen
        name="membership/index"
        options={{
          title: 'Membership',
          tabBarIcon: ({ focused, color }) => <Feather name="credit-card" size={20} color={color} />,
          href: !isAdmin ? undefined : null,
        }}
      />

      {/* ── Admins only ─────────────────────────────────────────── */}
      <Tabs.Screen
        name="manage/index"
        options={{
          title: 'Manage',
          tabBarIcon: ({ focused, color }) => <Feather name="sliders" size={20} color={color} />,
          href: isAdmin ? undefined : null,
        }}
      />

      {/* ── Settings for all ────────────────────────────────────── */}
      <Tabs.Screen
        name="settings/index"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused, color }) => <Feather name="settings" size={20} color={color} />,
        }}
      />

      {/* ── Hidden: sub-nav only, not a tab ─────────────────────── */}
      <Tabs.Screen name="timetable" options={{ href: null }} />
    </Tabs>
  );
}
