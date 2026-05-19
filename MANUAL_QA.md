# Manual QA — SKM Booking App

Smoke + regression tests to run on a **real device** (TestFlight build for iOS, internal-testing track for Android) before each release. The simulator/emulator can't tell you about Apple Pay, Google Pay, push notifications, deep links, SecureStore, real network conditions, or background-task behaviour. This document is the catch.

Run the full suite at major release points; run the **Smoke (must-pass)** subset for any production push.

---

## Setup

Before any QA pass, make sure you have:

- [ ] Real iPhone with TestFlight build installed
- [ ] Real Android device with internal-testing build installed
- [ ] Three test accounts you can sign into, one of each role: `student@test.com`, `teacher@test.com`, `admin@test.com` (promote roles via the SQL Editor — see `CLAUDE.md`)
- [ ] A real card you don't mind charging (Stripe test cards aren't enough — Apple/Google Pay want a real-looking card). Use `4242 4242 4242 4242` only for the in-PaymentSheet card path.
- [ ] Apple Pay set up on the iPhone with a test card in the Wallet
- [ ] Google Pay set up on the Android device with a test card
- [ ] Stripe dashboard open in test mode for spot-verification of webhooks and customer/payment-intent rows
- [ ] Supabase dashboard open for spot-verification of DB rows
- [ ] Notification permissions GRANTED on both devices (re-grant after a fresh install if previously denied)
- [ ] At least one **block template** and one **class template** seeded so the screens have content
- [ ] At least one **future class session** generated (the weekly cron should keep this true, but verify on the home screen)

---

## Smoke (must-pass before any production push)

15-minute pass. If any of these fail, do not ship.

- [ ] Cold-start the app on a fresh install → register a new account → email lands (check spam) → log in → home shows upcoming classes
- [ ] Push notification permission prompt appears on first login
- [ ] Apple Pay button shows in the PaymentSheet on iOS, Google Pay on Android (book any class, hit "Pay")
- [ ] Book a class with card via PaymentSheet → booking appears in My Classes / Home → no errors in Stripe dashboard webhook log
- [ ] Force-quit the app → reopen → still logged in (SecureStore persistence)
- [ ] Tap a push notification from cold-start state → app opens to the right screen (not just the home screen)
- [ ] Toggle role in DB to teacher / admin → log out and back in → tabs change to the right set
- [ ] Pull-to-refresh on Home updates the list without an error toast
- [ ] Switch off Wi-Fi + cellular → open the app → loading state shown, no crash → reconnect → data reloads

---

## Authentication & Onboarding

- [ ] Register with a brand-new email → trigger auto-creates the `profiles` row (verify in DB)
- [ ] Register with an existing email → friendly error, no crash
- [ ] Register with a weak password (< 6 chars) → Supabase rejects with a useful message
- [ ] Register with phone left blank → succeeds (phone is optional)
- [ ] Log in with wrong password → friendly error, can retry
- [ ] Log out → returns to login screen → can re-register / re-login
- [ ] Forgot password → enter email → recovery email arrives → tap link → opens app via `skm://` deep link → set new password screen appears → submit → can log in with new password
- [ ] Change password while logged in → succeeds → next login uses new password
- [ ] Background the app for 1+ hour → reopen → session still valid (token auto-refresh)
- [ ] After Supabase JWT expiry (>1h), make any data request → no spurious 401 (refresh works silently)

---

## Push Notifications

These can only be tested end-to-end on a real device.

### Permission & token

- [ ] First login after fresh install: permission prompt appears
- [ ] Granting permission: `profiles.push_token` populated in DB (verify in Supabase dashboard)
- [ ] Denying permission: app continues to work, no nag screens
- [ ] Re-enabling notifications in iOS Settings / Android Settings → token re-registered on next foreground

### Delivery — verify each notification type fires

For each type below, trigger the event (column 2) as the right role and confirm the push arrives on the **recipient's** device.

