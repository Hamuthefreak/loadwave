# Where Loadwave stands — and what the boards our carriers also use have that we don't

Written October 2026, against the code in this repository rather than against a
competitor's marketing page. Every item below names **what exists here today**
(file included) so nothing gets built twice, and then what is actually missing.

The comparison set is what a small Canadian cross-border carrier is actually
choosing between: DAT One and Truckstop for finding freight, Uber Freight /
RXO / Loadsmart for tendered freight, and whatever TMS their dispatcher uses
(McLeod, TMW, Turvo — or a spreadsheet). The question is not "who has the most
features" but "which of their features does a carrier refuse to give up".

Baseline: `d20b714`. Legend: **S** < ½ day, **M** 1–2 days, **L** 3–5 days.

---

## Part 1 — What we already do that they don't

These are the reasons a carrier stays, and they are the things a new feature
must not break.

- **The paperwork is in the same product as the freight.** IFTA quarters
  computed from GPS-verified distance by jurisdiction (`postgis.service.ts`,
  `ifta.service.ts`), fuel logs, GST/HST/QST invoicing and driver settlements —
  DAT leaves all of that to other apps. A one-truck carrier's second job is
  paperwork; that is the whole wedge.
- **The driver is a first-class user.** Duty status, hours, daily duty log, own
  trips, own fuel log, own qualification file with renewals taken from the cab,
  and an offline queue that keeps a renewal or a fill-up when there is no signal
  (`pendingQueue.ts`). The big boards are dispatch tools with a driver companion
  app glued on.
- **Trust signals that admit what they are.** `trust.service.ts` labels
  self-declared authority, declared insurance and platform payment history
  separately, and only badges FMCSA as *checked* when a check has actually run.
- **Stated arithmetic, not vibes.** Lane benchmarks, variance against a pay
  period's trailing weeks, and pay disputes are explained rather than asserted.
- **No per-load tax on our own marketplace.** Booking, negotiation and the
  settlement are ours.

---

## Part 2 — The gaps, in the order they cost us loads

### 2.1 Freight has to arrive without anybody retyping it — **L**

Their boards tender loads *into* a carrier's system: EDI 204 (tender), 990
(response), 214 (status), 997 (ack), or the modern equivalent — a REST tender
with a webhook.

Today: `import.service.ts` reads a CSV or JSON file, and
`POST /api/loads/import` turns it into loads. That is a file drop, not a feed.
There is no outbound webhook anywhere in `src/` — the only webhook is *inbound*
(`POST /api/eld/webhook`, `eld.routes.ts`), and it is authenticated by a shared
secret rather than per-tenant credentials.

