import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
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
import { supabase, invokeFunction } from '@/lib/supabase';
import { initializePaymentSheet, openPaymentSheet, formatGBP } from '@/lib/stripe';
import { OneToOneWithDetails, PaymentMethod } from '@/types';

export default function OneToOneDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { session, role } = useAuth();
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
        const { data, error } = await invokeFunction<{
          clientSecret: string; ephemeralKeySecret: string; customerId: string;
        }>('create-payment-intent', { type: 'one_to_one', id });
        if (error) throw new Error(error.message);

        await initializePaymentSheet({
          paymentIntentClientSecret: data!.clientSecret,
          customerEphemeralKeySecret: data!.ephemeralKeySecret,
          customerId: data!.customerId,
          amount: oto!.price,
        });

        const result = await openPaymentSheet();
        if (!result.success) {
          await invokeFunction('cancel-one-to-one', { oneToOneId: id });
          throw new Error(result.error ?? 'Payment cancelled.');
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['one_to_ones'] });
      setShowPayment(false);
    },
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: ['one_to_ones'] });
      if (!e.message.includes('Payment cancelled')) {
        Alert.alert('Booking failed', e.message);
      }
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await invokeFunction<{ refunded: boolean; message: string }>('cancel-one-to-one', { oneToOneId: id });
      if (error) throw new Error(error.message);
      return data!;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['one_to_ones'] });
      Alert.alert('Booking cancelled', data.message, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (e: Error) => Alert.alert('Cancellation failed', e.message),
  });

  const confirmCashMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('one_to_ones')
        .update({ payment_status: 'paid' })
        .eq('id', id)
        .eq('payment_method', 'cash');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['one_to_ones'] });
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  function confirmCancel() {
    if (!oto) return;
    const sessionStart = new Date(`${oto.session_date}T${oto.start_time}`);
    const hoursUntil = (sessionStart.getTime() - Date.now()) / (1000 * 60 * 60);
    const withinWindow = hoursUntil > 0 && hoursUntil <= 24;

    const message = withinWindow
      ? 'The session is within 24 hours. No refund will be issued.'
      : oto.payment_method === 'app' || !oto.payment_method
        ? 'You will receive a full refund.'
        : 'Your booking will be cancelled.';

    Alert.alert('Cancel booking?', message, [
      { text: 'Keep booking', style: 'cancel' },
      { text: 'Cancel booking', style: 'destructive', onPress: () => cancelMutation.mutate() },
    ]);
  }

  function confirmCash() {
    if (!oto) return;
    Alert.alert(
      'Confirm Cash Payment',
      `Mark ${oto.student?.full_name} as paid in cash?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => confirmCashMutation.mutate() },
      ],
    );
  }

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  if (!oto) {
    return (
      <View style={styles.loading}>
        <Text style={styles.notFound}>Session not found.</Text>
      </View>
    );
  }

  const dateStr = new Date(oto.session_date).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const locationStr = oto.location?.address
    ? `${oto.location.name} — ${oto.location.address}`
    : oto.location?.name ?? oto.location_text ?? 'TBA';

  const isOwnBooking = oto.student_id === session?.user.id;
  const isCreator = oto.teacher_id === session?.user.id || oto.creator_id === session?.user.id;
  const isBooked = oto.status === 'booked';
  const isCashPending = isBooked && oto.payment_method === 'cash' && oto.payment_status === 'pending';

  // Anyone who didn't create the session can book it
  const canBook = oto.status === 'available' && !isCreator;

  // Badge logic
  let badgeLabel: string;
  let badgeVariant: 'success' | 'info' | 'warning' | 'neutral';
  if (isCashPending) {
    badgeLabel = 'Cash Pending';
    badgeVariant = 'warning';
  } else if (oto.status === 'available') {
    badgeLabel = 'Available';
    badgeVariant = 'success';
  } else if (oto.status === 'booked') {
    badgeLabel = 'Booked';
    badgeVariant = 'info';
  } else {
    badgeLabel = oto.status.charAt(0).toUpperCase() + oto.status.slice(1);
    badgeVariant = 'neutral';
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="1-to-1 Session" showBack />
      <ScrollView contentContainerStyle={styles.content}>

        {/* Confirmation banner — student who booked */}
        {isBooked && isOwnBooking && (
          <View style={styles.confirmedBanner}>
            <Text style={styles.confirmedIcon}>✓</Text>
            <View style={styles.confirmedText}>
              <Text style={styles.confirmedTitle}>Booking confirmed</Text>
              <Text style={styles.confirmedSub}>{dateStr} at {oto.start_time.slice(0, 5)} with {oto.teacher?.full_name}</Text>
            </View>
          </View>
        )}

        {/* Booked-by banner — creator view */}
        {isBooked && isCreator && oto.student && (
          <View style={styles.studentBanner}>
            <Text style={styles.studentBannerLabel}>Booked by</Text>
            <Text style={styles.studentBannerName}>{oto.student.full_name}</Text>
          </View>
        )}

        {/* Session details */}
        <Card>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{oto.title}</Text>
            <Badge label={badgeLabel} variant={badgeVariant} />
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

        {/* Book button — available session, not the creator */}
        {canBook && !showPayment && (
          <Button variant="primary" size="lg" onPress={() => setShowPayment(true)}>
            {`Book for ${formatGBP(oto.price)}`}
          </Button>
        )}

        {/* Payment selector */}
        {showPayment && (
          <Card>
            <Text style={styles.paymentTitle}>Select payment method</Text>
            <PaymentMethodSelector
              price={oto.price}
              membership={membership}
              onSelect={(method) => bookMutation.mutate(method)}
              isLoading={bookMutation.isPending}
            />
            <Button
              variant="secondary"
              size="sm"
              onPress={() => setShowPayment(false)}
              style={{ marginTop: 8 }}
            >
              Cancel
            </Button>
          </Card>
        )}

        {/* Confirm cash button — creator view */}
        {isCashPending && isCreator && (
          <Button
            variant="primary"
            size="lg"
            onPress={confirmCash}
            loading={confirmCashMutation.isPending}
          >
            Confirm Cash Payment
          </Button>
        )}

        {/* Cancel button — student who booked */}
        {isBooked && isOwnBooking && (
          <View style={styles.cancelSection}>
            <Text style={styles.cancelPolicy}>
              Cancel more than 24 hours before the session for a full refund. Cancellations within 24 hours are non-refundable.
            </Text>
            <Button
              variant="secondary"
              size="md"
              onPress={confirmCancel}
              loading={cancelMutation.isPending}
            >
              Cancel booking
            </Button>
          </View>
        )}

        {/* Awaiting booking — creator's own available session */}
        {oto.status === 'available' && isCreator && (
          <Card>
            <Text style={styles.awaitingText}>Awaiting booking</Text>
            <Text style={styles.awaitingSub}>This session is visible to others and will disappear from the available list once someone books it.</Text>
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
  notFound: { color: COLORS.grey[400], fontSize: 15 },
  content: { padding: 16, gap: 16 },

  confirmedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: 'rgba(34,197,94,0.12)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)',
    borderRadius: 12, padding: 16,
  },
  confirmedIcon: { fontSize: 28, color: COLORS.success },
  confirmedText: { flex: 1, gap: 3 },
  confirmedTitle: { color: COLORS.success, fontSize: 16, fontWeight: '700' },
  confirmedSub: { color: COLORS.grey[300], fontSize: 13 },

  studentBanner: {
    backgroundColor: 'rgba(59,130,246,0.12)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)',
    borderRadius: 12, padding: 16, gap: 2,
  },
  studentBannerLabel: { color: '#60A5FA', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  studentBannerName: { color: COLORS.white, fontSize: 18, fontWeight: '700' },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  title: { color: COLORS.white, fontSize: 20, fontWeight: '800', flex: 1, marginRight: 8 },
  description: { color: COLORS.grey[300], fontSize: 15, marginBottom: 12 },
  detailsGrid: { gap: 10 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  detailLabel: { color: COLORS.grey[400], fontSize: 14 },
  detailValue: { color: COLORS.white, fontSize: 14, fontWeight: '600', textAlign: 'right', flex: 1 },

  paymentTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700', marginBottom: 12 },

  cancelSection: { gap: 10 },
  cancelPolicy: { color: COLORS.grey[600], fontSize: 13, textAlign: 'center', lineHeight: 19 },

  awaitingText: { color: COLORS.grey[300], fontSize: 15, fontWeight: '600', textAlign: 'center' },
  awaitingSub: { color: COLORS.grey[600], fontSize: 13, textAlign: 'center', marginTop: 4, lineHeight: 18 },
});
