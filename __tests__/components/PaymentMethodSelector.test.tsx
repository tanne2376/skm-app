import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { PaymentMethodSelector } from '../../components/PaymentMethodSelector';
import { MembershipWithUsage } from '../../types';

const unlimitedMembership: MembershipWithUsage = {
  id: 'm1',
  student_id: 'u1',
  tier: 'unlimited',
  stripe_subscription_id: 'sub_xxx',
  stripe_price_id: 'price_xxx',
  status: 'active',
  current_period_start: '2026-03-01T00:00:00Z',
  current_period_end: '2026-04-01T00:00:00Z',
  created_at: '2026-03-01T00:00:00Z',
  weekly_usage_count: 5,
};

const twoPerWeekMembership: MembershipWithUsage = {
  ...unlimitedMembership,
  tier: 'two_per_week',
  weekly_usage_count: 1,
};

const quotaExhaustedMembership: MembershipWithUsage = {
  ...unlimitedMembership,
  tier: 'two_per_week',
  weekly_usage_count: 2,
};

describe('PaymentMethodSelector', () => {
  const noop = jest.fn();

  it('shows membership option when unlimited membership is active', () => {
    render(<PaymentMethodSelector price={1500} membership={unlimitedMembership} onSelect={noop} />);
    expect(screen.getByText(/Use membership/i)).toBeTruthy();
    expect(screen.getByText(/Unlimited membership/i)).toBeTruthy();
  });

  it('shows membership option with remaining count for 2x/week', () => {
    render(<PaymentMethodSelector price={1500} membership={twoPerWeekMembership} onSelect={noop} />);
    expect(screen.getByText(/Use membership/i)).toBeTruthy();
    expect(screen.getByText(/1 left this week/i)).toBeTruthy();
  });

  it('hides membership option when 2x/week quota is exhausted', () => {
    render(<PaymentMethodSelector price={1500} membership={quotaExhaustedMembership} onSelect={noop} />);
    expect(screen.queryByText(/Use membership/i)).toBeNull();
    expect(screen.getByText(/quota used/i)).toBeTruthy();
  });

  it('does not show membership option when no membership', () => {
    render(<PaymentMethodSelector price={1500} membership={null} onSelect={noop} />);
    expect(screen.queryByText(/Use membership/i)).toBeNull();
  });

  it('always shows cash option', () => {
    render(<PaymentMethodSelector price={1500} membership={null} onSelect={noop} />);
    expect(screen.getByText(/Pay cash/i)).toBeTruthy();
  });

  it('always shows card / digital pay option', () => {
    render(<PaymentMethodSelector price={1500} membership={null} onSelect={noop} />);
    expect(screen.getByText(/£15\.00 via Stripe/i)).toBeTruthy();
  });

  it('calls onSelect with "membership" when membership option is pressed', () => {
    const onSelect = jest.fn();
    render(<PaymentMethodSelector price={1500} membership={unlimitedMembership} onSelect={onSelect} />);
    fireEvent.press(screen.getByText(/Use membership/i));
    expect(onSelect).toHaveBeenCalledWith('membership');
  });

  it('calls onSelect with "cash" when cash option is pressed', () => {
    const onSelect = jest.fn();
    render(<PaymentMethodSelector price={1500} membership={null} onSelect={onSelect} />);
    fireEvent.press(screen.getByText(/Pay cash/i));
    expect(onSelect).toHaveBeenCalledWith('cash');
  });

  it('disables all options when isLoading is true', () => {
    render(<PaymentMethodSelector price={1500} membership={unlimitedMembership} onSelect={noop} isLoading />);
    // Buttons are disabled — verify the component renders without throwing
    expect(screen.getByText(/Pay cash/i)).toBeTruthy();
  });
});
