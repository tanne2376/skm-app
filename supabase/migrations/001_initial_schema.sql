-- Enable required extensions
create extension if not exists "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================

create type user_role as enum ('student', 'teacher', 'admin');
create type booking_status as enum ('confirmed', 'waitlisted', 'cancelled');
create type payment_method_type as enum ('app', 'cash', 'membership');
create type payment_status_type as enum ('pending', 'paid', 'refunded', 'no_refund');
create type membership_tier as enum ('two_per_week', 'unlimited');
create type membership_status as enum ('active', 'cancelled', 'past_due');
create type one_to_one_status as enum ('available', 'booked', 'cancelled', 'completed');
create type location_type as enum ('predefined', 'custom');

-- ============================================================
-- PROFILES
-- ============================================================

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  role user_role not null default 'student',
  stripe_customer_id text unique,
  push_token text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- LOCATIONS (predefined training venues)
-- ============================================================

create table locations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- CLASS TEMPLATES (recurring weekly schedule)
-- day_of_week uses ISODOW: 1=Monday, 7=Sunday
-- price is in pence (GBP)
-- ============================================================

create table class_templates (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  start_time time not null,
  end_time time not null,
  capacity smallint not null default 20 check (capacity > 0),
  price integer not null default 1500 check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- CLASS SESSIONS (individual weekly instances)
-- capacity/price NULL means "inherit from template"
-- ============================================================

create table class_sessions (
  id uuid primary key default uuid_generate_v4(),
  template_id uuid not null references class_templates(id) on delete restrict,
  teacher_id uuid references profiles(id) on delete set null,
  session_date date not null,
  start_time time not null,
  end_time time not null,
  capacity smallint check (capacity > 0),       -- null = use template
  price integer check (price >= 0),              -- null = use template
  is_cancelled boolean not null default false,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  unique (template_id, session_date)
);

-- ============================================================
-- BOOKINGS
-- ============================================================

create table bookings (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references class_sessions(id) on delete restrict,
  student_id uuid not null references profiles(id) on delete restrict,
  status booking_status not null default 'confirmed',
  payment_method payment_method_type not null,
  payment_status payment_status_type not null default 'pending',
  stripe_payment_intent_id text unique,
  waitlist_position smallint,
  booked_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique (session_id, student_id)
);

-- ============================================================
-- MEMBERSHIPS
-- ============================================================

create table memberships (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references profiles(id) on delete restrict,
  tier membership_tier not null,
  stripe_subscription_id text unique,
  stripe_price_id text not null,
  status membership_status not null default 'active',
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- MEMBERSHIP WEEKLY USAGE (2x/week quota tracking)
-- week_start is the Monday (ISODOW) of the session's week
-- ============================================================

create table membership_weekly_usage (
  id uuid primary key default uuid_generate_v4(),
  membership_id uuid not null references memberships(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  week_start date not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ONE-TO-ONE SESSIONS
-- ============================================================

create table one_to_ones (
  id uuid primary key default uuid_generate_v4(),
  creator_id uuid not null references profiles(id) on delete restrict,
  teacher_id uuid not null references profiles(id) on delete restrict,
  student_id uuid references profiles(id) on delete set null,
  title text not null,
  description text,
  price integer not null check (price >= 0), -- pence
  session_date date not null,
  start_time time not null,
  end_time time not null,
  location_type location_type not null default 'predefined',
  location_id uuid references locations(id) on delete set null,
  location_text text,
  status one_to_one_status not null default 'available',
  payment_method payment_method_type,
  payment_status payment_status_type,
  stripe_payment_intent_id text unique,
  created_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index bookings_session_id_idx on bookings(session_id);
create index bookings_student_id_idx on bookings(student_id);
create index bookings_status_idx on bookings(status);
create index bookings_session_status_idx on bookings(session_id, status);
create index class_sessions_date_idx on class_sessions(session_date);
create index class_sessions_template_id_idx on class_sessions(template_id);
create index memberships_student_id_idx on memberships(student_id);
create index memberships_stripe_sub_idx on memberships(stripe_subscription_id);
create index membership_weekly_usage_student_week_idx on membership_weekly_usage(student_id, week_start);
create index one_to_ones_teacher_id_idx on one_to_ones(teacher_id);
create index one_to_ones_student_id_idx on one_to_ones(student_id);
create index one_to_ones_session_date_idx on one_to_ones(session_date);
create index one_to_ones_status_idx on one_to_ones(status);
