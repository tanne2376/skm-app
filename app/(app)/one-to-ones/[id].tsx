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
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { useActiveBlock } from '@/hooks/useActiveBlock';
import { useBookOneToOneWithBlock } from '@/hooks/useBlockPurchase';
import { supabase, invokeFunction } from '@/lib/supabase';
import { initializePaymentSheet, openPaymentSheet, formatGBP, PAYMENT_CANCELED } from '@/lib/stripe';
import { OneToOneWithDetails, PaymentMethod } from '@/types';


export default function OneToOneDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const requireAuth = useRequireAuth();
  const { data: block } = useActiveBlock();
  const bookWithBlock = useBookOneToOneWithBlock();
  const queryClient = useQueryClient();
  const [showPayment, setShowPayment] = useState(false);

  const { data: oto, isLoading } = useQuery<OneToOneWithDetails>({
    queryKey: ['one_to_ones', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('one_to_ones')
        .select(`*, teacher:profiles!teacher_id(id, full_name), student:profiles!student_id(id, full_name), location:locations(id, name, address), block:blocks!block_id(id, payment_status, payment_method)`)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as OneToOneWithDetails;
    },
  });

  const bookMutation = useMutation({
    mutationFn: async (method: PaymentMethod) => {
      if (method === 'cash') {
        const { data: updated, error } = await supabase
          .from('one_to_ones')
          .update({ student_id: session!.user.id, status: 'booked', payment_method: 'cash', payment_status: 'pending' })
          .eq('id', id)
          .eq('status', 'available')
          .select();
        if (error) throw error;
        if (!updated?.length) throw new Error('This session is no longer available.');
        // Notify the 1-to-1 owner (best effort, without failing booking)
        try {
          await invokeFunction('notify-event', { event: 'one_to_one_booked_cash', oneToOneId: id });
        } catch (notifyError) {
          console.warn('Failed to dispatch one_to_one_booked_cash', notifyError);
        }
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
          try {
            await invokeFunction('cancel-one-to-one', { oneToOneId: id });
          } catch (cleanupError) {
            console.error('Failed to cleanup after payment failure:', cleanupError);
          }
          throw new Error(result.canceled ? PAYMENT_CANCELED : (result.error ?? 'Payment failed.'));
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['one_to_ones'] });
      setShowPayment(false);
    },
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: ['one_to_ones'] });
      if (e.message === PAYMENT_CANCELED) return;
      Alert.alert('Booking failed', e.message);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await invokeFunction<{
        refunded: boolean;
        blockRefunded?: boolean;
        lateCancelCount?: number;
        isNowBlocked?: boolean;
        message: string;
      }>('cancel-one-to-one', { oneToOneId: id });
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

  const confirmBlockCashMutation = useMutation({
    mutationFn: async (blockId: string) => {
      const { error } = await supabase.rpc('confirm_cash_block_payment', { p_block_id: blockId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['one_to_ones'] });
      queryClient.invalidateQueries({ queryKey: ['unconfirmed_cash_sessions'] });
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  function confirmCancel() {
    if (!oto) return;
    const sessionStart = new Date(`${oto.session_date}T${oto.start_time}Z`);
    const hoursUntil = (sessionStart.getTime() - Date.now()) / (1000 * 60 * 60);
    const withinWindow = hoursUntil > 0 && hoursUntil <= 24;

    let message: string;
    if (withinWindow) {
      const consequence =
        oto.payment_method === 'block'
          ? 'Your block slot will not be returned'
          : oto.payment_method === 'cash'
            ? 'No refund will be issued'
            : 'No refund will be issued';
      message = `It is less than 24 hours until this session. ${consequence}, and this will be recorded as a late cancellation.`;
    } else {
      message =
        oto.payment_method === 'block'
          ? 'Your block slot will be returned.'
          : oto.payment_method === 'cash'
            ? 'Your booking will be cancelled.'
            : 'You will receive a full refund.';
    }

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

  function confirmBlockCash() {
    if (!oto?.block?.id) return;
    Alert.alert(
      'Confirm Block Cash Payment',
      'This confirms cash payment for the entire block, not just this session. Use Manage → Users if you need partial-amount handling.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm Block Paid', onPress: () => confirmBlockCashMutation.mutate(oto.block!.id) },
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

  const dateStr = new Date(oto.session_date + 'T12:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const locationStr = oto.location?.address
    ? `${oto.location.name} — ${oto.location.address}`
    : oto.location?.name ?? oto.location_text ?? 'TBA';

  const isOwnBooking = oto.student_id === session?.user.id;
  const isCreator = oto.teacher_id === session?.user.id || oto.creator_id === session?.user.id;
  const isBooked = oto.status === 'booked';
  const isCashPending = isBooked && oto.payment_method === 'cash' && oto.payment_status === 'pending';
  const isBlockPaid = isBooked && oto.payment_method === 'block';
  // Block was bought with cash that hasn't been confirmed yet — display state
  // derives from the joined block, not the 1-to-1 row (whose payment_status is
  // 'paid' because the slot itself is consumed).
  const isBlockCashPending = isBlockPaid && oto.block?.payment_status === 'pending';

  // Anyone who didn't create the session can book it
  const canBook = oto.status === 'available' && !isCreator;

  // Badge logic
  let badgeLabel: string;
  let badgeVariant: 'success' | 'info' | 'warning' | 'neutral';
  if (isBlockCashPending) {
    badgeLabel = 'Cash Pending (Block)';
    badgeVariant = 'warning';
  } else if (isBlockPaid) {
    badgeLabel = 'Paid with Block';
    badgeVariant = 'success';
  } else if (isCashPending) {
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
        {canBook && !showPayment && block?.is_usable && (
          <Button
            variant="primary"
            size="lg"
            onPress={() => requireAuth(() => bookWithBlock.mutate(id))}
            loading={bookWithBlock.isPending}
          >
            {`Book with block (${block.sessions_remaining} session${block.sessions_remaining === 1 ? '' : 's'} left)`}
          </Button>
        )}
        {canBook && !showPayment && !block?.is_usable && (
          <Button variant="primary" size="lg" onPress={() => requireAuth(() => setShowPayment(true))}>
            {`Book for ${formatGBP(oto.price)}`}
          </Button>
        )}

        {/* Payment selector */}
        {showPayment && (
          <Card>
            <Text style={styles.paymentTitle}>Select payment method</Text>
            <PaymentMethodSelector
              price={oto.price}
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

        {/* Confirm cash button — creator view (regular cash) */}
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

        {/* Block-cash-pending — creator can confirm the whole block as paid */}
        {isBlockCashPending && isCreator && (
          <View style={styles.cancelSection}>
            <Button
              variant="primary"
              size="lg"
              onPress={confirmBlockCash}
              loading={confirmBlockCashMutation.isPending}
            >
              Confirm Block Cash Payment
            </Button>
            <Text style={styles.blockCashPendingHint}>
              Confirms the whole block as paid. For partial amounts use Manage → Users.
            </Text>
          </View>
        )}

        {/* Cancel button — student who booked */}
        {isBooked && isOwnBooking && (
          <View style={styles.cancelSection}>
            <Text style={styles.cancelPolicy}>
              Cancel more than 24 hours before the session for a full refund (or to return your block slot). Cancellations within 24 hours are non-refundable, do not return block slots, and are recorded as a late cancellation.
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

  blockCashPendingHint: { color: COLORS.grey[600], fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
