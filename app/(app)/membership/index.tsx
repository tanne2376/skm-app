import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, MEMBERSHIP_PRICES_PENCE } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, MembershipStatusBadge } from '@/components/ui/Badge';
import { router } from 'expo-router';
import { useActiveMembership, useKidsMemberships } from '@/hooks/useActiveMembership';
import { useChildren } from '@/hooks/useChildren';
import {
  useCreateSubscription, useCreateCashMembership, useCancelSubscription, useResumeSubscription, NewMembership,
} from '@/hooks/useCreateSubscription';
import { useActiveBlock } from '@/hooks/useActiveBlock';
import { useBlockTemplates } from '@/hooks/useBlockTemplates';
import { useCreateCashBlockPurchase, useCreateStripeBlockPurchase, useCancelBlock } from '@/hooks/useBlockPurchase';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { formatGBP } from '@/lib/stripe';
import { BlockTemplate, BlockWithDerived, Child, MembershipWithUsage } from '@/types';

export default function MembershipScreen() {
  const insets = useSafeAreaInsets();
  const requireAuth = useRequireAuth();
  const { data: membership, refetch } = useActiveMembership();
  const createSubscription = useCreateSubscription();
  const createCashMembership = useCreateCashMembership();
  const cancelSubscription = useCancelSubscription();
  const resumeSubscription = useResumeSubscription();
  const { data: kidsMemberships, refetch: refetchKids } = useKidsMemberships();
  const { data: children } = useChildren();
  // What's being started: tier plus child for a kids membership.
  const [selecting, setSelecting] = useState<(NewMembership & { method: 'stripe' | 'cash' }) | null>(null);

  const { data: block, refetch: refetchBlock } = useActiveBlock();
  const { data: blockTemplates } = useBlockTemplates({ activeOnly: true });
  const createCashBlock = useCreateCashBlockPurchase();
  const createStripeBlock = useCreateStripeBlockPurchase();
  const cancelBlock = useCancelBlock();
  const [selectingBlock, setSelectingBlock] = useState<{ id: string; method: 'stripe' | 'cash' } | null>(null);

  function membershipName(m: NewMembership): string {
    if (m.tier === 'kids') return `Kids — ${children?.find((c) => c.id === m.childId)?.full_name ?? 'child'}`;
    return m.tier === 'unlimited' ? 'Unlimited' : '2x/Week';
  }

  function refetchAll() {
    refetch();
    refetchKids();
  }

  function handleSubscribe(m: NewMembership) {
    requireAuth(() => {
      Alert.alert(
        `Subscribe — ${membershipName(m)}`,
        `${formatGBP(MEMBERSHIP_PRICES_PENCE[m.tier])} per month, auto-renewing. Cancel anytime.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Confirm',
            onPress: () => {
              setSelecting({ ...m, method: 'stripe' });
              createSubscription.mutate(m, {
                onSettled: () => setSelecting(null),
                onSuccess: refetchAll,
              });
            },
          },
        ],
      );
    });
  }

  function handlePayCash(m: NewMembership) {
    requireAuth(() => {
      Alert.alert(
        `Pay with Cash — ${membershipName(m)}`,
        `The membership activates immediately. You have 72 hours to pay ${formatGBP(MEMBERSHIP_PRICES_PENCE[m.tier])} in cash to a class leader, or it will be paused until paid. Continue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Activate',
            onPress: () => {
              setSelecting({ ...m, method: 'cash' });
              createCashMembership.mutate(m, {
                onSettled: () => setSelecting(null),
                onSuccess: refetchAll,
              });
            },
          },
        ],
      );
    });
  }

  // membershipId is only sent for kids memberships; the account holder's own
  // is the edge functions' default.
  function confirmCancelMembership(m: MembershipWithUsage, childName?: string) {
    const membershipId = m.child_id ? m.id : undefined;
    Alert.alert(
      'Cancel Membership',
      `${childName ? `${childName}’s kids membership` : 'Your membership'} will remain active until the end of the current billing period. Are you sure?`,
      [
        { text: 'Keep Membership', style: 'cancel' },
        {
          text: 'Cancel Membership',
          style: 'destructive',
          onPress: () => cancelSubscription.mutate(membershipId, { onSuccess: refetchAll }),
        },
      ],
    );
  }

  const isSelecting = (m: NewMembership, method: 'stripe' | 'cash') =>
    selecting?.method === method && selecting.tier === m.tier && selecting.childId === m.childId;

  function handleBuyBlockStripe(t: BlockTemplate) {
    requireAuth(() => {
      Alert.alert(
        `Buy ${t.name}`,
        `${t.sessions_count} sessions${t.validity_days ? ` valid for ${t.validity_days} days` : ' (never expires)'}. ${formatGBP(t.price_pence)} via card.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Pay',
            onPress: () => {
              setSelectingBlock({ id: t.id, method: 'stripe' });
              createStripeBlock.mutate(t.id, {
                onSettled: () => setSelectingBlock(null),
                onSuccess: () => refetchBlock(),
              });
            },
          },
        ],
      );
    });
  }

  function handleBuyBlockCash(t: BlockTemplate) {
    requireAuth(() => {
      Alert.alert(
        `Buy ${t.name} — Cash`,
        `Your block activates immediately. You have 72 hours to pay ${formatGBP(t.price_pence)} in cash to a class leader, or your block will be paused until paid. Continue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Activate',
            onPress: () => {
              setSelectingBlock({ id: t.id, method: 'cash' });
              createCashBlock.mutate(t.id, {
                onSettled: () => setSelectingBlock(null),
                onSuccess: () => refetchBlock(),
              });
            },
          },
        ],
      );
    });
  }

  function handleCancelBlock(b: BlockWithDerived) {
    const hasSessionsRemaining =
      b.sessions_remaining > 0 && !b.is_expired && !b.cash_grace_expired;
    const message = hasSessionsRemaining
      ? `Cancelling forfeits your ${b.sessions_remaining} remaining session${
          b.sessions_remaining === 1 ? '' : 's'
        }. No refund. You'll be able to buy a new block straight away.`
      : 'This frees the slot so you can buy a new block. No refund.';
    Alert.alert('Cancel Block', message, [
      { text: 'Keep Block', style: 'cancel' },
      {
        text: 'Cancel Block',
        style: 'destructive',
        onPress: () => cancelBlock.mutate(b.id, { onSuccess: () => refetchBlock() }),
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Membership" />
      <ScrollView contentContainerStyle={styles.content}>

        {/* Active membership */}
        {membership && (
          <ActiveMembershipCard
            membership={membership}
            title={membership.tier === 'unlimited' ? 'Unlimited' : '2x per Week'}
            onCancel={() => confirmCancelMembership(membership)}
            onResume={() => resumeSubscription.mutate(undefined, { onSuccess: () => refetch() })}
            cancelLoading={cancelSubscription.isPending && cancelSubscription.variables === undefined}
            resumeLoading={resumeSubscription.isPending && resumeSubscription.variables === undefined}
          />
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
                'Any adult class in the timetable',
                'Cancel anytime',
              ]}
              onSubscribe={() => handleSubscribe({ tier: 'two_per_week' })}
              onPayCash={() => handlePayCash({ tier: 'two_per_week' })}
              subscribeLoading={isSelecting({ tier: 'two_per_week' }, 'stripe')}
              cashLoading={isSelecting({ tier: 'two_per_week' }, 'cash')}
              disabled={!!selecting}
            />

            <TierCard
              title="Unlimited"
              price={MEMBERSHIP_PRICES_PENCE.unlimited}
              perks={[
                'Unlimited classes per week',
                'Any adult class in the timetable',
                'Cancel anytime',
              ]}
              onSubscribe={() => handleSubscribe({ tier: 'unlimited' })}
              onPayCash={() => handlePayCash({ tier: 'unlimited' })}
              subscribeLoading={isSelecting({ tier: 'unlimited' }, 'stripe')}
              cashLoading={isSelecting({ tier: 'unlimited' }, 'cash')}
              disabled={!!selecting}
            />
          </>
        )}

        {/* Kids memberships: one per child, the only way into kids classes */}
        <Text style={styles.sectionTitle}>Kids Membership</Text>
        <Text style={styles.sectionNote}>
          {formatGBP(MEMBERSHIP_PRICES_PENCE.kids)}/month per child for unlimited kids classes. Kids classes can only be booked with a kids membership.
        </Text>
        {children && children.length > 0 ? (
          children.map((child) => {
            const kidsMembership = kidsMemberships?.find((m) => m.child_id === child.id);
            const m: NewMembership = { tier: 'kids', childId: child.id };
            return kidsMembership ? (
              <ActiveMembershipCard
                key={child.id}
                membership={kidsMembership}
                title={child.full_name}
                subtitle="Kids · unlimited kids classes"
                onCancel={() => confirmCancelMembership(kidsMembership, child.full_name)}
                onResume={() => resumeSubscription.mutate(kidsMembership.id, { onSuccess: refetchAll })}
                cancelLoading={cancelSubscription.isPending && cancelSubscription.variables === kidsMembership.id}
                resumeLoading={resumeSubscription.isPending && resumeSubscription.variables === kidsMembership.id}
              />
            ) : (
              <KidsTierCard
                key={child.id}
                child={child}
                onSubscribe={() => handleSubscribe(m)}
                onPayCash={() => handlePayCash(m)}
                subscribeLoading={isSelecting(m, 'stripe')}
                cashLoading={isSelecting(m, 'cash')}
                disabled={!!selecting}
              />
            );
          })
        ) : (
          <Card style={styles.tierCard}>
            <Text style={styles.perk}>Add your children to your account to take out a kids membership for them.</Text>
            <Button variant="secondary" size="md" onPress={() => requireAuth(() => router.push('/(app)/settings/family'))}>
              Add a Child
            </Button>
          </Card>
        )}

        {/* 1-to-1 Blocks section */}
        {block ? (
          <ActiveBlockCard
            block={block}
            onCancel={() => handleCancelBlock(block)}
            cancelLoading={cancelBlock.isPending}
          />
        ) : (blockTemplates?.length ?? 0) > 0 ? (
          <>
            <Text style={styles.sectionTitle}>1-to-1 Session Blocks</Text>
            {blockTemplates!.map((t) => (
              <BlockTemplateCard
                key={t.id}
                template={t}
                onBuyStripe={() => handleBuyBlockStripe(t)}
                onBuyCash={() => handleBuyBlockCash(t)}
                stripeLoading={selectingBlock?.id === t.id && selectingBlock.method === 'stripe'}
                cashLoading={selectingBlock?.id === t.id && selectingBlock.method === 'cash'}
                disabled={!!selectingBlock}
              />
            ))}
            <Text style={styles.disclaimer}>Blocks apply to 1-to-1 sessions only.</Text>
          </>
        ) : null}

        <Text style={styles.disclaimer}>
          Memberships do not cover 1-to-1 sessions. Adult memberships do not cover kids classes. Auto-renews on the 1st of each month. Cancel anytime.
        </Text>
      </ScrollView>
    </View>
  );
}

