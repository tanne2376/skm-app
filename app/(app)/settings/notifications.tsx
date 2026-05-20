import { View, Text, StyleSheet, ScrollView, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/hooks/useAuth';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { NotificationType } from '@/types';

type NotifOption = {
  type: NotificationType;
  label: string;
  description: string;
  roles: ('student' | 'teacher' | 'admin')[];
};

const notificationOptions: NotifOption[] = [
  { type: 'upcoming_class', label: 'Upcoming class reminders', description: 'Reminders before classes you\'ve booked', roles: ['student', 'teacher'] },
  { type: 'waitlist_promotion', label: 'Waitlist promotion', description: 'When you get into a class from the waiting list', roles: ['student', 'teacher'] },
  { type: 'one_to_one_available', label: 'New 1-to-1 slots', description: 'When a new 1-to-1 session is opened up', roles: ['student', 'teacher'] },
  { type: 'class_joined', label: 'Student joined class', description: 'When someone books into one of your classes', roles: ['teacher', 'admin'] },
  { type: 'class_left', label: 'Student left class', description: 'When someone cancels a booking in your class', roles: ['teacher', 'admin'] },
  { type: 'one_to_one_booked', label: '1-to-1 booked', description: 'When someone books your 1-to-1 session', roles: ['teacher', 'admin'] },
  { type: 'class_full', label: 'Class full', description: 'When one of your classes reaches capacity', roles: ['teacher', 'admin'] },
  { type: 'class_time_changed', label: 'Class time changed', description: 'When a class you\'ve booked has its time changed', roles: ['student', 'teacher'] },
  { type: 'class_cancelled', label: 'Class cancelled', description: 'When a class you\'ve booked is cancelled by the admin', roles: ['student', 'teacher'] },
  { type: 'membership_renewal', label: 'Membership renewal', description: 'Reminder before your membership auto-renews', roles: ['student', 'teacher'] },
];

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { role } = useAuth();
  const { isEnabled, toggle } = useNotificationPreferences();

  const visible = notificationOptions.filter((n) => role && n.roles.includes(role));

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="Notifications" showBack />
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.desc}>Choose which push notifications you receive.</Text>
          {visible.map((n) => (
            <View key={n.type} style={styles.row}>
              <View style={styles.textWrap}>
                <Text style={styles.label}>{n.label}</Text>
                <Text style={styles.description}>{n.description}</Text>
              </View>
              <Switch
                value={isEnabled(n.type)}
                onValueChange={(val) => toggle.mutate({ type: n.type, enabled: val })}
                trackColor={{ false: COLORS.grey[700], true: COLORS.accent }}
                thumbColor={COLORS.white}
                disabled={toggle.isPending}
              />
            </View>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  content: { padding: 16, gap: 16 },
  desc: { color: COLORS.grey[400], fontSize: 14, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.grey[800] },
  textWrap: { flex: 1, marginRight: 12 },
  label: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  description: { color: COLORS.grey[600], fontSize: 12, marginTop: 2 },
});
