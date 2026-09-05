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
"🔔 Save & notify me on this lane" control to the board header using current
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
verified MC/USDOT; add ★ avg).

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