function ActiveMembershipCard({
  membership,
  title,
  subtitle,
  onCancel,
  onResume,
  cancelLoading,
  resumeLoading,
}: {
  membership: MembershipWithUsage;
  title: string;
  subtitle?: string;
  onCancel: () => void;
  onResume: () => void;
  cancelLoading: boolean;
  resumeLoading: boolean;
}) {
  const price = formatGBP(MEMBERSHIP_PRICES_PENCE[membership.tier]);
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <Card style={styles.activeCard}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.membershipTitle}>{title}</Text>
          <Text style={styles.membershipPrice}>
            {subtitle ? `${subtitle} · ` : ''}{price}/month
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
            This membership will end on {formatDate(membership.current_period_end)}. It can still be used until then.
          </Text>
        </View>
      ) : membership.payment_method === 'cash' ? (
        <Text style={styles.renewalDate}>
          Active until {formatDate(membership.current_period_end)} (cash, does not auto-renew)
        </Text>
      ) : (
        <Text style={styles.renewalDate}>Renews {formatDate(membership.current_period_end)}</Text>
      )}

      {membership.payment_method === 'cash' && membership.payment_status === 'pending' && (
        <View style={membership.cash_grace_expired ? styles.warningBanner : styles.cashPendingBanner}>
          <Text style={membership.cash_grace_expired ? styles.warningText : styles.cashPendingText}>
            {membership.cash_grace_expired
              ? `Cash payment overdue — this membership is paused until a class leader confirms payment of ${price}.`
              : `Cash pending — pay ${price} to a class leader by ${new Date(membership.cash_grace_expires_at!).toLocaleString('en-GB', {
                  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}.`}
          </Text>
        </View>
      )}

      {membership.status === 'past_due' && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>
            Payment failed — please update your payment method to keep this membership active.
          </Text>
        </View>
      )}

      {membership.status === 'cancelling' ? (
        <Button variant="primary" size="sm" style={styles.cancelButton} onPress={onResume} loading={resumeLoading}>
          Resume Membership
        </Button>
      ) : (
        <Button variant="ghost" size="sm" style={styles.cancelButton} onPress={onCancel} loading={cancelLoading}>
          Cancel Membership
        </Button>
      )}
    </Card>
  );
}