To build: an inbound tender endpoint that can be called by a broker's system and
answers with a load id (`POST /api/tenders`, idempotent on a broker reference),
plus signed webhooks out (status changes → the broker's URL) and a per-tenant
API key model, which does not exist at all (34 models, no `ApiKey`; see 2.18).
Behind it, an `ExternalTender` model recording who sent what and what we
answered, because the day a broker disputes a tender, the log is the defence.
EDI can come later on top of the same internal shape — do not model the API
around X12 segments.

Why it matters: a carrier with 20 trucks will not accept tenders by hand for
long, and "we can take your tenders" is what turns a board into a system of
record.

The outbound half of this is designed in `BROKER_API.md`, including why the
milestone function in `tracking.policy.ts` is the thing that decides what to
send.

### 2.2 Know the broker before you haul — **M**

DAT and the credit services around it sell broker credit, days-to-pay and a
"report a broker" network. `TenantReport` + the payment history already derived
from settled invoices in `trust.service.ts` is the honest half of that.

Missing: an external signal. Today a carrier's only pre-booking fact about a
broker is *our own* invoices — useless on day one with a new broker.

To build: a credit source (service lookup — freight-broker credit is a specific
market, not a generic credit bureau), surfaced through the existing
`TrustSignals` shape so the board cards and drawer need no new UI. Second, and
cheaper: let a carrier ask a broker's **certificate of insurance** to be
verified and re-checked on expiry, instead of the declared-date field we have.
See also 2.13 — we can ship the honest half of this without buying anything.

### 2.3 Rank by what the truck earns, not what the lane pays — **M**

Every board shows $/mile on the card. The ones carriers prefer subtract the
**deadhead to the pickup** — and the good ones offer a backhaul.

Today: `board.store.ts` computes a marketplace lane benchmark (`$/mile` for this
O→D pair, `laneRateAverages()`), `LaneDailyStat` keeps history, `PostGIS` knows
how far apart two points are, and `BoardLoadRow` already carries origin and
destination coordinates. `haversineKm` is already imported in `board.service.ts`.
The distance between "we have all of this" and "the card sorts by true revenue
per loaded-and-empty mile" is small.

To build: `deadheadKm` on the board row (from the driver's current location or
their last delivery), a `netPerMile` sort, and a second column of **loads that
get you home** — any board load whose origin is within N km of this load's
delivery can be shown as a pair. That single feature is why owner-operators open
a board twice a day.

### 2.4 The border — **L**

This is our home turf and we are not using it. Cross-border carriers deal with
ACE/PARS/ACI eManifest filings, broker/consignee paperwork, overweight permits,
tolls and border waits.

Today: `geo.service.ts` + `PostalPlace` for search, practical distance by
jurisdiction, and that is it. `Load.isInternational` is a flag with no
behaviour behind it.

To build, in order of what a dispatcher loses time on: (1) an **eManifest
readiness checklist** per load — the required filing, who files it, and its
deadline relative to the pickup; (2) **border wait times** by crossing (public
data) attached to any load that crosses; (3) **permits and tolls** on the
practical route. Even the first one, done well, is the most Canadian thing this
product could do.

### 2.5 Get paid — **L**

Missing table stakes for a small carrier: factoring submission, quick pay, and a
true **cost per mile**.

Today: `invoice.service.ts` with GST/HST/QST, PDF statements, e-signature, pay
disputes, and settlements. All of the *producing* side, none of the *getting
paid* side.

To build: (1) **cost per mile by unit** — fuel (`FuelTransaction`), maintenance
(nothing yet, see 2.6), tolls, and fixed costs per truck, against loaded miles;
(2) a **factoring export** (their portals take invoices as a file or an API) and
then a **QuickBooks/Xero** sync so the accountant stops retyping; (3) instant
pay for drivers, which is the single most-wanted benefit in every driver survey.

### 2.6 Safety has legal teeth — **M, each**

Their compliance suites are not document filing cabinets; they are wired into
mandatory checks. FMCSA's **Drug & Alcohol Clearinghouse** requires a query
before every hire and at least annually thereafter, and carriers get fined for
missing it. **CSA scores**, **PSP** reports and continuous **MVR monitoring**
are what safety managers watch.

Today: `compliance.service.ts` tracks CDL, medical card, MVR, annual review,
IFTA licence, authority and insurance with expiries, sweeps and push reminders —
an excellent *document* system (and driver-side renewal from the cab now too).

Missing: an actual Clearinghouse query, whose result has to be recorded against
the driver with the date and the query type; CSA/PSP snapshots; monitoring
rather than document expiry. Also missing and properly table stakes in the US:
**DVIR** (driver vehicle inspection reports) and the maintenance work orders they
feed — there is no `Maintenance` or `DvirReport` model at all, so a fleet's
repair history currently lives nowhere.

### 2.7 Tracking without phone calls — **M**

The check call is the most-hated ritual in trucking, and every modern board has
killed it with geofences: the truck arrives at the pickup because its own ELD
told us, not because somebody phoned.

Today: `eld.ingest.service.ts` ingests position batches, `RoutePoint` /
`RouteSegment` store the GPS trail, `LoadStop` stores lat/lon per stop, and the
driver's trip card can share a status *sentence* to the OS share sheet. Nothing
turns any of it into a milestone, and there is no link anybody can open.

To build: geofence the load's stops against `RoutePoint` history, expose
Arrived/Departed as milestones, and publish a **tracking link** a broker can open
without an account. Then the status events in 2.1 have something to send.

### 2.8 Paperwork that reads itself — **M**

Today: `document.service.ts` stores POD/BOL/DAMAGE uploads, `paperwork.service.ts`
captures signatures, and there is a PDF417 barcode reader for licence renewals
(`aamva.ts`, `pdf417.ts`).

Missing: reading a **POD** — the page a driver photographs at the dock — to pull
the receiver, the date, the signature and the piece count, and then marking the
load billable. We already own every part: camera capture, image decoding, a
document model, invoicing. It turns "invoice from delivered load is one click"
into "the invoice is waiting when the driver is still on the dock".

### 2.9 Reach — **S/M, each**

- **SMS**: `notification.service.ts` does in-app and best-effort email, plus web
  push. A driver in a cab reads a text, not an email. Nothing SMS-shaped exists
  in the repo (no Twilio, no provider of any kind).
- **Native app**: the web app is installable and offline-capable, and that is
  genuinely good. The native gap is *not* the reason to build one — background
  location and the camera are (see 2.7, 2.8).
- **ELD vendor connectors**: `POST /api/eld/events` takes a generic batch, so
  every integration is somebody's custom job. A connector per major vendor
  (Motive, Samsara, Geotab) with its own auth is what makes ingest a feature
  instead of a project.

---

## Part 2B — The gaps the first pass missed

Found by re-reading the schema and the competitor feature sets rather than the
code alone. Same shape: what exists, what is missing, what to build, and cost.

### 2.10 Appointment and dock scheduling — **M**

Every one of them schedules: Uber Freight runs a **Scheduling API**, Loadsmart
documents EDI 214 appointment scheduling, RXO sells dock-time coordination.
A carrier's day is shaped by a delivery window it cannot change, and today
`LoadStop.scheduledAt` is a single timestamp with no notion of a window, a
facility, its hours, or who is allowed to move it.

To build: `windowStart`/`windowEnd` on `LoadStop`, a facility entity (name,
hours, average wait) reused from whatever 2.11 produces, a request/reschedule
thread on `LoadMessage`, and — the part that actually pays — **detention starts
automatically when the appointment time passes while the truck is inside the
fence**, instead of when a driver remembers to tap the clock.

### 2.11 Facility scorecards — **S**

Uber Freight's Facility Insights (appointment efficiency, detention spend per
facility) is the feature a carrier uses to argue with a shipper. We capture the
raw material and aggregate almost none of it: `DetentionEntry` is totalled **per
load only**, to feed the invoice line (`detention.service.ts`), never per
facility or per customer.