| Notification type | Trigger | Recipient |
|---|---|---|
| `class_joined` | Student books a class | Teacher of that class + all admins |
| `class_full` | Last spot is taken | Teacher of that class |
| `class_time_changed` | Admin edits a session's time | All students with bookings in that session |
| `one_to_one_available` | Teacher creates a 1-to-1 | All students (broadcast) |
| `one_to_one_booked` | Student books a 1-to-1 | The 1-to-1's creator |
| `waitlist_promotion` | A student cancels and waitlist auto-charges next | The student promoted off the waitlist |
| `upcoming_class` | 1 hour before any booked class (scheduled push) | The student who booked it |
| `membership_renewal` | Stripe `invoice.payment_failed` OR `customer.subscription.deleted` | The membership holder |
| `block_activated` | Stripe webhook activates a paid block | The student who bought it |

- [ ] Each type also delivers when the app is **backgrounded**
- [ ] Each type also delivers when the app is **killed**
- [ ] Tapping a notification when app is killed → opens to the right screen (not just home tab)
- [ ] Tapping a notification when app is backgrounded → foregrounds to the right screen
- [ ] Settings → Notification Preferences: toggle a type off → trigger that type → notification does NOT arrive (other types still do)

---

## Class Booking — Student

### Stripe paths

- [ ] Apple Pay: book a class → PaymentSheet → choose Apple Pay → Face ID / Touch ID → success → My Classes shows the booking → notification fires to teacher → Stripe dashboard shows the payment_intent
- [ ] Google Pay: same flow on Android
- [ ] Card via PaymentSheet (`4242 4242 4242 4242`, any future expiry, any CVC) → same success path
- [ ] Card with `4000 0000 0000 0002` (declined) → friendly error, no booking row
- [ ] Cancel the PaymentSheet mid-flow → booking row is NOT created (verify in DB)
- [ ] Network drop mid-payment → app handles gracefully (either retry succeeds or clear error)

### Membership path

- [ ] Active 2x/week membership: book first class → succeeds, quota now 1/2
- [ ] Book second class same ISO week → succeeds, quota 2/2
- [ ] Book third class same ISO week → blocked with "Weekly class quota reached"
- [ ] Cancel one of the booked classes >3h before → quota goes back to 1/2 → can book another
- [ ] Active Unlimited membership: book 3+ classes in a week → all succeed

### Cash path

- [ ] Book a class with cash → booking shows as `pending` payment status
- [ ] My Classes shows it with a "Cash pending" badge / indicator (verify wording)

### Waitlist

- [ ] Book until class is full (use multiple test accounts or set capacity low in DB)
- [ ] Next student to book lands on the waitlist
- [ ] Pull-to-refresh shows current waitlist position
- [ ] First booked student cancels → waitlist student gets `waitlist_promotion` push → charged automatically (verify in Stripe dashboard) → status flips to confirmed

### Cancellation rules

