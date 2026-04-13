import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, MEMBERSHIP_PRICES_PENCE } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { MembershipStatusBadge } from '@/components/ui/Badge';
import { useActiveMembership } from '@/hooks/useActiveMembership';
import { useCreateSubscription, useCancelSubscription, useResumeSubscription } from '@/hooks/useCreateSubscription';
import { formatGBP } from '@/lib/stripe';
import { MembershipTier } from '@/types';

export default function MembershipScreen() {
  const insets = useSafeAreaInsets();
  const { data: membership, isLoading, refetch } = useActiveMembership();
  const createSubscription = useCreateSubscription();
  const cancelSubscription = useCancelSubscription();
  const resumeSubscription = useResumeSubscription();
  const [selecting, setSelecting] = useState<MembershipTier | null>(null);

  function handleSubscribe(tier: MembershipTier) {
    Alert.alert(
      `Subscribe — ${tier === 'unlimited' ? 'Unlimited' : '2x/Week'}`,
      `${formatGBP(MEMBERSHIP_PRICES_PENCE[tier])} per month, auto-renewing. Cancel anytime.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => {
            setSelecting(tier);
            createSubscription.mutate(tier, {
              onSettled: () => setSelecting(null),
              onSuccess: () => refetch(),
            });
          },
        },
      ],
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="Membership" />
      <ScrollView contentContainerStyle={styles.content}>

        {/* Active membership */}
        {membership && (
          <Card style={styles.activeCard}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.membershipTitle}>
                  {membership.tier === 'unlimited' ? 'Unlimited' : '2x per Week'}
                </Text>
                <Text style={styles.membershipPrice}>
                  {formatGBP(MEMBERSHIP_PRICES_PENCE[membership.tier])}/month
                </Text>
              </View>
              <MembershipStatusBadge status={membership.status} />
            </View>

            {membership.tier === 'two_per_week' && (
              <View style={styles.quotaRow}>
                <Text style={styles.quotaLabel}>Classes used this week</Text>
                <Text style={styles.quotaValue}>{membership.weekly_usage_count} / 2</Text>
              </View>
            )}

            {membership.status === 'cancelling' ? (
              <View style={styles.warningBanner}>
                <Text style={styles.warningText}>
                  Your membership will end on {new Date(membership.current_period_end).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'long', year: 'numeric',
                  })}. You can still use it until then.
                </Text>
              </View>
            ) : (
              <Text style={styles.renewalDate}>
                Renews {new Date(membership.current_period_end).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'long', year: 'numeric',
                })}
              </Text>
            )}

            {membership.status === 'past_due' && (
              <View style={styles.warningBanner}>
                <Text style={styles.warningText}>
                  Payment failed — please update your payment method to keep your membership active.
                </Text>
              </View>
            )}

            {membership.status === 'cancelling' ? (
              <Button
                variant="primary"
                size="sm"
                style={styles.cancelButton}
                onPress={() => resumeSubscription.mutate(undefined, { onSuccess: () => refetch() })}
                loading={resumeSubscription.isPending}
              >
                Resume Membership
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                style={styles.cancelButton}
                onPress={() =>
                  Alert.alert(
                    'Cancel Membership',
                    'Your membership will remain active until the end of the current billing period. Are you sure?',
                    [
                      { text: 'Keep Membership', style: 'cancel' },
                      {
                        text: 'Cancel Membership',
                        style: 'destructive',
                        onPress: () => cancelSubscription.mutate(undefined, { onSuccess: () => refetch() }),
                      },
                    ],
                  )
                }
                loading={cancelSubscription.isPending}
              >
                Cancel Membership
              </Button>
            )}
          </Card>
        )}

        {/* Membership tiers */}
        {!membership && (
          <>
            <Text style={styles.sectionTitle}>Choose your plan</Text>

            <TierCard
              title="2x per Week"
              price={MEMBERSHIP_PRICES_PENCE.two_per_week}
              perks={[
                'Up to 2 classes per week',
                'Any class in the timetable',
                'Cancel anytime',
              ]}
              onPress={() => handleSubscribe('two_per_week')}
              loading={selecting === 'two_per_week'}
              disabled={!!selecting}
            />

            <TierCard
              title="Unlimited"
              price={MEMBERSHIP_PRICES_PENCE.unlimited}
              perks={[
                'Unlimited classes per week',
                'Any class in the timetable',
                'Cancel anytime',
              ]}
              onPress={() => handleSubscribe('unlimited')}
              loading={selecting === 'unlimited'}
              disabled={!!selecting}
            />
          </>
        )}

        <Text style={styles.disclaimer}>
          Memberships do not cover 1-to-1 sessions. Auto-renews on the 1st of each month. Cancel anytime.
        </Text>
      </ScrollView>
    </View>
  );
}

function TierCard({
  title,
  price,
  perks,
  highlighted = false,
  onPress,
  loading,
  disabled,
}: {
  title: string;
  price: number;
  perks: string[];
  highlighted?: boolean;
  onPress: () => void;
  loading: boolean;
  disabled: boolean;
}) {
  return (
    <Card style={[styles.tierCard, highlighted && styles.tierCardHighlighted]}>
      {highlighted && (
        <View style={styles.popularBadge}>
          <Text style={styles.popularText}>MOST POPULAR</Text>
        </View>
      )}
      <Text style={styles.tierTitle}>{title}</Text>
      <Text style={styles.tierPrice}>
        {formatGBP(price)}<Text style={styles.tierPriceSuffix}>/month</Text>
      </Text>
      {perks.map((perk) => (
        <Text key={perk} style={styles.perk}>✓  {perk}</Text>
      ))}
      <Button
        variant={highlighted ? 'primary' : 'secondary'}
        size="md"
        onPress={onPress}
        loading={loading}
        disabled={disabled}
        style={styles.tierButton}
      >
        Subscribe
      </Button>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  content: { padding: 16, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  flex: { flex: 1 },
  activeCard: { gap: 8 },
  membershipTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700' },
  membershipPrice: { color: COLORS.grey[400], fontSize: 14, marginTop: 2 },
  quotaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.grey[800] },
  quotaLabel: { color: COLORS.grey[400], fontSize: 14 },
  quotaValue: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  renewalDate: { color: COLORS.grey[600], fontSize: 12 },
  warningBanner: { backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  warningText: { color: COLORS.error, fontSize: 13 },
  cancelButton: { alignSelf: 'flex-start', marginTop: 8 },
  sectionTitle: { color: COLORS.white, fontSize: 20, fontWeight: '700' },
  tierCard: { gap: 10 },
  tierCardHighlighted: { borderColor: COLORS.accent, borderWidth: 2 },
  popularBadge: { backgroundColor: COLORS.accent, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100, alignSelf: 'flex-start' },
  popularText: { color: COLORS.white, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  tierTitle: { color: COLORS.white, fontSize: 20, fontWeight: '800' },
  tierPrice: { color: COLORS.white, fontSize: 28, fontWeight: '900' },
  tierPriceSuffix: { color: COLORS.grey[400], fontSize: 14, fontWeight: '400' },
  perk: { color: COLORS.grey[300], fontSize: 14 },
  tierButton: { marginTop: 4 },
  disclaimer: { color: COLORS.grey[600], fontSize: 12, textAlign: 'center', paddingVertical: 8 },
});
