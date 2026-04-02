import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Alert } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

export default function DefaultsScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [pricePounds, setPricePounds] = useState(
    ((profile?.oto_default_price ?? 5000) / 100).toFixed(2)
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const priceNum = parseFloat(pricePounds);
      if (isNaN(priceNum) || priceNum < 0) throw new Error('Enter a valid price.');
      const { error } = await supabase
        .from('profiles')
        .update({ oto_default_price: Math.round(priceNum * 100) })
        .eq('id', profile!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      Alert.alert('Saved', 'Default price updated.');
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="Session Defaults" showBack />

      <View style={styles.content}>
        <Card>
          <Text style={styles.fieldLabel}>Default 1-to-1 Price (£)</Text>
          <TextInput
            style={styles.input}
            value={pricePounds}
            onChangeText={setPricePounds}
            keyboardType="decimal-pad"
            placeholder="50.00"
            placeholderTextColor={COLORS.grey[600]}
          />
          <Text style={styles.hint}>This will be pre-filled when you create a new 1-to-1 session. You can still change it per session.</Text>
          <Button
            variant="primary"
            size="md"
            onPress={() => saveMutation.mutate()}
            loading={saveMutation.isPending}
            style={{ marginTop: 16 }}
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
  fieldLabel: { color: COLORS.grey[400], fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  input: { backgroundColor: COLORS.grey[800], borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.white, fontSize: 15, borderWidth: 1, borderColor: COLORS.grey[700], marginBottom: 8 },
  hint: { color: COLORS.grey[600], fontSize: 13, lineHeight: 18 },
});