function KidsTierCard({
  child,
  onSubscribe,
  onPayCash,
  subscribeLoading,
  cashLoading,
  disabled,
}: {
  child: Child;
  onSubscribe: () => void;
  onPayCash: () => void;
  subscribeLoading: boolean;
  cashLoading: boolean;
  disabled: boolean;
}) {
  return (
    <Card style={styles.tierCard}>
      <Text style={styles.membershipTitle}>{child.full_name}</Text>
      <Text style={styles.membershipPrice}>No kids membership</Text>
      <Button
        variant="secondary"
        size="md"
        onPress={onSubscribe}
        loading={subscribeLoading}
        disabled={disabled}
        style={styles.tierButton}
      >
        {`Subscribe — ${formatGBP(MEMBERSHIP_PRICES_PENCE.kids)}/month`}
      </Button>
      <Button variant="ghost" size="md" onPress={onPayCash} loading={cashLoading} disabled={disabled}>
        Pay with Cash
      </Button>
    </Card>
  );
}

function ActiveBlockCard({
  block,
  onCancel,
  cancelLoading,
}: {
  block: BlockWithDerived;
  onCancel: () => void;
  cancelLoading: boolean;
}) {
  return (
    <Card style={styles.activeCard}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.membershipTitle}>{block.template_name_snapshot}</Text>
          <Text style={styles.membershipPrice}>
            {block.sessions_used} of {block.sessions_total} sessions used
          </Text>
        </View>
        <Badge
          label={
            block.cash_grace_expired
              ? 'Paused'
              : block.is_expired
                ? 'Expired'
                : block.sessions_remaining === 0
                  ? 'Used Up'
                  : 'Active'
          }
          variant={
            block.cash_grace_expired || block.is_expired
              ? 'error'
              : block.sessions_remaining === 0
                ? 'neutral'
                : 'success'
          }
        />
      </View>

      <Text style={styles.renewalDate}>
        {block.expires_at
          ? `Expires ${new Date(block.expires_at).toLocaleDateString('en-GB', {
              day: 'numeric', month: 'long', year: 'numeric',
            })}`
          : 'Never expires'}
      </Text>

      {block.payment_method === 'cash' && block.payment_status === 'pending' && (
        <View style={block.cash_grace_expired ? styles.warningBanner : styles.cashPendingBanner}>
          <Text style={block.cash_grace_expired ? styles.warningText : styles.cashPendingText}>
            {block.cash_grace_expired
              ? `Cash payment overdue — your block is paused until a class leader confirms payment of ${formatGBP(block.price_pence_snapshot)}.`
              : `Cash pending — pay ${formatGBP(block.price_pence_snapshot)} to a class leader by ${new Date(block.cash_grace_expires_at!).toLocaleString('en-GB', {
                  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}.`}
          </Text>
        </View>
      )}

      <Button
        variant="ghost"
        size="sm"
        style={styles.cancelButton}
        onPress={onCancel}
        loading={cancelLoading}
      >
        Cancel Block
      </Button>
    </Card>
  );
}

