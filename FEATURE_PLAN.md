# Feature roadmap — LoadWave TMS

Grounded in the current codebase (Aug–Sep 2026). Priorities are shaped by two
facts found while reading the code:

1. **A DRIVER role exists but the product barely reaches the driver.** Drivers
   can sign in (team invites link a user to a `Driver` record) and see a
   read-only Dashboard + the live board. Everything else — their own assigned
   loads, duty status, hours — is either blocked (ops-only UI) or has no UI at
   all even though backend support exists.
2. **Several "almost-finished" seams are dead ends.** `NotificationService.notify()`
   is fully implemented but never called anywhere. `SavedSearch.notify` is stored
   but nothing ever reads it. `evaluateCycle()` computes HOS remaining hours and
   warnings but is exposed to no user. Load status transitions already allow a
   DRIVER to advance **their own** assigned load (`driverMayAdvance`), but no UI
   lists a driver's assigned loads.

Legend: effort S = <½ day, M = 1–2 days, L = 3–5 days.

---

## Phase 1 — Make the driver app a real app

### 1.1 My Trips (driver's assigned loads) — **L, foundation**
Driver currently has no way to see loads the dispatcher assigned to them
(`/api/board/loads/my` = loads *posted* by the tenant; the "My Loads" nav item is
ops-only).
- New sidebar item **My Trips**, shown only to DRIVER accounts.
- Backend: `GET /api/loads/mine?status=…` scoped by `user.driverId`, returning
  the load card data already mapped in `load.service.ts` + stops + assignee.
