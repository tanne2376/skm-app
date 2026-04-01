import { useEffect } from 'react';
import { Tabs, Redirect, useRouter, useSegments } from 'expo-router';
import { Platform, Text } from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { COLORS } from '@/constants';
import { registerForPushNotifications } from '@/lib/notifications';

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>;
}

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
          tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} />,
        }}
      />

      {/* Directories with _layout.tsx are discovered as just "dir" */}
      <Tabs.Screen
        name="one-to-ones"
        options={{
          title: '1-to-1s',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🥊" focused={focused} />,
        }}
      />

      {/* ── Teachers only ───────────────────────────────────────── */}
      <Tabs.Screen
        name="my-classes"
        options={{
          title: 'My Classes',
          tabBarIcon: ({ focused }) => <TabIcon emoji="📋" focused={focused} />,
          href: isTeacher ? undefined : null,
        }}
      />

      {/* ── Students + teachers (not admins) ────────────────────── */}
      <Tabs.Screen
        name="membership/index"
        options={{
          title: 'Membership',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🎖️" focused={focused} />,
          href: !isAdmin ? undefined : null,
        }}
      />

      {/* ── Admins only ─────────────────────────────────────────── */}
      <Tabs.Screen
        name="manage/index"
        options={{
          title: 'Manage',
          tabBarIcon: ({ focused }) => <TabIcon emoji="⚙️" focused={focused} />,
          href: isAdmin ? undefined : null,
        }}
      />

      {/* ── Settings for all ────────────────────────────────────── */}
      <Tabs.Screen
        name="settings/index"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
        }}
      />

      {/* ── Hidden: sub-nav only, not a tab ─────────────────────── */}
      <Tabs.Screen name="timetable" options={{ href: null }} />
    </Tabs>
  );
}