To build: group `DetentionEntry` by stop locality plus customer, over a
trailing window: average wait, percent of stops that ran into detention, dollars
recovered and dollars unclaimed (a clock that never ran because the driver
didn't tap). That last number is only visible to us, which is exactly why it is
worth showing.

**Designed:** `FACILITY_SCORECARDS.md` — the grouping (dock area plus
counterparty, because there is no `Facility` and no customer on a load), the
clock-to-stop attribution `DetentionEntry` has no `stopId` for, and the free time
that exists nowhere in the schema and therefore has to be stated on screen.

### 2.12 An automated rate confirmation — **M**

Booking a load today flips `marketplaceStatus` to BOOKED, and the rate lives in
`freightAmount*`. What a broker still emails is a **ratecon** — a numbered,
signed document with the accessorial schedule and the detention terms on it.
We have `LoadSignature`, the `pdf` module and the paperwork templates, so we can
issue ours the moment a load is booked, signed by the posting carrier's standing
acceptance, and store it against the load with the POD.

Why it matters more than it sounds: the ratecon is the contract. "Where is the
signed ratecon for that load" is the first question in every payment dispute,
and we currently answer it with a screenshot of a web form.

### 2.13 Days-to-pay on the card — **S**

We cannot buy broker credit data this week (2.2), but we do not have to start
empty-handed: `trust.service.ts` already derives payment behaviour from settled
invoices — how many loads we have settled with that counterparty and how long
they took to pay. Today that number only appears deep in a trust drawer.

To build: surface it as one chip on the board card, in the same words the trust
panel uses, with the sample size next to it ("4 settlements · avg 23 days").
No new data, no vendor, no lie — and when 2.2 lands, the external score sits
beside our own observed one.

### 2.14 LTL, partials and multi-stop — **L**

`Load.stopCount` is a number and `LoadStop` is a list, but every rate, every
weight and every invoice in the system assumes one truck, one full load.
Partials need per-stop weights and a rate basis that is not $/mile; LTL needs a
class and a pallet count. This is the largest structural gap on the list and the
one least likely to be chosen first — but it is the reason a growing carrier
eventually leaves for a TMS that has it.

### 2.15 French — **L**

There is no i18n in the client at all (no `useTranslation`, no locale files).
DAT One and Truckstop are English-only. We are a Québec product selling to
Québec carriers who dispatch in French and file with Revenu Québec, and their
first question on a demo call is whether the app speaks French.

Curiously, the environment already carries the intent: `LNG: 'en' | 'fr'` and
`LNG_COUNTRY` exist in `env.ts` and are read by nothing else worth mentioning.
So the work is real: an i18n layer, a message catalogue, French copy for the
marketing pages, the sign-in flow, the driver app and the compliance and IFTA
vocabulary — with the legal terms (IFTA, GST/QST, eManifest) kept in their
official French forms rather than translated literally.

### 2.16 An IFTA filing artefact — **M**

The quarter is computed, per jurisdiction, from GPS-verified distance and fuel
purchases (`ifta.service.ts`, `jurisdiction-rates.ts`), and it cannot be filed:
there is no per-jurisdiction return, no fuel-tax summary in the shape a
jurisdiction accepts, and no record of what was filed. The rates are now
reachable read-only from the client, which is the first half of this.

To build: a quarter return per jurisdiction (distance, litres, tax rate, tax
owed/payable), a printable/exportable artefact, and a filed-marker with the date
and who filed it, so "did we file Q2 in New York" has an answer.

### 2.17 Year-end driver slips — **M**

`settlement.service.ts` and `settlement-statement.ts` produce per-driver pay
statements and PDFs. Come January a carrier with drivers on contract needs
**T4A** slips (and 1099-NEC for the US side) and a summary to file. Nothing
produces either, and the totals are sitting right there in the settlements.

### 2.18 Tenant API keys and outbound webhooks — **M**

The modern half of 2.1, and a product in its own right: an API key a broker or a
customer's TMS can hold, scoped and revocable, plus status webhooks signed with
a per-tenant secret. None of it exists — the only inbound webhook is
authenticated by a single instance-wide `ELD_WEBHOOK_SECRET`, which is exactly
the thing that cannot be handed to a third party.

**Designed:** `BROKER_API.md` — the key model (hashed, prefix-looked-up,
scoped, bound to the counterparty it was issued for), the `/api/v1` read surface,
and the outbound half: an event catalogue, delivery that is idempotent by a
derived key rather than by a stored event, and the SSRF guard on a URL a stranger
chooses.

### 2.19 Truck-legal routing, scales and tolls — **L**

`geo.service.ts` resolves places and `postgis.service.ts` computes practical
distance and a route geometry from ingested positions. What a driver actually
needs before rolling is a **legal** route for their height/weight/hazmat, the
scales on it, and the toll cost — which is also the missing input to 2.5's cost
per mile. This is a partner-integration decision (routing vendor) more than an
engineering one, so it should be priced before it is scoped.

### 2.20 Owner analytics — **M**

An owner cannot answer "which lane makes me money" today. `LaneDailyStat`,
`Settlement`, `Invoice` and the new cost-per-mile engine (2.5) hold everything
needed: revenue per truck, per lane, per customer; deadhead ratio over time;
margin per loaded mile. This is the page that justifies the subscription to
whoever signs the cheques, and the one every competitor has.

---

## Part 3 — What this week's work turned up

1. **The board's mobile overflow is fixed, and it was a real bug.** Earlier notes
   in this file claimed a 143 px overflow at 390 px and blamed the icons. It was
   CSS grid's automatic minimum size: `.load-card` is a grid item with
   `min-width: auto`, so its nowrap lane row and nowrap rate held the track open
   at ~526 px inside a 349 px grid — and `1fr` at ≤960 px means
   `minmax(auto, 1fr)`, which grew to fit it. `.form-grid`'s two `1fr` columns
   did the same to Drivers (35 px), Fleet (18 px) and My Loads (71 px). After
   `min-width: 0`, `minmax(0, 1fr)` and a wrapping `.carrier-row`, all 15 app
   routes and the public pages measure `scrollWidth === clientWidth` at 360,
   390, 600 and 768. **Wide tables still overflow inside `.table-scroll`**,
   which is deliberate and stays.
2. **Offline paths need a device-level check, not just unit tests.** The queue's
   bug this week — a database that reached a version without a store, so every
   write to it failed and the app reported the device as one that never stores
   anything — was invisible to `jest` (no DOM) and only showed up in a browser.
   Either `fake-indexeddb` in a second jest project or two Playwright paths
   (queue → go online → assert the row) would have caught it.
3. **The fuel warning quotes the tax now, not just the pump price.** Done:
   `GET /api/ifta/rates` exposes the configured jurisdiction table read-only
   (`jurisdiction-rates.ts`), deliberately outside `gatedFeature('ifta', …)`
   because a DRIVER holds no IFTA entitlement, and resolved once in `buildApp`
   so the same table feeds `IftaService` and the warning. The comparison is
   drawn only against jurisdictions the driver has actually fuelled in.
4. **The demo hides the fuel story.** The demo driver has no fuel history, so
   IFTA, the fuel card and the nudge are all invisible in a demo. Three or four
   seeded fill-ups — one across a border, which also exercises the currency
   split — make the wedge visible in 10 seconds.
5. **There are no tests for the board.** `tests/` holds 53 unit and 7
   integration files and not one covers `LoadBoardService` or `board.policy.ts`,
   which is the most-used code path in the product. Anything built on the board
   from here should bring its first tests with it.
6. **The board is not paginated.** `findPublic` takes the newest 500 and the
   radius/locality filtering happens in JS afterwards, so filters that match
   little still pay for 500 rows and the 501st load is invisible. Fine at demo
   scale, worth knowing before 2.3 adds a second pass over the same set.

---

## Part 4 — What I would build next

The order is not "biggest first"; it is what compounds.

| # | Item | Effort | Why now |
|---|---|---|---|
| 1 | Deadhead + net $/mi on the card (2.3) | S | The cheapest thing here that carriers *feel* daily, and every coordinate it needs is already on the row |
| 2 | Round trips / backhaul pairing (2.3) | M | Same data, and it is why an owner-operator opens a board twice a day |
| 3 | Cost per mile by unit (2.5) | M | Turns every rate on the board into a decision; needs no maintenance data to be useful if it says what it omits |
| 4 | Tracking milestones + a share link (2.7) | M | Kills check calls, and it is the prerequisite for tenders |
| 5 | Facility scorecards (2.11) | S | We already capture the data and show it to nobody |
| 6 | Days-to-pay chip (2.13) | S | The honest half of 2.2, with no vendor |
| 7 | Clearinghouse query + DVIR (2.6) | M each | Legal exposure is a different class of problem than a missing feature |
| 8 | Automated ratecon (2.12) | M | The contract behind every payment dispute |
| 9 | POD reading (2.8) | M | We own every part of it already |
| 10 | Owner analytics (2.20) | M | The page that justifies the invoice |
| 11 | Inbound tenders + webhooks + API keys (2.1, 2.18) | L | The one that changes what this product *is* |
| 12 | Border readiness + waits (2.4) | L | Our home advantage; nobody else is doing it well |
| 13 | Appointment scheduling (2.10) | M | Feeds detention-autostart, which pays immediately |
| 14 | IFTA filing artefact (2.16) | M | Finishes a feature we already compute |
| 15 | French (2.15) | L | The Québec demo question, in every call |
| 16 | T4A / 1099 slips (2.17) | M | Seasonal, but a hard deadline every January |
| 17 | Broker credit + COI verification (2.2) | M + commercial | Mostly a data decision, not an engineering one |
| 18 | Truck-legal routing (2.19) | L | Price the partner before scoping |
| 19 | LTL / partials (2.14) | L | Structural; needs a rate basis we do not have |

Two things I would deliberately **not** do: re-rank the board by anything the
carrier cannot check themselves (the trust panel's discipline is the product's
best feature), and add a feature to the driver app that a driver cannot finish
from the cab — the fuel and renewal queues exist because the alternative was a
dead end on a phone with no signal.

### Shipped from this list

- **Items 1–4** — deadhead and net revenue per mile on the board card, backhaul
  pairing, cost per mile by unit with its omissions stated on the screen, and
  tracking milestones behind a public link. See `FEATURE_PLAN.md` for the
  implementation notes and the tests each one carries.
- **2.16's first half** — jurisdiction rates readable by the client (Part 3.3).

Two decisions from that build worth remembering, because they are the kind that
look like shortcuts later:

1. **Milestones are derived, not stored.** `milestonesFor()` recomputes the
   arrival and departure at every stop from the truck's own position history on
   each read, instead of writing an event when a fix lands inside a fence. A
   backfilled trail produces the same milestones as a live one, tuning the fence
   radius re-answers history correctly, and there is no third copy of a fact
   `RoutePoint` and `LoadStop` already hold. Nothing was added to the schema for
   this feature.
2. **The declared fixed cost is a tenant setting, not a table.** A truck payment
   is a number an owner types once; `TenantSetting.asset_costs` is where it
   lives, which kept the deployment free of a migration.
