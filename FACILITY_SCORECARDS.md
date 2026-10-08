# Facility scorecards — which docks cost you money, and how much of it you billed

Plan, October 2026, against the code at `f6f635a`. This is the design for
GAP_ANALYSIS **2.11** (the item ranked fifth in Part 4: *"we already capture the
data and show it to nobody"*).

The product currently knows that a driver waited 3 h 40 m at a dock, that the
clock was worth $275, and — since the cost-per-mile work this week — that $165 of
that was never claimed because nobody started a timer. What it cannot answer is
the only question a carrier takes to a shipper: **which dock is doing this to me,
repeatedly**?

---

## Part 1 — What exists, and what that already buys

Every input is on disk. This is the reason the item is small.

| Input | Where it lives | State |
|---|---|---|
| Waiting time, per stop | `DetentionEntry` (startedAt, endedAt, ratePerHour, driverId, note) | Captured. Totalled per load only, to feed the invoice line |
| The dock: where and which stop | `LoadStop` (kind, stopOrder, country, region, locality, lat, lon, scheduledAt) | Captured |
| When the truck was actually there | `RoutePoint` trail + `milestonesFor()` in `tracking.policy.ts` | Derived this week: `arrivedAt`, `departedAt`, `dwellMinutes`, `lateMinutes` |
| The rate to value a lost hour | `Load.detentionRate` (`$/hr after free time`) | Captured |
| Value of an unclaimed clock | `unclaimedDetention()` in `cost.policy.ts` | Built this week |
| Who the freight came from | `Load.tenantId` / `Load.bookedByTenantId`, `Invoice.customerId`, `Tenant.name` | Captured |

The two facts that decide the design:

1. **`DetentionEntry` has no `stopId`.** A waiting clock is attached to a load,
   never to the stop it was spent at. Any per-facility number must therefore
   *attribute* clocks to stops, and attribution that cannot be done must be
   reported rather than guessed.
2. **Free time exists nowhere in the schema.** `detentionRate` is documented as
   "$/hr after free time", and the free time itself appears only as prose on the
   generated ratecon (*"Detention is billed at CA$75.00 per hour after the free
   time at each stop"* — `paperwork.service.ts`). So the scorecard has to state
   the free time it assumed, or it is quietly inventing the biggest input in the
   calculation.

---

## Part 2 — The four questions the page answers

1. **Which docks cost me money?** Visits, median wait, share of visits that ran
   past the free time, and unclaimed minutes — ranked by what the dock costs, not
   by how many times we went there.
2. **How much of it did I actually bill?** Claimed dollars against *claimable*
   dollars, per dock and per customer. This is the number that changes behaviour,
   because it is the one the carrier can fix without anyone else's cooperation.
3. **Who should be paying for it?** The same dock ranked by the counterparty the
   freight came from, so "it is this broker's customer's DC" is visible.
4. **Is the appointment window real?** Arrival lateness against `scheduledAt`
   (median and share late), which is the evidence for the conversation about a
   window that no truck can make.

---

## Part 3 — Facility identity, the honest version

We have no `Facility` model and no customer on a load. So v1 groups by what the
stop already carries:

```
facilityKey = (country, region, locality)      e.g. ("CA", "ON", "Mississauga")
customerKey = counterparty tenant name        → the tenant on the other side:
                                                   bookedByTenantId when we hauled it,
                                                   tenantId when we posted it
              else Invoice.customerId (a free string, matched trimmed/case-folded)
              else "own account"
```

That is deliberately not a dock. It is a *dock area*: "Mississauga, ON" is not
one building, and a scorecard that pretends otherwise ranks a city. Two things
make that acceptable rather than sloppy:

- The label says what it is. The page header for a facility reads
  **"Mississauga, ON — 14 stops, 6 addresses"** where the distinct-address count
  is the number of distinct `(lat, lon)` pairs at 3-decimal rounding. Nobody
  mistakes that for one warehouse.
- It works on day one with data already recorded. The alternative — build
  `Facility` first — requires someone to name two hundred docks before they see a
  single number, and the number is the reason they would bother naming them. The
  order matters, and this is the order that produces the number.

### The upgrade, when someone names a dock

```prisma
model Facility {
  id             String   @id @default(uuid())
  tenantId       String
  name           String                    // "Loblaws DC 1042"
  country        String
  region         String
  locality       String?
  lat            Float?
  lon            Float?
  /// Tighter than the 750 m default once a dock is named and drawn.
  fenceRadiusKm  Float    @default(0.75)
  /// Overrides the tenant default for this dock. This is where "they make you
  /// wait 4 hours free" belongs — a fact about the facility, not the load.
  freeTimeMinutes Int?
  detentionRate  Decimal? @db.Decimal(10, 2)
  /// When set, bookings here are warned before a driver commits to the window.
  notes          String?
  createdAt      DateTime @default(now())

  stops LoadStop[]

  @@unique([tenantId, name])
  @@index([tenantId, region, locality])
}
```

`LoadStop.facilityId` (nullable, `SetNull`) links a stop to one. The migration
path is a backfill, not a data-entry project: when a tenant opens the scorecard
for the first time, offer **"Name these stops"** for the top ten dock areas by
unclaimed dollars, pre-filling name/locality/coordinates from the existing stops,
and auto-link every future stop whose `(locality, region)` matches by exact,
case-folded equality. Coordinates alone never auto-link: two docks 300 m apart in
an industrial park are two docks, and a wrong link silently moves one facility's
detention onto another's record.

Once `Facility` exists, the same page gets sharper in three ways with no new
query: real names, per-facility free time (which is the honest fix for the
assumption in Part 4), and a tighter fence so arrival is measured at the right
building.

---

## Part 4 — The measurement contract

This is the part that has to be exactly right, because every figure is used to
argue with somebody.

**A visit** is one `LoadStop` that the truck actually went to: a stop where
`milestonesFor()` derived both an `arrivedAt` and a `departedAt` from the
assigned unit's trail. `dwellMinutes` is the wait.

**Stops that cannot be measured are counted, not dropped.** A stop with no trail
(no ELD, a dead unit, an assignment that ended before ingest) contributes nothing
to a wait average — and is reported: **"68 stops in this window, 43 measured, 25
have no position history."** The alternative silently flatters every facility at
exactly the docks where the truck had no coverage, and a scorecard that hides its
own denominator is worse than no scorecard.

**Free time is an assumption, and it is printed.** v1 reads it from a tenant
setting in `TenantSetting` (the same store the declared fixed cost uses):

```
key: detention_terms
{ "freeTimeMinutes": 120, "currency": "CAD", "note": "standard 2 hours per stop" }
```

The default of 120 minutes is labelled as ours on screen ("no free time recorded
for this account, using our default of 2 h"), because a carrier whose contracts
say four hours would otherwise read every unclaimed dollar as money they are
owed. Changing it re-answers history immediately — nothing is stored, so nothing
has to be migrated, and the same discipline that made milestones derivable makes
this adjustable. Per-facility and per-load overrides come with `Facility`.

**Claimed minutes** for a visit = the minutes of `DetentionEntry` rows for that
load whose `[startedAt, endedAt ?? now]` window overlaps the visit's
`[arrivedAt, departedAt]` window.

**Unattributable clocks are their own line.** A `DetentionEntry` that overlaps no
visit — no trail, so no window to overlap — is not evidence about a dock, and it
must not be folded into one. It is reported as **"4 h 20 m of waiting time could
not be placed at a stop"**, with the loads listed, because that is a data-quality
item the carrier can act on (start the clock from the stop screen) and a facility
ranking cannot act on it.

**Unclaimed minutes** = `max(0, dwell − freeTime) − claimed`, per visit, summed.
Dollars only when `Load.detentionRate` is set:

```ts
// reuse, not reimplementation — it already exists and is already tested
unclaimedDetention(minutes, load.detentionRate)   // cost.policy.ts
```

**No rate means minutes, never dollars.** If the load carried no `detentionRate`,
the column shows "3 h 10 m" and a dash where the money is, with a note that the
rate is recorded on the load. Summing an assumed rate across facilities would put
a number in a carrier's mouth the moment they quote it to a shipper.

**Recovered** = claimed minutes × the load's rate, which reconciles to the
`detentionRecovered` figure the cost panel already shows for the fleet. Two
screens, one arithmetic — a test asserts the totals agree over the same window.

### The statistics, and why not the mean

Per facility, over a trailing window (default 90 days, selectable):

| Figure | Definition | Why this one |
|---|---|---|
| Visits | measured stops | the denominator, always shown |
| Median wait | median of `dwellMinutes` | one 9-hour reefer dock makes a mean meaningless |
| Longest wait | max `dwellMinutes` | the story a carrier tells |
| Share over free time | visits with `dwell > freeTime` | the probability a truck will be held |
| Median lateness | median `lateMinutes` vs `scheduledAt` | proves a window is unmakable rather than arguing it |
| Unclaimed minutes / dollars | Part 4 above | what the carrier can fix alone |
| Recovered dollars | claimed × rate | what they got |

**Per visit as well as per total.** A dock that costs $400 a year across 60 visits
is a scheduling annoyance; one that costs $400 in three visits is a place to
refuse freight. The totals alone cannot tell those apart, so the page prints
both, and the default ranking is by **unclaimed dollars per visit** — the figure
that is both fixable and fairly comparable.

**No ranking below five measured visits.** A dock listed as "worst" on one visit
is a coin toss with a number attached. Below the threshold the facility appears
in an "insufficient history" group with its visit count and nothing else.

---

## Part 5 — Where it lives

Server, `src/modules/facilities/`, in the shape this repo already uses:

- **`facility.policy.ts` (pure, the bulk of the tests).**
  `facilityKey(stop)`, `attributeEntries(visits, entries)` returning
  `{ claimed, unattributable }`, `visitOf(load, stop, milestones, entries)`,
  `scorecard(visits, terms)` with median/p90/share-over-free-time,
  `unclaimedMinutes(visit, freeTime)` delegating to `cost.policy`, and
  `rank(scorecards, minVisits)`.
- **`facility.repo.ts`.** One pass per load over a window:
  loads delivered inside it (or assigned and open) → their stops → their
  `DetentionEntry` rows → the assigned unit's `RoutePoint` trail through the
  existing `tracking.repo.fixes()` (which is already capped at 2,000 fixes and
  already indexed on `(tenantId, assetId, occurredAt)`), plus the counterparty
  names in a single batched lookup rather than per row.
- **`facility.service.ts`.** Loads the window, reuses `tracking.policy` to derive
  visits — *the same function the tracker page and the future webhook sweep use*,
  which is the whole reason the numbers on this page cannot disagree with the
  numbers on the tracking page.
- **`facility.routes.ts`.** `GET /api/facilities/scorecards?from=&to=&minVisits=`,
  `GET /api/facilities/:key/detail?from=&to=`, `GET /api/facilities/:key/statement.pdf`
  (permission: ADMIN/DISPATCHER).

Client: **`FacilityPanel.tsx` on the Fleet page, directly under `CostPanel`** —
the cost panel already shows "detention recovered" fleet-wide, and this is that
number broken down by who caused it, so the adjacency is the point. Plus a
drill-down table and the insufficient-history group.

The PDF statement is the artefact that closes the loop: **"Detention at
Mississauga, ON — Q3 2026"**, one page per facility listing each visit (date,
arrival, departure, wait, free time assumed, minutes claimed, minutes not
claimed, rate) and the totals, produced through the existing `pdf` module and
`paperwork` templates. That is what a carrier actually emails a shipper, and a
scorecard that cannot leave the screen does not get used in the conversation it
exists for.

---

## Part 6 — Cost and load

The expensive part is the trail, and it is already bounded: `fixes()` takes at
most 2,000 points per unit per load window. A 90-day window over a 20-truck fleet
with 40 loads a week is roughly 500 loads, 500 trail queries and 1,000 stop
derivations — comfortably inside a request if the queries are batched by load and
the counterparty names are fetched once.

Two guards, both learned from this week's `listPublic` mistake (an O(n²) pass
that a five-minute sweep paid for):

1. **Cap the window and the load count**, and answer with `truncated: true` plus
   the window actually used when the cap bites. A silently short window is a
   wrong numerator behind a correct-looking average.
2. **No sweep calls this.** The scorecard is computed on demand for the page and
   for the PDF, never from a timer. If a future alert ("this dock is getting
   worse") wants to run on a schedule, it reads a cached window, not a live
   recomputation.

---

## Part 7 — Tests

Pure policy tests (`tests/unit/facility-policy.test.ts`, the bulk):

- `attributeEntries`: an entry inside one visit's window; an entry spanning two
  visits (counted at the one it overlaps most, with the split stated); an entry
  overlapping none (unattributable, never assigned); two entries at one visit
  (summed, not double-counted).
- The free-time arithmetic: dwell under free time → zero claimable; dwell over →
  the difference; **with no `detentionRate` → minutes and a null amount, never
  zero dollars**; a facility override beating the tenant default.
- Medians with an even and an odd count, and a single-visit facility.
- The minimum-visit threshold keeping a one-visit dock out of the ranking.
- Coverage arithmetic: measured + unmeasured = total stops, asserted as an
  identity so the "43 of 68" line can never drift from the data.
- Reconciliation: `Σ recovered` across facilities equals
  `cost.policy`'s `detentionRecovered` for the same window.
- `facilityKey` folding (case, whitespace, accents) and never merging two
  localities in different regions.

Integration (`tests/integration/facilities-api.test.ts`, injected fakes like the
other integration suites):

- A load with a trail, a stop and a detention entry produces one measured visit
  with the expected claimed/unclaimed split.
- A load with a trail and no clock produces the unclaimed number (the whole
  point of the feature) and no recovered number.
- A load with a clock and no trail lands in unattributable, and changes no
  facility's figures.
- A driver gets 403, an ADMIN gets 200, and tenant A never sees tenant B's
  facilities.
- The window cap answers `truncated: true` rather than quietly shortening.

Live check: the seeded demo tenant's trip (arrived, departed, an hour on the
clock) should produce one measured visit at the receiver's locality with a
non-zero unclaimed line, screenshotted at 390 px alongside the coverage sentence
— the same check that caught the three real defects in the earning-tools work.

---

## Part 8 — Build order

| # | Slice | Effort |
|---|---|---|
| 1 | `facility.policy.ts` + its tests, over fixtures | S |
| 2 | `facility.repo.ts` + `facility.service.ts` + `GET /api/facilities/scorecards` | M |
| 3 | `FacilityPanel.tsx` on Fleet: ranking, coverage sentence, free-time assumption, unclaimed column, insufficient-history group | M |
| 4 | Tenant `detention_terms` setting (`GET`/`PUT`, default labelled) | S |
| 5 | Drill-down per facility, and the PDF statement through the existing templates | M |
| 6 | `Facility` model + `LoadStop.facilityId` + the naming/auto-link flow | M |

Slices 1–3 are the feature. Slice 4 is what makes the numbers defensible; 5 is
what makes them usable outside the product; 6 is what makes them sharp and is the
only slice with a migration.

Deliberately **not** in this plan:

- **Facility hours and the hourly cost of delay.** Cost of delay needs a value of
  the truck's time, which is exactly the declared cost the owner already types
  into `TenantSetting.asset_costs` — worth doing, but it is a margin figure, not
  a detention figure, and mixing them in one column invites a carrier to quote a
  number that is half invoice and half estimate.
- **Automated claim filing.** A portal-integration per shipper is a product of
  its own. The PDF is the 90% version.
- **Shipper-side views.** Our tenant is the carrier; showing the shipper this page
  is a different consent decision.
- **Appointment scheduling (2.10).** Worth noting that this plan makes 2.10's
  payoff bigger rather than smaller: automatic detention start needs per-facility
  free time, which is the `Facility` row this plan introduces. If 2.10 is built
  first, it should declare `Facility` itself and this plan should consume it.
