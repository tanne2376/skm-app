# Switch-Kick Mafia — Booking App

## Project overview
Mobile booking app for Switch-Kick Mafia martial arts club. iOS + Android.
Three user roles: **student**, **teacher**, **admin**.

## Stack
- **Expo** (SDK 54) + **TypeScript** + **Expo Router** (file-based routing)
- **Supabase** — Postgres, Auth, Edge Functions (Deno), Realtime, RLS
- **Stripe React Native SDK** — PaymentSheet, Apple Pay, Google Pay, subscriptions
- **TanStack Query v5** — data fetching / cache invalidation
- **Jest + React Native Testing Library** — unit tests

## Running locally
```bash
npm install
npx expo run:ios      # builds native dev client + opens iOS Simulator
npx expo run:android  # Android equivalent
npm test              # Jest unit tests
```

> **Expo Go will not work** — Stripe, SecureStore, and push notifications all require a native dev build.

## Environment
`.env.local` — never commit this file. Required keys:
```
EXPO_PUBLIC_SUPABASE_URL=https://amvajuqaxvedxlmszyjh.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
EAS_PROJECT_ID=...   # only needed for EAS cloud builds
```

## Supabase project
- **Project ID:** `amvajuqaxvedxlmszyjh`
- **Region:** eu-west-2
- **Dashboard:** https://supabase.com/dashboard/project/amvajuqaxvedxlmszyjh

Supabase secrets (set via `npx supabase secrets set ... --project-ref amvajuqaxvedxlmszyjh`):
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_TWO_PER_WEEK` = `price_1TGlQORuKnRvAEFQUYl0WUqm`
- `STRIPE_PRICE_UNLIMITED` = `price_1TGlQQRuKnRvAEFQHtWzcWPT`

## Stripe account
- **Account:** `acct_1T4ThJRuKnRvAEFQ` (SKM sandbox)
- **Webhook URL:** `https://amvajuqaxvedxlmszyjh.supabase.co/functions/v1/stripe-webhook`
- **Webhook events:** `payment_intent.succeeded`, `payment_intent.payment_failed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`
- **Products:** SKM 2x Per Week (£80/mo) · SKM Unlimited (£100/mo)

## Key business rules
- Class price: £15 default (configurable per template/session override)
- Memberships: £80/mo (2x/week) or £100/mo (unlimited), Stripe auto-renewing
- 2x/week quota tracked per **ISO week of the session date** (not booking date)
- Cancel **>3 hrs** before class → full refund; **≤3 hrs** → no refund, revenue kept
- Waitlist: FIFO, auto-charged on promotion (requires saved Stripe PaymentMethod)
- 1-to-1s are NOT covered by membership; price set per session by teacher/admin
- Cash payments confirmed manually by teacher/admin in My Classes roster view

## Database conventions
- **day_of_week** uses ISODOW: 1 = Monday, 7 = Sunday (never DOW/Sunday=0)
- **Prices** are always in **pence** (integer): £15.00 → 1500
- All timestamps are `timestamptz` stored in UTC
- `generate_sessions_ahead(4)` must be called weekly (Monday cron) to create session rows

## Tab structure by role
| Tab | Student | Teacher | Admin |
|-----|---------|---------|-------|
| Home | book classes | book classes | view/edit/cancel sessions |
| 1-to-1s | browse & book | browse/book + create | create & manage |
| My Classes | — | roster + cash confirm | — |
| Membership | manage | manage | — |
| Manage | — | — | timetable + sync |
| Settings | all | all | all |

## Project structure highlights
```
app/
  _layout.tsx              # Root: StripeProvider + QueryClient + AuthProvider + AuthGuard
  index.tsx                # Auth redirect
  (auth)/login.tsx
  (auth)/register.tsx
  (app)/_layout.tsx        # Role-based Tabs navigator
  (app)/home/index.tsx     # Upcoming classes (student/teacher booking OR admin management)
  (app)/one-to-ones/       # index, [id], create
  (app)/my-classes/        # index (teacher list), [id] (roster)
  (app)/membership/
  (app)/manage/            # Admin timetable management
  (app)/timetable/         # edit-template, edit-session (navigated to, not a tab)
  (app)/settings/
components/
  SessionCard.tsx          # 6 states: available/booked/waitlisted/full/cancelled/past
  PaymentMethodSelector.tsx
  ui/Button, Card, Badge, ScreenHeader
hooks/
  useAuth.tsx              # AuthContext + AuthProvider
  useClassSessions.ts      # useUpcomingSessions (7 days), accurate counts via RPC
  useActiveMembership.ts
  useBookSession.ts        # 3 paths: cash / membership / Stripe PaymentSheet
  useRealtime.ts
lib/
  supabase.ts              # ExpoSecureStore adapter (encrypted tokens)
  stripe.ts                # initializePaymentSheet, openPaymentSheet, formatGBP
  notifications.ts
supabase/
  migrations/              # 001–007 applied to amvajuqaxvedxlmszyjh
  functions/               # 8 Edge Functions (all deployed & ACTIVE)
```

## Edge Functions (all deployed)
| Function | JWT | Purpose |
|----------|-----|---------|
| `create-payment-intent` | ✅ | Class/1-to-1 payment, capacity lock |
| `book-with-membership` | ✅ | Membership quota check + direct booking |
| `cancel-booking` | ✅ | Refund logic + waitlist promotion trigger |
| `create-subscription` | ✅ | Stripe recurring subscription setup |
| `promote-waitlist` | ❌ | FIFO auto-charge on cancellation |
| `send-notification` | ❌ | Expo Push API wrapper |
| `stripe-webhook` | ❌ | Idempotent Stripe event handlers |
| `generate-sessions` | ❌ | Cron target — generates 4 weeks of sessions |

## Creating test users
1. Register via the app (Register screen) — trigger auto-creates the profile row
2. Promote roles via Supabase SQL Editor:
```sql
update profiles set role = 'teacher'
where id = (select id from auth.users where email = 'teacher@test.com');

update profiles set role = 'admin'
where id = (select id from auth.users where email = 'admin@test.com');
```

## Before going live (checklist)
- [ ] Replace placeholder gym addresses in `supabase/migrations/003_seed_defaults.sql` and re-apply, or update directly in Supabase dashboard (locations table)
- [ ] Set up Supabase cron job: every Monday 00:00 UTC → `select generate_sessions_ahead(4);`
- [ ] Register Apple Pay merchant ID (`merchant.com.switchkickmafia.app`) in Apple Developer portal
- [ ] Build + submit via EAS: `npx eas build --platform all --profile production`
- [ ] Switch Stripe keys from test (`pk_test_` / `sk_test_`) to live (`pk_live_` / `sk_live_`)
- [ ] Update Stripe webhook endpoint to production URL and replace `STRIPE_WEBHOOK_SECRET`
