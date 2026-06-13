import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { COLORS } from '@/constants';

export default function Index() {
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.black }}>
        <ActivityIndicator color={COLORS.accent} size="large" />
      </View>
    );
  }

  // Guests land on the same home screen as signed-in students; gated
  // actions route to login on tap. See useRequireAuth.
  return <Redirect href="/(app)/home" />;
}