- [ ] Cancel >3 hours before class → full refund (verify in Stripe dashboard `refund` event)
- [ ] Cancel ≤3 hours before class → no refund (verify booking marked `cancelled` but payment_status stays `paid`)
- [ ] Cancel a cash booking → goes to `cancelled`, no payment owed (verify `get_user_owed_amount` doesn't include it)
- [ ] Late-cancel 3+ times in a month → 4th booking attempt blocked with the "currently blocked" message
- [ ] Admin clears the user's late cancellation count → student can book again

---

## Class Booking — Teacher / Admin

- [ ] Teacher sees their classes in My Classes → roster lists every confirmed booking
- [ ] Teacher confirms a cash payment → button toggles to "Confirmed" → `bookings.payment_status` flips to `paid` in DB
- [ ] Admin from Home → edit a session (change capacity / cancel session) → affected students get `class_time_changed` push
- [ ] Admin cancels a future session → all students with bookings get refunded (Stripe) or marked owed-zero (cash) — verify both paths
- [ ] Roster shows real-time updates when a new student books (TanStack Query realtime invalidation)

---

## 1-to-1 Sessions

### Student

- [ ] Available tab lists future 1-to-1s with `status = 'available'`
- [ ] Tap one → detail screen shows correct price, location, teacher
- [ ] Book with Stripe card → success → "My Sessions" tab shows it → creator gets `one_to_one_booked` push
- [ ] Book with Apple Pay / Google Pay → same
- [ ] Book with cash → status `booked`, `payment_status = 'pending'`
- [ ] Try to book your own 1-to-1 → blocked with clear message
- [ ] Cancel a 1-to-1 you booked, >24 hours before → refunded (Stripe) or owed-zero (cash)
- [ ] Cancel ≤24 hours before → no refund, "no refund window" message shown

### Teacher / Admin

- [ ] Create a 1-to-1 → visible in Available tab to all students
- [ ] Teacher can edit/delete their own future 1-to-1s
- [ ] Admin can edit/delete any 1-to-1
- [ ] Teacher confirms cash payment for a 1-to-1 they teach → `payment_status` flips to `paid`

---

## Block Purchases (the new feature)

### Buy + activate

- [ ] Stripe Apple Pay: tap a block template → Apple Pay sheet → Face ID → block activates within ~5 seconds → "Block activated" push fires → block appears in Membership screen
- [ ] Stripe card: same flow → block activates after PaymentSheet completion
- [ ] Cash: tap "Pay with Cash" → block is immediately active in `payment_status = 'pending'` state → 72-hour grace banner visible
- [ ] After 72h with cash unconfirmed → block shows "Paused" badge → 1-to-1 booking with the block is blocked with the right error
- [ ] Teacher/admin confirms cash from Manage → block "Paused" badge clears → usable immediately

### Idempotency / abuse paths

- [ ] Buy a block via Stripe, dismiss PaymentSheet → return to Membership screen → block does NOT appear (cancelled) → can immediately retry without hitting the 15-min lockout
- [ ] Buy a Stripe block, tap rapidly twice while loading → only one Stripe customer created, one PaymentIntent created (verify in Stripe dashboard — should see one customer, one intent for this attempt)
- [ ] Force-quit during payment → block ends up either active (webhook eventually fires) or cancelled (rollback) — never stuck `pending_stripe` forever
- [ ] Try to buy a second block while one is active → blocked with "You already have an active block"
- [ ] Try to buy a second block after exhausting the first but without cancelling → "You already have an active block" (block is `exhausted` not `active` — purchase should actually succeed; verify this matches your expectation)

### Use the block

- [ ] With an active block, browse 1-to-1s → banner says "Block: N sessions remaining · Expires DD MMM"
- [ ] Book a 1-to-1 → "Book with block" path → no payment prompt → 1-to-1 booked → block `sessions_used` increments → banner updates
- [ ] Use all sessions in the block → block transitions to `exhausted` → no longer offered on 1-to-1 booking
- [ ] Cancel a block-paid 1-to-1 within the refund window → block session is refunded (`sessions_used` decrements) → if block was `exhausted`, it returns to `active`
- [ ] Cancel a block-paid 1-to-1 outside the refund window → block session is NOT refunded

### Cancel a block

- [ ] Cancel a block with sessions remaining → confirmation dialog mentions forfeit → confirm → block `cancelled` → can immediately buy a new block
- [ ] Cancel an exhausted block → confirmation dialog (no forfeit copy) → succeeds
- [ ] Cancel an expired block → succeeds
- [ ] Try to call `cancel_block` from another student's perspective (e.g. with a stolen UUID) — should fail with "Not authorised"

### Block expiry

- [ ] Set a block with `validity_days = 1` in DB → wait 24h → block transitions to `expired` next time the user opens the app or attempts a purchase (lazy expiry)
- [ ] Block expires before sessions used → student can buy a new block (one-active rule respected via `expire_stale_blocks_for_student`)

### Edge cases

- [ ] After the rare "needs_review" scenario fires (hard to reproduce in QA — note in your runbook): block sits in `needs_review` with `payment_status = 'paid'`. Admin must refund via Stripe dashboard and `update blocks set status = 'cancelled'` manually. This is a known gap; a Manage-tab UI is TODO.

---

## Memberships

### Subscribe

- [ ] Subscribe to 2x/week with card → PaymentSheet success → membership active immediately → home shows the membership card with quota row → Stripe customer + subscription appear in dashboard, anchored to 1st of month
- [ ] Subscribe to Unlimited with Apple Pay → same
- [ ] Subscribe with cash → membership active, 72h grace → cash confirmation by teacher/admin flips `payment_status` to `paid`

### Renewal & failure

- [ ] (Hard to time) On the 1st of the month: invoice generates, payment succeeds, `current_period_start/end` advance, no notification fires (it's a silent renewal)
- [ ] Trigger payment failure via Stripe dashboard "fail next payment" → `invoice.payment_failed` → membership status → `past_due` → user gets `membership_renewal` push
- [ ] User updates payment method via your support flow → next attempt succeeds → status returns to `active`

### Cancel + resume

- [ ] Cancel membership → status `cancelling` → membership keeps working until `current_period_end`
- [ ] Resume membership before period end → status returns to `active`
- [ ] Let period end on `cancelling` → status → `cancelled` → user gets "Membership ended" push

### Cash grace

- [ ] Cash membership for 72h → can still book classes → admin confirms → grace clears
- [ ] Cash membership at 72h+1m with no confirmation → blocked from booking with "Cash payment must be confirmed"

---

## Admin / Manage Tab

### Timetable

- [ ] Add a new class template → visible to students on next refresh
- [ ] Edit existing template (name, price, capacity) → existing future sessions inherit the change UNLESS they have an override
- [ ] Add a session override (different price / capacity for one date) → only that date uses the override
- [ ] Cancel a future session → students booked get refunded/owed-zero appropriately + receive `class_time_changed` push
- [ ] Deactivate a template → no new sessions generated by the weekly cron going forward
- [ ] Manually run `select generate_sessions_ahead(4);` in the SQL Editor → new session rows appear

### Settings

- [ ] Locations → add → edit → toggle active — reflected on 1-to-1 create screen
- [ ] Block Templates → add → edit → deactivate — reflected on Membership screen
- [ ] Session Defaults → change default OTO price → next 1-to-1 creation uses the new default
- [ ] Notification Preferences → toggle types → respected on next push attempt
- [ ] Try to deep-link to `/(app)/settings/blocks` as a non-admin (via expo-router URL bar or a saved deep link) → redirected to `/(app)/settings`

### Users / owed cash

- [ ] Manage → Users → student with pending cash for class / 1-to-1 / membership / block → confirm each → flips to paid
- [ ] Total owed amount updates correctly across all 4 sources
- [ ] Late cancellation history view shows each incident with date
- [ ] "Clear late cancellations" button for a user → count resets → user can book again

---

## Cron / scheduled jobs

- [ ] Verify the weekly cron `weekly-generate-sessions` ran last Monday: `SELECT * FROM cron.job_run_details WHERE jobid = 1 ORDER BY start_time DESC LIMIT 5;` → most recent row `status = 'succeeded'`, dated within the last 7 days
- [ ] `latest_session_date` in `class_sessions` is always at least 3 weeks in the future

---

## Real-device-only platform integrations

### iOS

- [ ] Apple Pay merchant ID matches `merchant.com.switchkickmafia.app` in app.config and Apple Developer portal
- [ ] Face ID / Touch ID prompt actually appears for Apple Pay
- [ ] Push notification entitlement present (verify with `xcrun simctl get_app_entitlements` or the TestFlight build's settings)
- [ ] Universal Links (if you have any) open the app, not Safari
- [ ] App Tracking Transparency prompt (if any tracking SDKs are added later)
- [ ] No "missing API usage description" rejection from App Store Connect

### Android

- [ ] Google Pay sheet renders correctly
- [ ] Notification channel name + icon look correct in system tray (not a generic Android default)
- [ ] App can be installed via internal-testing track and updates over previous version without data loss
- [ ] Back button behaviour: doesn't accidentally exit the app from mid-flow screens

### Both platforms

- [ ] App icon and splash screen show correctly
- [ ] Dark mode is consistent (the app uses `alwaysDark` per Stripe init; verify it doesn't fight system light mode anywhere)
- [ ] Status bar style readable on every screen
- [ ] Keyboard doesn't cover the text input being edited (KeyboardAvoidingView working)

---

## Network resilience

- [ ] Open the app on a flaky connection (1-bar cellular) → loading states show, no crashes, eventual success
- [ ] Mid-booking, drop network → app surfaces a clear error, doesn't book a partial row
- [ ] Background the app for 30 minutes → reopen → realtime listeners reconnect, data refreshes
- [ ] Airplane mode → open app → home shows cached data (or graceful empty state) → reconnect → updates

---

## Cross-role / multi-user smoke

Use two physical devices logged in as different roles. Keep both in front of you.

- [ ] Student books a class on Device A → Teacher on Device B sees the push within seconds + roster updates without manual refresh
- [ ] Admin cancels a session on Device A → student on Device B (who was booked) gets the push + their Home updates
- [ ] Teacher creates a 1-to-1 on Device A → student on Device B sees `one_to_one_available` push + the new entry in Available tab
- [ ] Student joins waitlist, then primary booking cancels → student on Device B sees `waitlist_promotion` push + booking now confirmed

---

## Pre-store-submission gates (before going production)

This is a one-time pass before flipping Stripe from test to live and submitting to the stores.

### Stripe

- [ ] Replace `pk_test_…` and `sk_test_…` with live keys in `.env.local` and Supabase secrets
- [ ] Update webhook endpoint in Stripe dashboard to production URL (still `https://amvajuqaxvedxlmszyjh.supabase.co/functions/v1/stripe-webhook`)
- [ ] Replace `STRIPE_WEBHOOK_SECRET` with the live-mode webhook signing secret
- [ ] Verify each webhook event type is subscribed in the live dashboard: `payment_intent.succeeded`, `payment_intent.payment_failed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`
- [ ] Replace `STRIPE_PRICE_TWO_PER_WEEK` and `STRIPE_PRICE_UNLIMITED` with live-mode price IDs in Supabase secrets
- [ ] Apple Pay merchant ID registered with Apple Developer + verified with Stripe (live mode requires separate verification from test)
- [ ] One real charge from a real card (own card, small amount) end-to-end: card → PaymentSheet → succeeds → webhook fires → booking confirmed → refund manually via Stripe dashboard to verify refund webhook also works

### Supabase

- [ ] Production cron `weekly-generate-sessions` confirmed active in `cron.job` table
- [ ] All edge functions verified ACTIVE in the dashboard with the right `verify_jwt` setting (false for all of them — auth is in-function)
- [ ] No advisor warnings at ERROR level (`get_advisors` via MCP or dashboard → Database → Linter)
- [ ] RLS enabled on every user-facing table (spot-check `profiles`, `bookings`, `one_to_ones`, `memberships`, `blocks`, `late_cancellations`, `membership_weekly_usage`)
- [ ] Real seat data: gym addresses in `locations` are real (the launch checklist flagged placeholder addresses)

### App config

- [ ] Bundle IDs match across Apple Developer / EAS / `app.config.ts`
- [ ] App icon + splash final assets in place
- [ ] Privacy policy URL + terms URL set in App Store Connect / Play Console
- [ ] Required usage descriptions in Info.plist: camera (if used), notifications, photos (if used)
- [ ] No `console.log` of secrets / tokens in the production bundle (grep the codebase one more time)
- [ ] Source maps uploaded for crash reporting (if you set that up)
- [ ] Version number / build number bumped

### EAS build

- [ ] `npx eas build --platform all --profile production` succeeds for both platforms
- [ ] Production build installs and runs on both devices without dev-client errors
- [ ] `npx eas submit` runs cleanly for both stores

---

## Post-launch monitoring (first 48 hours)

Not a test, but the watchlist:

- [ ] Supabase logs → no spike of 5xx from any edge function
- [ ] Stripe dashboard → all webhooks succeeding (200 status), no signature failures
- [ ] Push delivery rate >95% (check Expo dashboard if you keep one)
- [ ] No `blocks.status = 'needs_review'` rows accumulating (the activation-race scenario)
- [ ] No `memberships.status = 'past_due'` rows where the user got the failure push but the user never updated their card
- [ ] `cron.job_run_details` after the first Monday post-launch — confirm the weekly job ran

---

## Notes

- This list is intentionally exhaustive. The full pass takes 2-3 hours with two devices. The **Smoke** section at the top is the bare-minimum 15-min pre-deploy ritual.
- Add a column to your tracking sheet for which platform you tested on; many issues are iOS-only or Android-only (especially around Apple Pay / Google Pay / push token registration).
- Anything that fails: file an issue with the device + OS version + reproduction steps + screenshot of the error / console log.
