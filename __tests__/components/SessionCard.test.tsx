import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { SessionCard } from '../../components/SessionCard';
import { ClassSessionWithDetails } from '../../types';

// SessionCard now uses useDefaultClassLeaderName for the "Admin" fallback
// when neither session nor template has a teacher. Stub it so render() works
// without a QueryClient.
jest.mock('../../hooks/useDefaultClassLeader', () => ({
  useDefaultClassLeaderName: () => ({ data: 'Admin' }),
}));

const base: ClassSessionWithDetails = {
  id: 'session-1',
  template_id: 'tmpl-1',
  teacher_id: 'teacher-1',
  session_date: '2099-01-01', // far future — not past
  start_time: '18:30:00',
  end_time: '19:30:00',
  capacity: null,
  price: null,
  is_cancelled: false,
  cancellation_reason: null,
  created_at: '2026-01-01T00:00:00Z',
  class_templates: {
    id: 'tmpl-1',
    name: 'Muay Thai (Beginners)',
    day_of_week: 1,
    start_time: '18:30:00',
    end_time: '19:30:00',
    capacity: 20,
    price: 1500,
    teacher_id: 'teacher-1',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    teacher: { id: 'teacher-1', full_name: 'Jane Smith' },
  },
  teacher: { id: 'teacher-1', full_name: 'Jane Smith' },
  confirmed_count: 5,
  waitlist_count: 0,
  user_booking: undefined,
  effective_capacity: 20,
  effective_price: 1500,
};

describe('SessionCard', () => {
  const noop = jest.fn();

  it('renders class name and time', () => {
    render(<SessionCard session={base} onBook={noop} onCancel={noop} />);
    expect(screen.getByText('Muay Thai (Beginners)')).toBeTruthy();
    expect(screen.getByText(/18:30/)).toBeTruthy();
  });

  it('shows Book button when not booked and spots available', () => {
    render(<SessionCard session={base} onBook={noop} onCancel={noop} />);
    expect(screen.getByText('Book')).toBeTruthy();
  });

  it('shows Confirmed badge when user has confirmed booking', () => {
    const withBooking: ClassSessionWithDetails = {
      ...base,
      user_booking: {
        id: 'b1',
        session_id: 'session-1',
        student_id: 'student-1',
        status: 'confirmed',
        payment_method: 'app',
        payment_status: 'paid',
        stripe_payment_intent_id: null,
        waitlist_position: null,
        booked_at: '2026-01-01T00:00:00Z',
        cancelled_at: null,
      },
    };
    render(<SessionCard session={withBooking} onBook={noop} onCancel={noop} />);
    expect(screen.getByText('Confirmed')).toBeTruthy();
    expect(screen.getByText(/Cancel Booking/i)).toBeTruthy();
  });

  it('shows waitlist position when user is waitlisted', () => {
    const waitlisted: ClassSessionWithDetails = {
      ...base,
      confirmed_count: 20,
      user_booking: {
        id: 'b2',
        session_id: 'session-1',
        student_id: 'student-1',
        status: 'waitlisted',
        payment_method: 'app',
        payment_status: 'pending',
        stripe_payment_intent_id: null,
        waitlist_position: 3,
        booked_at: '2026-01-01T00:00:00Z',
        cancelled_at: null,
      },
    };
    render(<SessionCard session={waitlisted} onBook={noop} onCancel={noop} />);
    expect(screen.getByText(/#3 on waitlist/i)).toBeTruthy();
  });

  it('shows Full + Join Waitlist when class is at capacity', () => {
    const full: ClassSessionWithDetails = {
      ...base,
      confirmed_count: 20,
    };
    render(<SessionCard session={full} onBook={noop} onCancel={noop} />);
    expect(screen.getByText('Full')).toBeTruthy();
    expect(screen.getByText(/Add to Waitlist/i)).toBeTruthy();
  });

  it('shows Cancelled badge when session is cancelled', () => {
    const cancelled: ClassSessionWithDetails = {
      ...base,
      is_cancelled: true,
      cancellation_reason: 'Instructor unavailable',
    };
    render(<SessionCard session={cancelled} onBook={noop} onCancel={noop} />);
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.getByText('Instructor unavailable')).toBeTruthy();
  });

  it('shows no-refund warning within 3-hour cancellation window', () => {
    // Session starts in 2 hours
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const soonDate = soon.toISOString().split('T')[0];
    const soonTime = soon.toTimeString().slice(0, 8);

    const withBooking: ClassSessionWithDetails = {
      ...base,
      session_date: soonDate,
      start_time: soonTime,
      user_booking: {
        id: 'b3',
        session_id: 'session-1',
        student_id: 'student-1',
        status: 'confirmed',
        payment_method: 'app',
        payment_status: 'paid',
        stripe_payment_intent_id: null,
        waitlist_position: null,
        booked_at: '2026-01-01T00:00:00Z',
        cancelled_at: null,
      },
    };
    render(<SessionCard session={withBooking} onBook={noop} onCancel={noop} />);
    // Both the warning label and the cancel button mention "no refund"
    expect(screen.getAllByText(/no refund/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows past label and no action buttons for past sessions', () => {
    const past: ClassSessionWithDetails = {
      ...base,
      session_date: '2000-01-01',
      start_time: '10:00:00',
    };
    render(<SessionCard session={past} onBook={noop} onCancel={noop} />);
    expect(screen.getByText(/ended/i)).toBeTruthy();
    expect(screen.queryByText(/Pay/i)).toBeNull();
  });

  it('calls onBook when Pay button is pressed', () => {
    const onBook = jest.fn();
    render(<SessionCard session={base} onBook={onBook} onCancel={noop} />);
    fireEvent.press(screen.getByText('Book'));
    expect(onBook).toHaveBeenCalledTimes(1);
  });
});