function BlockTemplateCard({
  template,
  onBuyStripe,
  onBuyCash,
  stripeLoading,
  cashLoading,
  disabled,
}: {
  template: BlockTemplate;
  onBuyStripe: () => void;
  onBuyCash: () => void;
  stripeLoading: boolean;
  cashLoading: boolean;
  disabled: boolean;
}) {
  return (
    <Card style={styles.tierCard}>
      <Text style={styles.membershipTitle}>{template.name}</Text>
      <Text style={styles.membershipPrice}>{formatGBP(template.price_pence)}</Text>
      <Text style={styles.perk}>
        ✓  {template.sessions_count} 1-to-1 session{template.sessions_count === 1 ? '' : 's'}
        {' · '}
        {template.validity_days === null ? 'Never expires' : `Valid ${template.validity_days} days`}
      </Text>
      <Button
        variant="secondary"
        size="md"
        onPress={onBuyStripe}
        loading={stripeLoading}
        disabled={disabled}
        style={styles.tierButton}
      >
        Pay with Card
      </Button>
      <Button
        variant="ghost"
        size="md"
        onPress={onBuyCash}
        loading={cashLoading}
        disabled={disabled}
      >
        Pay with Cash
      </Button>
    </Card>
  );
}

function TierCard({
  title,
  price,
  perks,
  highlighted = false,
  onSubscribe,
  onPayCash,
  subscribeLoading,
  cashLoading,
  disabled,
}: {
  title: string;
  price: number;
  perks: string[];
  highlighted?: boolean;
  onSubscribe: () => void;
  onPayCash: () => void;
  subscribeLoading: boolean;
  cashLoading: boolean;
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
        onPress={onSubscribe}
        loading={subscribeLoading}
        disabled={disabled}
        style={styles.tierButton}
      >
        Subscribe
      </Button>
      <Button
        variant="ghost"
        size="md"
        onPress={onPayCash}
        loading={cashLoading}
        disabled={disabled}
      >
        Pay with Cash
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
  cashPendingBanner: { backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)' },
  cashPendingText: { color: COLORS.warning, fontSize: 13 },
  cancelButton: { alignSelf: 'flex-start', marginTop: 8 },
  sectionTitle: { color: COLORS.white, fontSize: 20, fontWeight: '700' },
  sectionNote: { color: COLORS.grey[400], fontSize: 13, marginTop: -8 },
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