- Card per trip: lane, commodity, weight, equipment, pickup/delivery windows
  (converted to the driver's `homeTerminalTz`), detention, assigned unit.
- Actions reuse the **existing** `PATCH /api/loads/:id/status`
  (`ASSIGNED → IN_TRANSIT → DELIVERED` is already legal for the assignee driver):
  *Accept / Start trip / Mark delivered* with confirm modals.

### 1.2 Duty status switch — **S**
`Driver.status` (ACTIVE / OFF_DUTY / SUSPENDED) is only writable by
ADMIN/DISPATCHER today. Add `PATCH /api/drivers/me/status` (DRIVER-scoped) and a
prominent **On duty / Off duty** toggle in the driver sidebar + Dashboard. Chain
with 1.1: "Mark delivered" suggests going off duty.

### 1.3 Hours-left dashboard for the driver — **M**
`evaluateCycle()` in `hos.policy.ts` already computes 7/14-day usage, remaining
hours, the 24h-reset rule and ≥80% warnings — but nothing calls it for a live
user.
- New `GET /api/hos/me/cycle` (driver-scoped) → computed remaining hours over
  their `HosLog` rows.
- Driver Dashboard card: progress bar of 7-day usage, "Xh 12m left today-7d",
  amber >80%, red at limit, plus reset countdown. Little-detail win: drivers
  read "hours left," not "hours used."

### 1.4 Wire notifications to real events — **M**
`notify()` is implemented but unreferenced. Add calls where they matter to
drivers:
- load assigned to driver → bell "New trip: QC → NY assigned to you"
- dispatcher changes status / unassigns → notify
- driver self-transition → notify ops
Notification rows are tenant-wide today (no `userId`/`driverId` column), so every
member sees every row. Add `userId?` + read-state scoping as a follow-up so the
bell is per-person — today a dispatcher's alerts leak into a driver's feed.

### 1.5 Personal fuel logging from the cab — **M**
`FuelTransaction` already carries `driverId`, `assetId`, L/GAL original units,
CAD/USD + FX. Only ops (Ifta page) can enter fuel. Add a compact **Log fuel**
entry on the driver Dashboard / My Trips ("Add fuel stop" on the active trip):
jurisdiction autosuggest (QC/ON/NY…), L or GAL toggle with conversion, price,
and auto-set `driverId`/`assetId` from their linked unit.

### 1.6 Delivery proof (POD) on trips — **L (new model)**
No document model exists anywhere. Add `LoadDocument` (loadId, driverId, kind:
POD | BOL | damage, filename, uploadedAt) + upload endpoint; My Trips card shows
"Add POD" before/after DELIVERED; ops sees it next to the load/invoice. This is
what invoicing actually needs to bill.

### 1.7 Driver onboarding & self-service profile — **S/M**
First-login onboarding currently explains the product to *ops*. When the token
carries DRIVER role, show a driver-specific step ("say hi — your dispatcher
linked Marie's license to this login"). Let drivers edit their own license
number / timezone via a `PATCH /api/drivers/me` (new, DRIVER-scoped) instead of
blocking all updates to ADMIN/DISPATCHER.

---

## Phase 2 — Ops depth (dispatchers/owners get driver superpowers)

### 2.1 Assign flow in one place — **M**
`PATCH /api/loads/:id/assign` exists but has no UI anywhere. On My Loads rows and
the new Drivers page: **Assign** opens a modal (driver dropdown with HOS-hours
pill + unit dropdown, or unassign). Load row shows assignee + unit chips, and
ops Dashboard gains "Dispatched but not started" and "In transit" tallies.

### 2.2 Drivers page: from phonebook to dispatch console — **M**
Today Drivers.tsx is name/license/cycle/TZ/status CRUD. Add per row:
- computed HOS pills (7d used/remaining, 14d for Cycle 2) via a new
  `GET /api/hos/overview?driverId=` (ops role)
- one-click ACTIVE ↔ OFF_DUTY (and SUSPEND with confirm)
- linked team-account badge (email) once invited; "last seen" from
  `RefreshToken`/session activity
- row click → detail drawer: HOS segments timeline, current/assigned loads,
  fuel history.

### 2.3 Daily HOS / ELD view — **M**
ELD module ingests segments (webhook/poll) but no one can read them back
graphically. Ops view: per-driver duty-status timeline for today/last 7 days
(DRIVING / ON_DUTY_NOT_DRIVING / SLEEPER / OFF_DUTY bands), today's drive hours,
open violations from `evaluateCycle`. Sibling of the Fuel & IFTA page.

### 2.4 Invoice-from-delivered-load is one click — **S**
`Invoice` links to a `Load`, and `DELIVERED → INVOICED` is a legal transition —
check whether the invoicing UI actually offers "Create invoice" off a delivered
load row in My Loads; if not, add the button + auto-fill (customer, rates,
HST/QST rules already exist in `invoice.service.ts`).

---

## Phase 3 — Little details & product polish

### 3.1 Saved-search alerts actually alert — **S/M**
Saved searches exist backend-only (`saved-search.service.ts`, no UI). Add a
"Save & notify me on this lane" control to the board header using current
filters, list saved searches under Tools, and a tiny poller that compares
`PUBLIC` loads against `SavedSearch.notify = true` filters → `notify()`
(dead-end #2 closes). Email is already best-effort when SMTP is set.

### 3.2 Booking/assignment reaction notifications — **S**
When a load is booked or a truck post booked, push `notify()` — the board has no
feedback loop today beyond the optimistic UI.

### 3.3 Empty states that teach — **S**
Consistent, actionable empty states: board "no loads match — try clearing
filters / widen radius / view all of QC", My Trips "nothing assigned — your
dispatcher sends trips here", bell "no alerts yet". Each should carry one CTA.
Patterns (`Empty`, `Badge`) exist in `components/ui.tsx`.

### 3.4 Timezone & currency honesty — **S/M**
Pickup/delivery times should render in the *viewer's* context: drivers in their
`homeTerminalTz` (with the zone shown), ops in tenant tz. Cross-border loads
(CAD↔USD) already keep `freightAmountBase` + FX — surface "≈ USD 1,240 · CAD
1,700" on cards when the viewer's default differs. This is the single most
credible "pro" detail on a freight tool.

### 3.5 Keyboard + a11y sweep — **S**
`/` focuses board search, `Esc` closes modals (check), rows selectable by arrow
keys in list view, `:focus-visible` rings, `aria-pressed` on duty toggle,
`prefers-reduced-motion` on the marquee/auto-refresh flash. Small, testable,
felt by every daily user.

### 3.6 Result export + compare polish — **S**
CSV export of the filtered board (columns already shaped by `BoardLoad`),
compare-view "best $/mi" highlight among the 3 selected, and persist last-used
filters per user (localStorage) so re-opening the board doesn't reset the lane.

### 3.7 Page titles & deep links — **S**
Document titles per route (`document.title` in AppShell) and shareable board
URLs encoding the lane filters (`?origin=QC&dest=NY`), so a dispatcher can paste
a board link into chat/email — or a notification `link`.

### 3.8 Rate-the-carrier prompts — **S**
Ratings lifecycle exists (`CarrierRating`, aggregates on Tenant). After a load
reaches DELIVERED/INVOICED, prompt the counterparty once ("How was [carrier]?")
in-app — with the rating surfacing on their board cards (badges already show
verified MC/USDOT; add a star average).

---

## Status

- **2026-09-05 — Shipped: 1.1 My Trips and 1.2 duty switch.** Driver-only `/app/trips`
  page (via new `GET /api/loads/mine`, scoped to the signed-in driver) with
  Start trip / Mark delivered actions reusing the existing load status endpoint,
  plus a self-service `PATCH /api/drivers/me/status` toggle surfaced in the driver
  sidebar and mobile bar.
- **2026-09-05 — Shipped: 2.1 dispatch assign flow.** A shared `DispatchModal`
  (driver + unit pickers, unassign) opened from **My Loads** rows (per-load focus,
  now served by `GET /api/loads` so assignee info shows) and the **Drivers** page
  (per-driver focus with a pickable load pool and an "on trip" lane chip).
  Assigning a driver makes the trip appear in that driver's My Trips immediately.
- **2026-09-05 — Shipped: 1.5 cab-side fuel logging.** Drivers can log a fuel
  stop from their dashboard (Fuel stops card with recent stops) or the active
  trip card in My Trips via a shared fuel-log modal (jurisdiction, L/GAL,
  volume, price, currency, optional timestamp, live price-per-unit). New
  `POST /api/fuel/me` reuses the ops pipeline (`importOne`: L/GAL conversion,
  FX to base, IFTA fuel event) and auto-fills the unit from the driver's active
  trip (`resolveDriverAssetId`); `GET /api/fuel/me` returns their recent stops.
  Unit-tested in `tests/unit/fuel-service.test.ts`.
- **2026-09-05 — Shipped: 1.3 / 2.2 HOS hours surfaced.** Drivers get an
  "Hours this cycle" card on their dashboard (7-day bar, plus 14-day for Cycle 2,
  green/amber/red at 80%+ and at the limit, warnings/violations, reset hint)
  driven by the existing `evaluateCycle` engine via `GET /api/hos/status/:id`.
  The ops Drivers page shows per-driver **Hours left** pills (amber when near
  the 80% threshold, red on violation; 14-day figure for Cycle 2) from a new
  batched `GET /api/hos/overview`, and the DispatchModal now prints each
  driver's remaining hours next to their name so dispatchers don't hand trips
  to exhausted drivers. Unit-tested in `tests/unit/hos-service.test.ts`.
- **2026-09-05 — Shipped: 1.6 + 2.4 delivery proof & one-click invoice.**
  New `LoadDocument` model (BYTEA, 10 MB cap) with ops endpoints to upload
  (base64), list and download POD/BOL/damage paperwork per load. In My Loads, a
  **Wrap-up** column on DELIVERED loads offers **Add POD** and **Create invoice**
  — the invoice modal shows the freight total and bills the load through the
  existing `createForLoad` tax engine (GST/HST/QST + due date auto), then flips
  the load to INVOICED. Unit-tested in `tests/unit/document-service.test.ts`.
- **2026-09-05 — Shipped: Billing & AR page.** Invoices gained payment state
  (`paidAt`/`paidAmount*`, migration `invoice_payments`; `PATCH
  /api/invoices/:id/pay` to mark paid/reopen). New ops `/app/billing` page:
  outstanding/overdue/not-yet-due/received KPI cards, an aging table
  (Not yet due / 0–30 / 31–60 / 61–90 / 90+ days), outstanding-by-quarter, and
  a filterable invoice ledger with Mark-paid (pick the date) and Reopen.
  Aging math lives in pure `ar.policy.ts` (tested) so reports stay exact
  (Decimal, not float).
- **2026-09-05 — Shipped: 1.4 notifications wired + per-user scoping.**
  `NotificationService.notify()` now fires from real events (new `LoadDispatched`
  and `LoadStatusChanged` domain events published by `load.service`): drivers get
  personal rows (new `Notification.userId`, scoped reads/unread per account) when
  they're assigned/reassigned/unassigned or dispatch updates their trip; the
  office gets tenant-wide rows when a driver starts or delivers. Emails target
  the recipient's address when SMTP is configured. Unit-tested in
  `tests/unit/dispatch-notifier.test.ts`.
- **2026-09-05 — Shipped: driver↔login linking + seed fix.** Demo driver accounts
  were seeded with `roles: 'DRIVER'` but no `User.driverId`, so My Trips
  showed "no driver profile is linked to this account" and there was no way to
  fix it (linking only happened at invite time). Added admin
  `PATCH /api/team/users/:userId/driver` (`setDriverLink`: tenant + DRIVER-role
  validation, one login per driver, unlink via null), a **Link/Login** action
  with a link-picker modal on the Drivers page plus linked-email column,
  `scripts/seed-demo.ts` now links the demo driver to Maria Chen (who carries
  the seeded private trip), and My Trips renders a friendly explainer instead
  of the raw 403 when a DRIVER login is unlinked. Existing demo tenants
  backfilled. Unit-tested in `tests/unit/team-service.test.ts`.
- **2026-09-05 — Shipped: 3.x detail-polish pass.** Clicking a notification
  marks it read and jumps to what it's about (`link`), with a single-notification
  read endpoint wired; the board cards now show pickup urgency ("Pickup
  tomorrow"/"Today"/"N days ago" in amber/accent/red) and the board gained a
  Sort control (Newest / Best rate / Best $/mile / Shortest haul, client-side
  on the live feed); trip cards show deliver-by countdown chips for active
  trips; modals autofocus their first field and lock page scroll (drawer too,
  plus Escape-to-close on the drawer); every app page sets a proper
  `document.title`; the dashboard revenue KPI reads "Sep 2026" instead of
  "2026-09"; the ops fuel form shows a live $/L readout as you type; sign-in
  gained Show/Hide password toggles. Verified live on :5173.
- **2026-09-05 — Shipped: 3.1 saved-search alerts close the last dead end.**
  `runAlerts()` sweeps every `SavedSearch.notify = true` search on a 5-minute
  timer (first pass 20 s after boot) and fires personal `load_match`
  notifications — with the owner's email when a user owns the search — for loads
  newer than the per-search checkpoint, advancing `lastCheckAt` every sweep so
  nothing double-alerts. Creates now record the signed-in `userId` (previously
  null). The board's **Save & alert me** button opens a modal that saves the
  current filters with alerts on, and lists existing saved searches with
  Enable/Mute and Delete. Unit-tested in `tests/unit/saved-search-alerts.test.ts`.

- **2026-09-05 — Shipped: friendly auth + forgot-password.** Login now tells
  users apart — "No account found with this email" vs "That password isn't
  right" — and emails are normalized (case/whitespace) everywhere. New
  `PasswordResetToken` (single-use, hashed, 1 h expiry; migration
  `20260905180000_password_reset`): `POST /auth/forgot-password` (never
  confirms account existence, rate-limited, emails via SMTP once configured —
  dev builds return the link on-screen) and `POST /auth/reset-password`
  (revokes every live session + consumes the token). UI: Forgot password? link
  on sign-in, `/forgot-password` and `/reset-password` pages with
  show/hide-password and match validation. The API client now falls back to
  human messages (session expired, forbidden, not found, rate-limited) instead
  of "Request failed (401)". Unit-tested in `tests/unit/auth-service.test.ts`.

- **2026-09-05 — Shipped: remember me, 2FA, change-password & session management.**
  Sign-in gained a **Remember me on this device** checkbox: remembered sessions
  persist in localStorage and carry a 30-day refresh token (`JWT_REMEMBER_TTL`);
  unchecked sessions live in sessionStorage and keep the 7-day default — and
  rotation preserves the policy. **TOTP two-factor auth** built from scratch
  (`totp.service.ts`, RFC 6238 vectors tested): `POST /auth/2fa/setup|enable|disable`
  plus a 2FA challenge in the login flow (password → short-lived 5-min token →
  code → session; a code sent with the password completes in one round trip).
  Recovery codes are stored hashed, shown exactly once, consumed on use.
  **Settings & security** page (`/app/settings`, all roles): change password
  (revokes every other device, keeps the current session), 2FA setup with a
  scannable QR + manual secret + recovery-code grid, disable-with-code, and an
  **Active sessions** list (device labels captured from the User-Agent, "This
  device" marker, one-click revoke). Logout/refresh/login/2FA/change-password
  routes are all rate-limited. Migration `20260905200000_security_2fa`.
  Unit-tested in `tests/unit/totp.service.test.ts` and
  `tests/unit/auth-security.test.ts`.

## Suggested build order

1. **1.1 My Trips + 1.2 duty switch** (core driver loop; unblocks everything)
2. **1.4 notifications + 3.2 event notifications** (feedback loop)
3. **1.3 / 2.2 HOS hours surfaced** (driver card + ops pills)
4. **1.5 fuel entry, 1.7 driver profile** (rounds out the driver app)
5. **3.x little-details batch** (empty states, tz/currency, CSV, titles)
6. **1.6 POD + 2.4 invoice** (completes the money loop)

Tests to extend alongside: unit tests exist for `hos-policy` and dispatch
transitions; add driver-scoped route tests (a driver may only see/advance their
own loads) and a notification-on-assign test.

## Done — account security suite (Sept 2026)

- **Forgot / reset password** — `PasswordResetToken` (hashed, single-use, 1h TTL), rate-limited endpoints, session kill on reset, `/forgot-password` + `/reset-password` pages; dev prints the link until SMTP lands (`APP_URL` env).
- **Remember me** — checkbox on sign-in; 30-day refresh TTL in `localStorage` vs 7-day `sessionStorage`; rotation preserves the policy.
- **TOTP 2FA** — RFC 6238 (RFC-vector tested), QR setup, hashed one-time recovery codes, disable-with-code.
- **Sessions page** — device labels from UA, current-device marker, one-click revoke; change-password keeps this device, kills the rest.
- **Ops 2FA enforcement** — Team → "Require two-factor for office accounts": ADMIN/DISPATCHER sign-in is blocked with an inline setup flow (QR → code → recovery codes → signed in); drivers unaffected; Settings shows a "Required" badge.
- **New-device sign-in alert** — device fingerprint tracking (capped at 20); unknown device → bell row + email (when SMTP is on) with "change your password and revoke the session" guidance.
- **Friendly auth errors** — distinct messages for unknown email vs wrong password, email normalization, human-readable API fallbacks.

**Status:** 23 suites / 137 unit tests, all live-verified end-to-end (API + browser).

## Done — mobile & small-screen pass (Sept 2026)

- **Phone-width audit** — every route measured for horizontal overflow at 360px and 768px (iframed harness): all app pages clean, zero page-level overflow.
- **Bottom nav** — 10+ destinations now scroll sideways instead of squashing/overflowing; duty toggle kept for drivers; safe-area padding retained.
- **Modals → bottom sheets** on phones — full width, rounded top, 92dvh cap with internal scroll, thumb-friendly footer buttons (full-width split), safe-area aware; modals now sit above the theme FAB and never exceed the screen at any size.
- **Tables** — pinned first column (sticky) on mobile so the lane/driver stays visible while the row scrolls; buttery touch scrolling + slim scrollbar on all `.table-scroll` panes.
- **Sign-in / forgot / reset** — full-bleed on phones (no card gutters), stacked fields; 2FA code entry already numeric-keypad (`inputMode`).
- **Touch feel** — tap-highlight removed, `touch-action: manipulation`, `100dvh` shells (iOS URL-bar safe), `viewport-fit=cover`.
- **Details** — compare sheet floats above the bottom nav; billing quarter picker full width; trip actions stack; 2FA verify row stacks; fuel/doc rows stack; driver trips/fuel lists reflow; theme FAB hidden inside the app (redundant + it was covering modal buttons) and enlarged with safe-area offset on marketing; marketing rate-strip ticker + CTA pills full-width on phones.
- **Found & fixed along the way** — the floating theme button rendered over the app's bottom nav and modal footers (z-index + `:has` suppression); the "Save & alert" footer button text was clipped under it.

**Status:** web typecheck + build clean; verified live at 360px + 768px (ops and driver sessions) via a temporary iframe harness (removed after).

## Done — driver one-tap quick action (mobile)

- **Floating quick-action button on the driver dashboard** — a fixed pill above the bottom nav (≤860px), always on screen without scrolling: off duty → **Go on duty**; on duty with an assigned load → **Start trip** with the lane (`Québec → Ontario`) right on the button; on duty with nothing assigned → **Find loads** (jumps to the board). Hidden while a load is already in transit or the driver is suspended.
- **One-tap real actions, not navigation** — the button calls the same APIs as the sidebar: `PATCH /api/drivers/me/status` and `PATCH /api/loads/:id/status` (fires the dispatcher notification). After starting a trip it flashes "Trip started — drive safe" and recontextualizes; failures show a red "try again" state.
- **Shared duty store** (`duty-store.ts`) — the sidebar, bottom-nav toggle, FAB and the dashboard's duty stat all read one `useSyncExternalStore` source of truth, so the stat card updates the instant the FAB is tapped (was stale before).
- **Details** — lane label ellipsizes on narrow screens; `aria-live` announces the state change; no `color-mix()` (older ELD-tablet WebViews); 44px+ touch target; z-index 50 (above the nav, below modals); trips refetch on focus + every 45s so a fresh dispatch assignment surfaces.
- **Found along the way** — the dashboard's duty stat used its own stale fetch; now store-driven.

**Status:** web typecheck + build clean; verified live at phone width (638px preview): Go on duty → ACTIVE, Start trip → IN_TRANSIT + "Maria Chen started the QC → ON trip" notification, FAB recontextualized after each tap, bottom-nav toggle in sync.

## Done — push alerts, daily duty log & dashboard declutter

- **Web push notifications** — drivers get a browser alert the instant dispatch
  assigns a load (and on office trip updates). PushSubscription table (hashed
  keys never stored raw, pruned on 404/410), VAPID keys via env (dev keys
  generated; empty = gracefully disabled), `POST /api/push/subscribe` +
  `GET /api/push/config`, service worker (`/sw.js`) with tap-to-open, silent
  re-sync on app start (throttled to 5 min on failure), an "Enable load
  alerts" CTA on the driver dashboard when permission is undecided.
- **Daily duty log** — every on/off-duty flip now writes real HOS log
  segments (MANUAL ingest), and `GET /api/hos/logs/:driverId` returns a
  7-day per-day breakdown in the driver's home timezone. The Hours card gets
  a "Daily duty log" strip: 7 day cells with green on-duty bars + hours,
  today highlighted; the cycle bars now reflect actual logged minutes.
- **Dashboard declutter** — "Right now" is now paired rows: active load +
  Hours card side by side, then Fuel stops + Jump in, then profiles; empty
  state got an icon + Find loads CTA; quick actions got icons. Grid stacks
  below 560px.
- Found along the way — the embedded preview browser can't reach its push
  service (environment limitation), so push is verified via unit tests +
  live API; duty flips now feed HOS minutes immediately (the cycle card
  showed 0h 1m after a test flip).

**Status:** 25 suites / 151 tests pass, typecheck + lint + web build clean,
live-verified in the preview (paired grids, daily strip, duty→log→cycle
chain, assign→bell pipeline). Pushed to main.

## Done — ELD-style duty log detail view

- Tapping any day on the dashboard's duty strip opens a **Duty log** modal
  with the classic ELD 24-hour grid: time axis (12am→11pm), four status
  tracks (Driving / On duty, not driving / Sleeper berth / Off duty) with
  colored blocks positioned by the hour in the driver's home timezone.
- Below the grid, the full timed segment list — status, local start–end,
  duration, "in progress" for the open segment — plus an on/off-duty total
  footer ("Times in Toronto time").
- Day cells became proper buttons (hover ring, focus outline, aria-labels);
  Modal gained a `wide` size. Seeded a realistic demo day (6 blocks:
  driving/on-duty/off-duty) so sales demos show a proper logbook.

**Status:** web typecheck + build clean; verified live in the preview (grid
positions, list times, totals, close). Uncommitted on main.

## Done — what the truck earns (Oct 2026)

The four items at the top of `GAP_ANALYSIS.md`'s build order: the board prices
empty miles, offers the backhaul, states what a unit costs to run, and answers
the check call with a link.

### Deadhead, net revenue per mile and backhauls

- **`board.earning.ts`** — pure: `earning()` gives the loaded rate, the empty
  kilometres from the viewer to the pickup, and the rate over both. `roundTrips()`
  pairs a load with up to three loads picking up within 150 km of its delivery,
  ranked by what the second leg earns per mile, with the trailer match preferred
  but never required, and anything that cannot be picked up after we deliver
  dropped as impossible. **22 tests** in `tests/unit/board-earning.test.ts` — the
  board's first.
- **`position.store.ts`** — where the truck is: the delivery of the load it is
  on right now (a plan, and labelled as one) or its newest reported position
  (a measurement, with its age). No position → every new field is null and the
  card shows exactly what it showed before.
- **The card** gained `net $/mi`, the deadhead that produced it and what it was
  measured from ("166 km empty to the pickup · measured from your delivery in
  Ottawa, ON"), the backhaul column, and a **Best net $ / mile** sort.
- **Fixed along the way:** `perMile()` was hard-coded to USD, so a Canadian load
  showed "US$4.32/mi" beside "$1,450". It now follows the amount's currency.

### Cost per mile by unit

- **`cost.policy.ts`** (pure, 22 tests) + **`cost.service.ts`** + `GET
  /api/costs/per-mile` and `PUT /api/costs/declared/:assetId`, ADMIN/DISPATCHER
  only. Fuel is real (`FuelTransaction`), distance is real (`RouteSegment`), and
  the fixed cost is declared by the owner into `TenantSetting.asset_costs`.
- **Loaded versus empty is derived** by intersecting segment windows with the
  load-assignment window, which is an approximation and is labelled as one in
  the response (`mileageBasis`) and on the screen. `excludedCosts` is part of the
  payload, not a footnote: the panel prints "maintenance not counted" and "tolls
  not counted" as prominently as the figures they qualify.
- **`CostPanel.tsx`** on the Fleet page: cost per loaded mile, cost per mile,
  share run empty, detention recovered, fuel bought, and the declared-cost editor.
  10 integration tests in `tests/integration/costs-api.test.ts`.

### Tracking milestones and a public link

- **`tracking.policy.ts`** (pure) computes Arrived/Departed per stop by
  geofencing the truck's own positions against the stop's coordinate — 750 m,
  because a dock is bigger than a parking space. Derived at read time, so a
  backfilled trail gives the same answer and there is nothing to fall out of sync.
- **`GET /api/loads/:id/tracking`** (authenticated, tenant-scoped, a driver only
  for their own load) returns the milestones and the link.
  **`GET /api/track/:loadId/:token`** is the link: no session, no cache, and a
  token derived from the load id and the access secret so there is no column to
  migrate and nothing extra to leak. A wrong token and an unknown load answer
  identically. **The public projection is an allow-list** — lane, status, stops
  and a position rounded to ~110 m; rates, customer, driver and company have no
  path into it, and a test asserts the exact key set.
- **`/track/:loadId/:token`** is a public page outside the app shell, and My
  Loads and the driver's trip share both hand out the link. 7 integration tests
  plus 21 unit tests.

### Demo data

`.freebuff/seed-earning-tools.mjs` seeds a live trip with position history and
stops, a month of fuel, distance and a declared fixed cost, and a plannable
backhaul pair on the board. `--clean` removes every row it wrote and puts the
demo load's status back.

**Status:** root tsc, web tsc, lint, **677 tests / 65 suites** and the web build
all clean; verified live at 390 px — the board card (net, deadhead attribution,
backhaul, zero overflow), the Fleet cost panel ($2.94 per loaded mile, 20% empty,
omissions named), the public tracking page, the tampered-token page, and the
copy-link action on My Loads. The API was checked separately: a driver gets 403
on `/api/costs/per-mile` and 200 on their own load's tracking. Uncommitted on
main.
