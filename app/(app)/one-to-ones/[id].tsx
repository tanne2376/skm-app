import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PaymentMethodSelector } from '@/components/PaymentMethodSelector';
import { useAuth } from '@/hooks/useAuth';
import { useActiveMembership } from '@/hooks/useActiveMembership';
import { supabase } from '@/lib/supabase';
import { initializePaymentSheet, openPaymentSheet, formatGBP } from '@/lib/stripe';
import { OneToOneWithDetails, PaymentMethod } from '@/types';

export default function OneToOneDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { data: membership } = useActiveMembership();
  const queryClient = useQueryClient();
  const [showPayment, setShowPayment] = useState(false);

  const { data: oto, isLoading } = useQuery<OneToOneWithDetails>({
    queryKey: ['one_to_ones', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('one_to_ones')
        .select(`*, teacher:profiles!teacher_id(id, full_name), student:profiles!student_id(id, full_name), location:locations(id, name, address)`)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as OneToOneWithDetails;
    },
  });

  const bookMutation = useMutation({
    mutationFn: async (method: PaymentMethod) => {
      if (method === 'cash') {
        const { error } = await supabase
          .from('one_to_ones')
          .update({ student_id: session!.user.id, status: 'booked', payment_method: 'cash', payment_status: 'pending' })
          .eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.functions.invoke('create-payment-intent', {
          body: { type: 'one_to_one', id },
        });
        if (error) throw new Error(error.message);

        await initializePaymentSheet({
          paymentIntentClientSecret: data.clientSecret,
          customerEphemeralKeySecret: data.ephemeralKeySecret,
          customerId: data.customerId,
          amount: oto!.price,
        });

        const result = await openPaymentSheet();
        if (!result.success) throw new Error(result.error ?? 'Payment cancelled.');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['one_to_ones'] });
      setShowPayment(false);
    },
    onError: (e: Error) => Alert.alert('Booking failed', e.message),
  });

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  if (!oto) return null;

  const dateStr = new Date(oto.session_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const locationStr = oto.location?.name ?? oto.location_text ?? 'TBA';

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="1-to-1 Detail" showBack />
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{oto.title}</Text>
            <Badge
              label={oto.status.charAt(0).toUpperCase() + oto.status.slice(1)}
              variant={oto.status === 'available' ? 'success' : 'neutral'}
            />
          </View>

          {oto.description ? <Text style={styles.description}>{oto.description}</Text> : null}

          <View style={styles.detailsGrid}>
            <DetailRow label="Instructor" value={oto.teacher?.full_name ?? 'TBA'} />
            <DetailRow label="Date" value={dateStr} />
            <DetailRow label="Time" value={`${oto.start_time.slice(0, 5)} – ${oto.end_time.slice(0, 5)}`} />
            <DetailRow label="Location" value={locationStr} />
            <DetailRow label="Price" value={formatGBP(oto.price)} />
          </View>
        </Card>

        {oto.status === 'available' && !showPayment && (
          <Button variant="primary" size="lg" onPress={() => setShowPayment(true)}>
            Book this session
          </Button>
        )}

        {showPayment && (
          <Card>
            <PaymentMethodSelector
              price={oto.price}
              membership={membership}
              onSelect={(method) => bookMutation.mutate(method)}
              isLoading={bookMutation.isPending}
            />
          </Card>
        )}

        {oto.status === 'booked' && oto.student_id === session?.user.id && (
          <Card>
            <Text style={styles.bookedText}>✓ You have booked this session</Text>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.black },
  content: { padding: 16, gap: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  title: { color: COLORS.white, fontSize: 20, fontWeight: '800', flex: 1, marginRight: 8 },
  description: { color: COLORS.grey[300], fontSize: 15, marginBottom: 12 },
  detailsGrid: { gap: 10 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { color: COLORS.grey[400], fontSize: 14 },
  detailValue: { color: COLORS.white, fontSize: 14, fontWeight: '600', textAlign: 'right', flex: 1, marginLeft: 16 },
  bookedText: { color: COLORS.success, fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
