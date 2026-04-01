import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Badge, BookingStatusBadge, PaymentStatusBadge, MembershipStatusBadge } from '../../components/ui/Badge';

describe('Badge', () => {
  it('renders label text', () => {
    render(<Badge label="Active" />);
    expect(screen.getByText('Active')).toBeTruthy();
  });
});

describe('BookingStatusBadge', () => {
  it('renders Confirmed for confirmed status', () => {
    render(<BookingStatusBadge status="confirmed" />);
    expect(screen.getByText('Confirmed')).toBeTruthy();
  });

  it('renders Waitlisted for waitlisted status', () => {
    render(<BookingStatusBadge status="waitlisted" />);
    expect(screen.getByText('Waitlisted')).toBeTruthy();
  });

  it('renders Cancelled for cancelled status', () => {
    render(<BookingStatusBadge status="cancelled" />);
    expect(screen.getByText('Cancelled')).toBeTruthy();
  });
});

describe('PaymentStatusBadge', () => {
  it('shows Membership badge for membership payment method', () => {
    render(<PaymentStatusBadge status="paid" method="membership" />);
    expect(screen.getByText('Membership')).toBeTruthy();
  });

  it('shows Cash ✓ when cash is confirmed', () => {
    render(<PaymentStatusBadge status="paid" method="cash" />);
    expect(screen.getByText('Cash ✓')).toBeTruthy();
  });

  it('shows Cash — Awaiting when cash is pending', () => {
    render(<PaymentStatusBadge status="pending" method="cash" />);
    expect(screen.getByText('Cash — Awaiting')).toBeTruthy();
  });

  it('shows Paid for app payment', () => {
    render(<PaymentStatusBadge status="paid" method="app" />);
    expect(screen.getByText('Paid')).toBeTruthy();
  });

  it('shows No Refund for no_refund status', () => {
    render(<PaymentStatusBadge status="no_refund" />);
    expect(screen.getByText('No Refund')).toBeTruthy();
  });
});

describe('MembershipStatusBadge', () => {
  it('renders Active', () => {
    render(<MembershipStatusBadge status="active" />);
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('renders Cancelled', () => {
    render(<MembershipStatusBadge status="cancelled" />);
    expect(screen.getByText('Cancelled')).toBeTruthy();
  });

  it('renders Payment Due for past_due', () => {
    render(<MembershipStatusBadge status="past_due" />);
    expect(screen.getByText('Payment Due')).toBeTruthy();
  });
});
