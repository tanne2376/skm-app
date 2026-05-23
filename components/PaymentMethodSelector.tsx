import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '@/constants';
import { MembershipWithUsage, PaymentMethod } from '@/types';
import { formatGBP } from '@/lib/stripe';

interface PaymentMethodSelectorProps {
  price: number;
  membership?: MembershipWithUsage | null;
  onSelect: (method: PaymentMethod) => void;
  isLoading?: boolean;
}

export function PaymentMethodSelector({ price, membership, onSelect, isLoading = false }: PaymentMethodSelectorProps) {
  const canUseMembership = (() => {
    if (!membership || membership.status !== 'active') return false;
    if (membership.tier === 'unlimited') return true;
    return membership.weekly_usage_count < 2;
  })();

  const membershipLabel = (() => {
    if (!membership) return null;
    if (membership.tier === 'unlimited') return 'Unlimited membership';
    const remaining = 2 - membership.weekly_usage_count;
    return `2x/week membership (${remaining} left this week)`;
  })();

  const payLabel = Platform.OS === 'ios' ? ' Apple Pay' : Platform.OS === 'android' ? ' Google Pay' : ' Pay';

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>How would you like to pay?</Text>

      {canUseMembership && (
        <PayOption
          label="Use membership"
          sublabel={membershipLabel ?? ''}
          onPress={() => onSelect('membership')}
          disabled={isLoading}
          accent
        />
      )}

      <PayOption
        label={`${Platform.OS === 'ios' ? '🍎' : Platform.OS === 'android' ? '🤖' : '💳'}${payLabel} / Card`}
        sublabel={`${formatGBP(price)} via Stripe`}
        onPress={() => onSelect('app')}
        disabled={isLoading}
      />

      <PayOption
        label="Pay cash"
        sublabel="Your instructor will confirm payment"
        onPress={() => onSelect('cash')}
        disabled={isLoading}
      />

      {!canUseMembership && membership && membership.tier === 'two_per_week' && (
        <Text style={styles.quotaNote}>
          Weekly class quota used (2/2). Upgrade to unlimited for more.
        </Text>
      )}
    </View>
  );
}

function PayOption({
  label,
  sublabel,
  onPress,
  disabled,
  accent = false,
}: {
  label: string;
  sublabel: string;
  onPress: () => void;
  disabled: boolean;
  accent?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.option, accent && styles.optionAccent, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <Text style={[styles.optionLabel, accent && styles.optionLabelAccent]}>{label}</Text>
      <Text style={styles.optionSublabel}>{sublabel}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  heading: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  option: {
    backgroundColor: COLORS.grey[900],
    borderWidth: 1,
    borderColor: COLORS.grey[800],
    borderRadius: 10,
    padding: 14,
  },
  optionAccent: {
    borderColor: COLORS.accent,
    backgroundColor: 'rgba(200,16,46,0.08)',
  },
  disabled: { opacity: 0.5 },
  optionLabel: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  optionLabelAccent: {
    color: COLORS.accent,
  },
  optionSublabel: {
    color: COLORS.grey[400],
    fontSize: 13,
  },
  quotaNote: {
    color: COLORS.warning,
    fontSize: 12,
    textAlign: 'center',
    paddingTop: 4,
  },
});
