# Where Loadwave stands — and what the boards our carriers also use have that we don't

Written October 2026, against the code in this repository rather than against a
competitor's marketing page. Every item below names **what exists here today**
(file included) so nothing gets built twice, and then what is actually missing.

The comparison set is what a small Canadian cross-border carrier is actually
choosing between: DAT One and Truckstop for finding freight, Uber Freight /
RXO / Loadsmart for tendered freight, and whatever TMS their dispatcher uses
(McLeod, TMW, Turvo — or a spreadsheet). The question is not "who has the most
features" but "which of their features does a carrier refuse to give up".

Legend: **S** < ½ day, **M** 1–2 days, **L** 3–5 days.

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

To build: an inbound tender endpoint that can be called by a broker's system and
answers with a load id (`POST /api/tenders`, idempotent on a broker reference),
plus signed webhooks out (status changes → the broker's URL). Behind it, an
`ExternalTender` model recording who sent what and what we answered, because the
day a broker disputes a tender, the log is the defence. EDI can come later on
top of the same internal shape — do not model the API around X12 segments.

Why it matters: a carrier with 20 trucks will not accept tenders by hand for
long, and "we can take your tenders" is what turns a board into a system of
record.

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

### 2.3 Rank by what the truck earns, not what the lane pays — **M**

Every board shows $/mile on the card. The ones carriers prefer subtract the
**deadhead to the pickup** — and the good ones offer a backhaul.

Today: `board.store.ts` computes a marketplace lane benchmark (`$/mile` for this
O→D pair), `LaneDailyStat` keeps history, and `PostGIS` already knows how far
apart two points are. The distance between "we have all of this" and "the card
sorts by true revenue per loaded-and-empty mile" is small.

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
jurisdiction, and that is it.

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
(nothing yet, see 2.6), tolls, and fixed costs per truck, against loaded miles.
Without it "$2.15/mile" is a headline, not a decision; (2) a **factoring export**
(their portals take invoices as a file or an API) and then a **QuickBooks/Xero**
sync so the accountant stops retyping; (3) instant pay for drivers, which is the
single most-wanted benefit in every driver survey.

### 2.6 Safety has legal teeth — **M, each**

Their compliance suites are not document filing cabinets; they are wired into
mandatory checks. FMCSA's **Drug & Alcohol Clearinghouse** requires a query
before every hire and at least annually thereafter, and carriers get fined for
missing it. **CSA scores**, **PSP** reports and continuous **MVR monitoring**
are what safety managers watch.

Today: `compliance.service.ts` tracks CDL, medical card, MVR, annual review,
IFTA licence, authority and insurance with expiries, sweeps and push reminders —
an excellent *document* system (and this week it got driver-side renewal from
the cab).

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

Today: `eld.ingest.service.ts` ingests position batches, and `RoutePoint` /
`RouteSegment` already store the GPS trail. Nothing turns it into a milestone.

To build: geofence the load's stops (`LoadStop` has the coordinates), emit
Arrived/Departed as load status transitions, and expose a **tracking link** a
broker can open without an account. Then the status events in 2.1 have something
to send.

### 2.8 Paperwork that reads itself — **M**

Today: `document.service.ts` stores POD/BOL/DAMAGE uploads, `paperwork.service.ts`
captures signatures, and this session added a PDF417 barcode reader for licence
renewals (`aamva.ts`, `pdf417.ts`).

Missing: reading a **POD** — the page a driver photographs at the dock — to pull
the receiver, the date, the signature and the piece count, and then marking the
load billable. We already own every part: camera capture, image decoding, a
document model, invoicing. It turns "invoice from delivered load is one click"
into "the invoice is waiting when the driver is still on the dock".

### 2.9 Reach — **S/M, each**

- **SMS**: `notification.service.ts` does in-app and best-effort email, plus web
  push. A driver in a cab reads a text, not an email.
- **Native app**: the web app is installable and offline-capable, and that is
  genuinely good. The native gap is *not* the reason to build one — background
  location and the camera are (see 2.7, 2.8).
- **ELD vendor connectors**: `POST /api/eld/events` takes a generic batch, so
  every integration is somebody's custom job. A connector per major vendor
  (Motive, Samsara, Geotab) with its own auth is what makes ingest a feature
  instead of a project.

---

## Part 3 — What this week's work turned up

Small, concrete, and cheaper than anything above.

1. **The board's load card overflows a phone by 143 px.** Measured on a 390 px
   viewport: `documentElement.scrollWidth` 538 against `clientWidth` 373, with
   `.load-card` at 503.8 px. It is not the icons — removing all 17 inline icons
   the emoji sweep added only takes it to 516 px, and no descendant of the card
   measures wider than 373 px, so the width is being imposed by an ancestor
   track. `FEATURE_PLAN.md` claims a 360 px audit found every app route clean,
   so either that audit missed `/app/board`'s list or the layout has drifted
   since. Worth an hour: it is the page carriers open most.
2. **Offline paths need a device-level check, not just unit tests.** The queue's
   bug this week — a database that reached a version without a store, so every
   write to it failed and the app reported the device as one that never stores
   anything — was invisible to `jest` (no DOM) and only showed up in a browser.
   Either `fake-indexeddb` in a second jest project or two Playwright paths
   (queue → go online → assert the row) would have caught it.
3. **The fuel warning is one rate table away from being about tax.** It can now
   say what was bought, when and at what pump price. The *tax* per jurisdiction
   already exists server-side (`IFTA_JURISDICTION_RATES`,
   `jurisdiction-rates.ts`) and is not reachable from the client, so the
   warning's dollar claim is honestly about price instead. Expose it (read-only,
   tenant-scoped) and the same table powers 2.5's fuel-buy optimisation.
4. **The demo hides the fuel story.** The demo driver has no fuel history, so
   IFTA, the fuel card and the new nudge are all invisible in a demo. Three or
   four seeded fill-ups — one of them across a border, which also exercises the
   currency split — make the wedge visible in 10 seconds.

---

## Part 4 — What I would build next

The order is not "biggest first"; it is what compounds.

| # | Item | Effort | Why now |
|---|---|---|---|
| 1 | Fix the board's mobile overflow (Part 3.1) | S | It is the most-visited page and it is measurably broken |
| 2 | Deadhead + backhaul ranking (2.3) | M | The cheapest thing on this list that carriers *feel* daily, and the data is already here |
| 3 | Tracking milestones + a share link (2.7) | M | Kills check calls, and it is the prerequisite for tenders |
| 4 | Clearinghouse query + DVIR (2.6) | M each | Legal exposure is a different class of problem than a missing feature |
| 5 | Cost per mile (2.5) | M | Turns every rate on the board into a decision |
| 6 | POD reading (2.8) | M | We own every part of it already |
| 7 | Inbound tenders + webhooks (2.1) | L | The one that changes what this product *is* |
| 8 | Border readiness + waits (2.4) | L | Our home advantage; nobody else is doing it well |
| 9 | Broker credit + COI verification (2.2) | M + commercial | Mostly a data decision, not an engineering one |
| 10 | Factoring / accounting (2.5) | L | Needs a partner decision before code |

Two things I would deliberately **not** do: re-rank the board by anything the
carrier cannot check themselves (the trust panel's discipline is the product's
best feature), and add a feature to the driver app that a driver cannot finish
from the cab — the fuel and renewal queues exist because the alternative was a
dead end on a phone with no signal.
