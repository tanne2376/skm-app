import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { COLORS } from '@/constants';
import { BookingStatus, MembershipStatus, PaymentStatus } from '@/types';

type BadgeVariant = 'success' | 'warning' | 'error' | 'neutral' | 'info';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: ViewStyle;
}

export function Badge({ label, variant = 'neutral', style }: BadgeProps) {
  return (
    <View style={[styles.base, styles[variant], style]}>
      <Text style={[styles.text, styles[`text_${variant}`]]}>{label}</Text>
    </View>
  );
}

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const map: Record<BookingStatus, { label: string; variant: BadgeVariant }> = {
    confirmed: { label: 'Confirmed', variant: 'success' },
    waitlisted: { label: 'Waitlisted', variant: 'warning' },
    cancelled: { label: 'Cancelled', variant: 'error' },
  };
  const { label, variant } = map[status];
  return <Badge label={label} variant={variant} />;
}

export function PaymentStatusBadge({ status, method }: { status: PaymentStatus; method?: string }) {
  if (method === 'membership') return <Badge label="Membership" variant="info" />;
  if (method === 'cash') {
    if (status === 'paid') return <Badge label="Cash ✓" variant="success" />;
    return <Badge label="Cash — Awaiting" variant="warning" />;
  }
  const map: Record<PaymentStatus, { label: string; variant: BadgeVariant }> = {
    pending: { label: 'Pending', variant: 'warning' },
    paid: { label: 'Paid', variant: 'success' },
    refunded: { label: 'Refunded', variant: 'neutral' },
    no_refund: { label: 'No Refund', variant: 'error' },
  };
  const { label, variant } = map[status];
  return <Badge label={label} variant={variant} />;
}

export function MembershipStatusBadge({ status }: { status: MembershipStatus }) {
  const map: Record<MembershipStatus, { label: string; variant: BadgeVariant }> = {
    active: { label: 'Active', variant: 'success' },
    cancelled: { label: 'Cancelled', variant: 'neutral' },
    past_due: { label: 'Payment Due', variant: 'error' },
  };
  const { label, variant } = map[status];
  return <Badge label={label} variant={variant} />;
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  success: { backgroundColor: 'rgba(34,197,94,0.15)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)' },
  warning: { backgroundColor: 'rgba(245,158,11,0.15)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)' },
  error: { backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  neutral: { backgroundColor: COLORS.grey[800], borderWidth: 1, borderColor: COLORS.grey[700] },
  info: { backgroundColor: 'rgba(59,130,246,0.15)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)' },
  text_success: { color: COLORS.success },
  text_warning: { color: COLORS.warning },
  text_error: { color: COLORS.error },
  text_neutral: { color: COLORS.grey[400] },
  text_info: { color: '#60A5FA' },
});
