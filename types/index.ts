export type UserRole = 'student' | 'teacher' | 'admin';
export type BookingStatus = 'confirmed' | 'waitlisted' | 'cancelled';
export type PaymentMethod = 'app' | 'cash' | 'membership' | 'block';
export type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'no_refund';
export type MembershipTier = 'two_per_week' | 'unlimited';
export type MembershipStatus = 'active' | 'cancelling' | 'cancelled' | 'past_due';
export type OneToOneStatus = 'available' | 'booked' | 'cancelled' | 'completed';
export type LocationType = 'predefined' | 'custom';
export type BlockStatus =
  | 'pending_stripe'
  | 'active'
  | 'exhausted'
  | 'expired'
  | 'cancelled'
  | 'needs_review';
export type BlockPaymentMethod = 'stripe' | 'cash';

export type NotificationType =
  | 'waitlist_promotion'
  | 'one_to_one_available'
  | 'upcoming_class'
  | 'class_joined'
  | 'class_left'
  | 'one_to_one_booked'
  | 'class_full'
  | 'class_time_changed'
  | 'membership_renewal'
  | 'block_activated';

export type NotificationPreferences = Partial<Record<NotificationType, boolean>>;

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  stripe_customer_id: string | null;
  push_token: string | null;
  oto_default_price: number;
  notification_preferences: NotificationPreferences;
  created_at: string;
}

export interface Location {
  id: string;
  name: string;
  address: string;
  is_active: boolean;
  created_at: string;
}

export interface ClassTemplate {
  id: string;
  name: string;
  day_of_week: number; // 1=Mon, 7=Sun (ISODOW)
  start_time: string;  // "HH:MM:SS"
  end_time: string;
  capacity: number;
  price: number;       // pence
  is_active: boolean;
  created_at: string;
}

export interface ClassSession {
  id: string;
  template_id: string;
  teacher_id: string | null;
  session_date: string; // "YYYY-MM-DD"
  start_time: string;
  end_time: string;
  capacity: number | null; // null = use template
  price: number | null;    // null = use template
  is_cancelled: boolean;
  cancellation_reason: string | null;
  created_at: string;
}

export interface Booking {
  id: string;
  session_id: string;
  student_id: string;
  status: BookingStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  stripe_payment_intent_id: string | null;
  waitlist_position: number | null;
  booked_at: string;
  cancelled_at: string | null;
}

export type MembershipPaymentMethod = 'stripe' | 'cash';

export interface Membership {
  id: string;
  student_id: string;
  tier: MembershipTier;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  status: MembershipStatus;
  payment_method: MembershipPaymentMethod;
  payment_status: PaymentStatus;
  cash_confirmed_at: string | null;
  cash_confirmed_by: string | null;
  current_period_start: string;
  current_period_end: string;
  created_at: string;
}

export interface MembershipWeeklyUsage {
  id: string;
  membership_id: string;
  student_id: string;
  booking_id: string;
  week_start: string; // "YYYY-MM-DD" Monday of ISO week
  created_at: string;
}

export interface OneToOne {
  id: string;
  creator_id: string;
  teacher_id: string;
  student_id: string | null;
  title: string;
  description: string | null;
  price: number; // pence
  session_date: string;
  start_time: string;
  end_time: string;
  location_type: LocationType;
  location_id: string | null;
  location_text: string | null;
  status: OneToOneStatus;
  payment_method: PaymentMethod | null;
  payment_status: PaymentStatus | null;
  stripe_payment_intent_id: string | null;
  block_id: string | null;
  created_at: string;
}

// Composite types used in UI
export interface ClassSessionWithDetails extends ClassSession {
  class_templates: ClassTemplate;
  teacher: Pick<Profile, 'id' | 'full_name'> | null;
  confirmed_count: number;
  waitlist_count: number;
  user_booking?: Booking;
  effective_capacity: number;
  effective_price: number;
}

export interface BookingWithStudent extends Booking {
  profiles: Pick<Profile, 'id' | 'full_name'>;
}

export interface OneToOneWithDetails extends OneToOne {
  teacher: Pick<Profile, 'id' | 'full_name'>;
  student?: Pick<Profile, 'id' | 'full_name'> | null;
  location?: Pick<Location, 'id' | 'name' | 'address'> | null;
  block?: Pick<Block, 'id' | 'payment_status' | 'payment_method'> | null;
}

export interface MembershipWithUsage extends Membership {
  weekly_usage_count: number; // for two_per_week tier
  cash_grace_expires_at: string | null; // ISO; only set for cash/pending memberships
  cash_grace_expired: boolean; // derived: cash + pending + past grace_expires_at
}

export interface BlockTemplate {
  id: string;
  name: string;
  sessions_count: number;
  validity_days: number | null; // null = unlimited
  price_pence: number;
  is_active: boolean;
  created_at: string;
}

export interface Block {
  id: string;
  student_id: string;
  template_id: string;
  template_name_snapshot: string;
  sessions_total: number;
  validity_days_snapshot: number | null;
  price_pence_snapshot: number;
  status: BlockStatus;
  payment_method: BlockPaymentMethod;
  payment_status: PaymentStatus;
  sessions_used: number;
  cash_confirmed_at: string | null;
  cash_confirmed_by: string | null;
  stripe_payment_intent_id: string | null;
  created_at: string;
  activated_at: string | null;
  expires_at: string | null;
}

export interface BlockWithDerived extends Block {
  sessions_remaining: number;
  is_usable: boolean;            // active + remaining > 0 + not expired + (paid OR within grace)
  is_expired: boolean;
  cash_grace_expires_at: string | null;
  cash_grace_expired: boolean;
}
