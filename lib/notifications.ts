import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  const token = tokenData.data;

  // Upsert on every launch so we always have the latest token
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase
      .from('profiles')
      .update({ push_token: token })
      .eq('id', user.id);
  }

  return token;
}

export async function scheduleClassReminder(
  sessionId: string,
  className: string,
  sessionDate: Date,
  minutesBefore: number,
): Promise<void> {
  const triggerDate = new Date(sessionDate.getTime() - minutesBefore * 60 * 1000);
  if (triggerDate <= new Date()) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Class reminder: ${className}`,
      body: `Your class starts in ${minutesBefore >= 60 ? `${minutesBefore / 60} hour${minutesBefore > 60 ? 's' : ''}` : `${minutesBefore} minutes`}.`,
      data: { sessionId },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerDate,
    },
  });
}

export async function cancelScheduledReminders(sessionId: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const notification of scheduled) {
    if ((notification.content.data as Record<string, unknown>)?.sessionId === sessionId) {
      await Notifications.cancelScheduledNotificationAsync(notification.identifier);
    }
  }
}
