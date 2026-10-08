# The broker-side API — tenant API keys, and signed webhooks out

Design, October 2026, written against the code at `f6f635a`. This is the design
for GAP_ANALYSIS **2.18** (API keys + outbound webhooks) and the outbound half of
**2.1** (freight that arrives without anybody retyping it). The inbound tender
endpoint is deliberately *not* in this document, but every shape here was chosen
so that it drops in without a second credential model — see Part 16.

The problem in one sentence: a broker's TMS can already see where their load is,
but only if a human pastes a link into a browser and looks at it. That is a page,
not an integration, and no brokerage integrates with a page.

---

## Part 0 — The shape of the thing

Two credentials, in opposite directions, because they fail in opposite ways:

| Direction | Credential | At rest | Rotation cost |
|---|---|---|---|
| Broker calls us | `ApiKey` | Hashed (SHA-256 of 256 random bits) | New key, revoke old. Our move, no coordination. |
| We call the broker | Webhook signing secret | Recoverable (we must sign with it) | New secret, both accepted during an overlap window |

A broker integrates by: (1) getting a key, (2) polling `GET /api/v1/loads` for
what they may see, (3) registering a webhook URL for the events they care about,
(4) verifying `X-Loadwave-Signature` on each delivery. That is the whole
contract, and every part of it below is an argument about what *not* to put in
it.

Three decisions set the tone, and are worth stating before the detail:

1. **A machine credential is not a user.** The API key path never fabricates a
   `JwtUser`. It populates `request.api`, and only the `/api/v1/*` routes read
   it. There is no code path where a key can hold a role, because the day one
   can, a key is an ADMIN with a longer password.
2. **A key issued to a partner is bound to the partner.** Without binding, "give
   your TMS a key" means "give your TMS the whole company": every load, every
   rate, every customer. The binding is a single policy function, not a filter
   each route remembers to apply.
3. **What we send a third party is an allow-list of fields, exactly like the
   public tracking page.** The webhook payload is assembled from the same
   projection as `GET /api/track/:loadId/:token`, with rates and customers absent
   by construction rather than filtered on the way out.

---

## Part 1 — What the broker can read (v1, and only this)

`/api/v1` is a new, versioned, key-authenticated surface. It is frozen for
twelve months and changes additively; a breaking change is `/api/v2`. The
session-authenticated API stays where it is, unversioned, because it ships with
the client that calls it.

```
GET /api/v1/me
      → { tenant: { id, name }, key: { id, prefix, scopes, partnerTenantId }, api: { version: "v1" } }

GET /api/v1/loads?updatedSince=<iso>&status=<csv>&limit=50&cursor=<opaque>
      → { data: [ LoadSummary ], nextCursor: string | null, hasMore: boolean }
      LoadSummary: { id, reference, status: { code, label }, lane, stops: StopSummary[],
                     updatedAt, createdAt }

GET /api/v1/loads/:loadId/tracking
      → the same key set as PublicTrackingView (tracking.service.ts), plus `reference`

GET /api/v1/loads/:loadId/events?limit=100&cursor=
      → { data: [ DeliveryRecord ] }   // what we sent about this load, and whether it landed
```

Every response carries `X-Request-Id` (Fastify's, echoed) so a broker's support
email can be matched to our log line without guessing at timestamps.

What is deliberately **not** in v1, and why:

- **Rates and amounts.** Not because the broker lacks them — they posted the
  load — but because a payload that omits money cannot leak money, and the
  ratecon is the document of record. A key that could read `freightAmount` would
  turn a leaked webhook body into a rate-comp disclosure between competing
  carriers on the same lane. (Cost is a lane-level benchmark, not a load price.)
- **Documents and PODs.** There is no per-document scope and never-sharing default
  yet; a POD is a signed page between two parties and needs its own consent
  story.
- **Write operations.** Nothing in v1 mutates. A read-only key is one that cannot
  double-book freight because of a retry.
- **Driver names and the tenant's other loads.** `assigneeDriverId` is absent
  from the partner projection: who works for a carrier is not the broker's
  business, and the public tracker already draws this line.

The only exception to the read-only rule arrives with 2.1's tenders, on the same
key, with a separate `tenders:write` scope and its own idempotency key.

---

## Part 2 — The key: format, storage, verification

```
lw_live_7f3c9a21_Kq2mF0bY8sV4nRtLpXzHcJdW9gAe6UvB
    ^env ^prefix  ^secret (32 base64url chars = 192 bits)
```

- The **prefix** (8 chars) is stored in plaintext and indexed. It is what the key
  is *identified* by in the UI ("Key `7f3c9a21`, created by Marie, last used 4
  minutes ago") and what the verification lookup is keyed on.
- The **secret** is 32 bytes from `crypto.randomBytes` and is stored only as
  `sha256(secret)`. It is shown exactly once, on creation, in the response to
  `POST /api/api-keys`, and is unrecoverable afterwards. That is stated in the
  UI, not just here.

Why SHA-256 rather than bcrypt (the repo already has bcrypt for passwords): an
API key is 192 bits of uniform randomness, not a human-chosen password. There is
no dictionary to slow down, so the only thing a slow hash buys is latency on
every single API call, paid by the honest caller. A password needs bcrypt
precisely because it is guessable; a random key needs only to be unguessable.

Verification, per request:

```
1. Authorization: Bearer lw_live_7f3c9a21_Kq2m...   (or X-Api-Key)
2. split on "_": must match /^lw_(live|test)_([0-9a-f]{8})_([A-Za-z0-9_-]{32})$/
   → malformed keys are rejected before any database read
3. findUnique({ prefix })  → one indexed lookup
4. revokedAt === null, and (expiresAt === null || expiresAt > now)
5. timingSafeEqual(sha256(secret), key.hash)
6. touch lastUsedAt / lastUsedIp at most once per minute per key (see Part 12)
```

Two deliberate properties: **no cache**, so revocation is immediate — the
alternative (a 60-second verification cache) would mean a stolen key keeps
working for a minute after the owner hits revoke, which is exactly the minute
that matters. One indexed lookup per request is affordable; the `lastUsedAt`
write is the expensive part and it is throttled instead.

And: **a missing key, a malformed key, a revoked key and a wrong secret are all
`401 unauthorized` with one message.** A broker debugging their integration gets
`X-Request-Id` and the operator can look it up; an attacker learns only that
something was wrong.

### Model

```prisma
model ApiKey {
  id                 String    @id @default(uuid())
  tenantId           String
  /// Issuing account. A key's audit trail starts with who minted it.
  createdByUserId    String?
  name               String
  /// "lw_live_" | "lw_test_" — a test key is never accepted in production.
  environment        String    @default("live")
  prefix             String    @unique
  hash               String
  /// CSV, mirroring User.roles: parseScopes() sits beside parseRoles().
  scopes             String
  /// When set, this key may only read loads this counterparty is party to.
  partnerTenantId    String?
  lastUsedAt         DateTime?
  lastUsedIp         String?
  expiresAt          DateTime?
  revokedAt          DateTime?
  revokedByUserId    String?
  createdAt          DateTime  @default(now())

  tenant          Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  partnerTenant   Tenant? @relation("ApiKeyPartner", fields: [partnerTenantId], references: [id], onDelete: SetNull)
  createdByUser   User?   @relation("ApiKeyCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)

  @@index([tenantId, revokedAt])
  @@index([partnerTenantId])
}
```

Scopes are a CSV column rather than a join table for the same reason roles are
(`parseRoles` already exists): the set is small, closed, and read on every
request — a join buys nothing and costs a round trip. The scopes:

| Scope | Grants |
|---|---|
| `loads:read` | list and read the loads this key is allowed to see |
| `tracking:read` | the milestone projection for those loads |
| `webhooks:manage` | register and rotate this key's own webhook endpoints |
| `tenders:write` | reserved for 2.1; no route accepts it yet |

`parseScopes` rejects anything not in the table, and a scope the server does not
know about is a scope the server does not honour — an unknown scope must never
be silently treated as "all".

---

## Part 3 — Binding a partner key, in one place

The partner binding is the difference between an integration and a data breach,
so it is a policy function with tests, not a `WHERE` clause repeated per route:

```ts
// src/modules/apikeys/api.policy.ts
export function mayReadLoad(api: ApiPrincipal, load: LoadParties): boolean {
  if (!api.scopes.includes('loads:read')) return false;
  if (load.tenantId === api.tenantId) return true;              // ours
  if (load.bookedByTenantId === api.tenantId) return true;      // we booked it
  // A partner key reaches exactly the loads its tenant is a party to.
  return api.partnerTenantId !== null && (
    load.tenantId === api.partnerTenantId ||
    load.bookedByTenantId === api.partnerTenantId
  );
}
```

`LoadParties` is `{ tenantId, bookedByTenantId }` — the two columns the
marketplace already keys on. The projector that turns a load into a
`LoadSummary` throws `notFound` (not `forbidden`) when `mayReadLoad` says no, so
the endpoint cannot be used to enumerate which load ids exist. Same discipline as
the tracking link, which answers a wrong token and an unknown load identically.

A key minted *without* `partnerTenantId` is a first-party key: the carrier's own
TMS, reading its own freight. The UI makes the distinction a two-option choice
with the partner one requiring you to pick the counterparty from the carriers you
have actually traded with (`CarrierRating` / `LoadMessage` counterparties already
give that list), because a partner key that points at a tenant you have never
done business with is a mistake either way.

---

## Part 4 — Events out: the catalogue, and where each one is produced

Six event types in v1, chosen so that every one of them is a fact we can already
derive and none of them is a fact we have to invent:

| Event | Produced by | Exists today as |
|---|---|---|
| `load.posted` | `bus` → `EVENTS.LOAD_IMPORTED` subscriber, and the board's `makePublic` | `LoadImported` domain event |
| `load.booked` | board `book()` — a new `LoadBooked` domain event | booking writes `marketplaceStatus`/`bookedByTenantId` |
| `load.assigned` | `bus` → `EVENTS.LOAD_DISPATCHED` subscriber | `LoadDispatched`, already wired to the bell |
| `load.status_changed` | `bus` → `EVENTS.LOAD_STATUS_CHANGED` subscriber | `LoadStatusChanged`, already wired to the bell |
| `stop.arrived` / `stop.departed` | **the milestone sweep** (below) | `milestonesFor()` in `tracking.policy.ts` |
| `load.delivered` | `load.status_changed` with `toStatus === 'DELIVERED'`, emitted as its own type so a broker does not filter strings | — |

The four `load.*` events ride subscribers that already exist: `subscribeWorkers`
in `app.ts` already subscribes to `LOAD_DISPATCHED` and `LOAD_STATUS_CHANGED` to
ring the bell and send push. The webhook enqueue is one more line in each of
those handlers. **Critically, the handler only writes a row** — see Part 6 —
because `EventBus.publish` awaits every subscriber, so anything slow here is
slow in the dispatcher's request.

### The milestone sweep is where the tracking docstring said it would be

`tracking.policy.ts` ends its header with a promise:

> When outbound status webhooks arrive (GAP_ANALYSIS 2.1) this same function
> decides what to send, on a sweep instead of at ingest.

So that is exactly what happens. A one-minute sweep (`withAdvisoryLock`, beside
the four in `startSchedule`) walks the loads that are in transit right now — a
bounded query: `status = 'IN_TRANSIT'` plus anything assigned whose window
overlaps today, capped at a few hundred — and for each one recomputes
`milestonesFor(stops, fixes)`, exactly as the tracker page does. Any stop whose
`arrivedAt` or `departedAt` is now set and has not been delivered becomes an
event.

Two consequences worth naming:

- **The truck does not have to be online for this to be correct.** A unit that
  lost signal in Ontario and backfilled six hours of points produces the same
  milestones — the milestones *are* the trail — so the webhook for the arrival at
  the pickup goes out when the sweep next runs, with the arrival's real timestamp
  in the payload, not the time we noticed. A broker sees "arrived 08:14", not
  "arrived whenever the truck reconnected". That is the whole reason for deriving
  rather than eventing at ingest.
- **Tuning the fence radius is a re-answer, not a migration.** If 750 m proves too
  tight for a congested yard, raising it makes history correct on the next read.
  Delivered rows already sent are a record of what we said, which is what an
  audit needs; nothing is rewritten.

---

## Part 5 — Idempotency without an event table

The obvious design is a `DomainEventOutbox` table: write an event row, deliver
it, mark it sent. That is a second copy of a truth the milestones already hold,
and it is the copy that goes stale the first time the fence radius changes.

Instead, the **delivery record is the ledger, and its uniqueness is the derived
fact**:

```prisma
model WebhookDelivery {
  id            String    @id @default(uuid())
  tenantId      String
  endpointId    String
  /// Type the consumer dispatches on: load.status_changed, stop.arrived, ...
  eventType     String
  /// The derived fact this delivery represents:
  ///   "load:{id}:status:IN_TRANSIT"  "stop:{stopId}:ARRIVED"
  /// Unique per endpoint, which is what makes the sweep re-runnable.
  dedupeKey     String
  loadId        String?
  payload       Json
  state         String    @default("PENDING") // PENDING | DELIVERED | FAILED | DEAD
  attempts      Int       @default(0)
  nextAttemptAt DateTime  @default(now())
  /// Set while a worker holds the row, so two sweeps cannot both send it.
  claimedAt     DateTime?
  lastStatusCode Int?
  lastError     String?
  /// Truncated to 2 KB: enough to debug, not a place for a third party's HTML.
  lastResponse  String?
  deliveredAt   DateTime?
  createdAt     DateTime  @default(now())

  endpoint WebhookEndpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)
  load     Load?           @relation(fields: [loadId], references: [id], onDelete: SetNull)

  @@unique([endpointId, dedupeKey])
  @@index([state, nextAttemptAt])
  @@index([tenantId, createdAt])
  @@index([loadId, createdAt])
}
```

The enqueue is an `upsert` on `(endpointId, dedupeKey)` that does nothing when
the row exists. That single constraint buys, with no extra machinery:

- **Sweep re-runs are free.** Restart the server, re-derive the same milestones,
  and every already-delivered fact hits the unique constraint and stops.
- **Duplicates from a retry whose response never arrived** are not created,
  because the second attempt updates the same row rather than inserting one.
- **A gap (`PENDING` sweeps that overlap) cannot double-send**, because the row
  is claimed (Part 6) before it is sent.

And the honest cost: an event that is *wrong* is not deleted, it is superseded.
A `stop.arrived` already delivered is not un-sent if the fence radius later
changes; the broker got a fact with a timestamp, and facts with timestamps do not
retract. What we owe the consumer is the ordering guidance in Part 8.

`dedupeKey` is what keeps the sweep honest about *what it noticed*: it is built
from the load id and the milestone, never from a timestamp or an attempt count,
so recomputing it is always the same string.

---

## Part 6 — Delivery: enqueue in the request, send on a sweep

```
request path                     sweep (every 30 s)              the broker
-----------                      ------------------              ----------
bus subscriber                   claim: UPDATE ... SET
  upsert WebhookDelivery    →      claimedAt = now()
  (PENDING, nextAttempt=now)       WHERE state='PENDING'
        (a few ms)                AND nextAttemptAt <= now()
                                  AND (claimedAt IS NULL OR claimedAt < now()-5min)
                                        ↓
                                        ↓
                                  POST payload, 10 s timeout
                                    2xx  → DELIVERED
                                    4xx  → DEAD   (429/408 → retry)
                                    5xx/timeout/network → attempts++,
                                                    nextAttemptAt = backoff
                                  ≥20 consecutive failures → endpoint.active=false,
                                                    disabledReason, bell + email
```

Decisions, each of which a future reader will otherwise be tempted to undo:

- **The sweep, not the request.** `EventBus.publish` awaits its subscribers, so an
  HTTP call to a third party inside a subscriber puts a broker's slow endpoint in
  the path of a dispatcher's "Mark delivered". Writing one row is a few
  milliseconds; the send is someone else's problem, on our clock.
- **Claim by UPDATE, not by `SELECT ... FOR UPDATE SKIP LOCKED` alone.** The
  advisory lock already prevents two *instances* from sweeping at once, but it
  does not survive a delivery that overruns the interval, so the row-level claim
  is the inner guard. `claimedAt` older than 5 minutes is reclaimable, which is
  how a crashed worker's work returns to the queue without a human.
- **A 4xx is permanent, a 5xx is not.** A broker's endpoint answering 400 will
  answer 400 again in six hours; retrying it is noise in their logs and consumes
  our budget. `429` and `408` are the two 4xx answers that mean "later", so they
  retry.
- **Retry schedule**: attempts 1..8 at +30 s, +2 m, +10 m, +1 h, +6 h, +24 h,
  +24 h, +24 h, each multiplied by a jitter of 0.8–1.2 so a hundred endpoints
  that came back with the same outage do not retry in lockstep. Total window is
  about four days, which is longer than any real broker outage and short enough
  that a dead endpoint stops costing us anything within a week.
- **Twenty consecutive failures disables the endpoint**, with a bell notification
  and an email to the tenant's ADMIN, and `disabledReason` set to the last status
  code. Silently hammering a URL for four days is how a product earns a
  spam-blocklisting; disabling without telling anyone is how a broker silently
  loses their integration. Both, or neither.
- **Deliveries are readable by the tenant** (`GET /api/webhooks/deliveries`,
  filterable by endpoint, state and load) and replayable individually
  (`POST /api/webhooks/deliveries/:id/replay` resets it to `PENDING` with
  `attempts` capped at the limit, so a manual replay cannot be blocked by the
  automatic one having given up).
- **Retention 90 days.** Delivery rows are the audit trail for a dispute, and 90
  days is the window in which a broker actually disputes one.

### Endpoint model

```prisma
model WebhookEndpoint {
  id             String    @id @default(uuid())
  tenantId       String
  url            String
  /// CSV of subscribed types, or "*". Empty means nothing is sent — an endpoint
  /// with no subscription is a mistake, refused at the API rather than in the DB.
  eventTypes     String
  description    String?
  active         Boolean   @default(true)
  disabledReason String?
  /// Signing material. `secret` signs; `secretPrev` only verifies, which is what
  /// makes rotation possible without dropping a delivery mid-flight.
  secret         String
  secretPrev     String?
  secretRotatedAt DateTime?
  failureCount   Int       @default(0)
  lastSuccessAt  DateTime?
  lastFailureAt  DateTime?
  createdByUserId String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  deliveries WebhookDelivery[]

  @@index([tenantId, active])
}
```

---

## Part 7 — Signing, and exactly what a broker does to verify

Headers on every delivery:

```
Content-Type: application/json
X-Loadwave-Event:      stop.arrived
X-Loadwave-Delivery:   0f9c1e2a-...        (stable across retries of one fact)
X-Loadwave-Attempt:    1
X-Loadwave-Signature:  t=1760000000,v1=5f2b...9d
```

The signature is `HMAC-SHA256(secret, "<t>.<raw body>")`, hex, over the exact
bytes sent. Header format (`t=`, `v1=`) deliberately mirrors Stripe's, because it
is the scheme a broker's developer has already seen and will verify correctly
without reading our docs twice.

Why a timestamp inside the signed material rather than a header beside it: without
it, the signature proves the body came from us but not *when*, so a captured
request is valid forever. With it, a replay window is enforceable. Five minutes
of clock skew is tolerated — more than any NTP-synced host needs, less than the
time it takes an attacker to notice a captured delivery.

Why the raw body and not a re-serialised object: JSON key order and float
formatting are not stable, so a verifier that re-encodes and then compares will
fail on payloads that are perfectly valid. Our docs tell the broker to verify
before parsing, and our own tests verify a payload whose keys are in an
inconvenient order.

```js
// Node — what the docs hand the broker
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const a = Buffer.from(parts.v1 ?? '', 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
```

**Rotation** is `POST /api/webhooks/endpoints/:id/rotate`, which moves `secret`
to `secretPrev`, generates a new one, and returns it once. Deliveries sign with
the new secret immediately; verification accepts both for a stated overlap (the
endpoint keeps `secretPrev` until the tenant clears it with
`DELETE /api/webhooks/endpoints/:id/rotate`). Without that overlap, rotation is a
maintenance window, and nobody rotates under pressure.

The secret is not hashed, because signing requires the plaintext. That is a real
weakening relative to the API key and it is why the secret is scoped to one
endpoint and one purpose: a leaked signing secret lets somebody forge a status
webhook to one broker, not read anything. It gets the same treatment as the
existing SMTP password in `TenantSetting` (written by the service layer, never
returned by a read endpoint) and a note in Part 12 about what a database dump
would expose.

---

## Part 8 — The payload: an allow-list, and the ordering caveat

```json
{
  "id": "0f9c1e2a-2b3c-4d5e-8f90-1a2b3c4d5e6f",
  "type": "stop.arrived",
  "created": "2026-10-08T14:32:11.402Z",
  "occurredAt": "2026-10-08T08:14:00.000Z",
  "apiVersion": "v1",
  "data": {
    "loadId": "9d1c...",
    "reference": "LW-1042",
    "status": { "code": "IN_TRANSIT", "label": "In transit" },
    "lane": "Toronto, ON to Montreal, QC",
    "stop": {
      "place": "Montreal, QC",
      "kind": "DELIVERY",
      "stopOrder": 2,
      "scheduledAt": "2026-10-08T08:00:00.000Z",
      "arrivedAt": "2026-10-08T08:14:00.000Z",
      "departedAt": null,
      "dwellMinutes": null,
      "lateMinutes": 14
    },
    "headline": "On site at Montreal, QC since 08:14Z"
  }
}
```

Notes that are decisions rather than formatting:

- **`occurredAt` is when the fact happened; `created` is when we queued it.**
  They differ by hours when a unit backfills, and both are printed because a
  broker computing dwell time needs the first and a broker debugging delivery
  needs the second.
- **`headline` is carried verbatim** from `trackingProgress()`, so the sentence
  a human reads on the public page and the sentence a TMS shows in a notification
  are the same sentence. Two prose generators for one fact is how they start
  disagreeing.
- **No `position` by default.** The tracking link shows a position rounded to
  ~110 m because it is opened deliberately; a webhook body is stored in a third
  party's database forever. A broker that wants positions subscribes to a
  `position` field on `me`/endpoint config and gets the same rounded projection,
  with the choice visible in the UI.
- **No rates, no customer names, no driver names, no documents.** Same
  allow-list discipline as `PublicTrackingView`, asserted by a test that locks
  the exact key set — that test exists for the public page and its counterpart
  belongs here.
- **Ordering is not guaranteed.** Delivery is at-least-once and the sweep is the
  producer, so two facts derived in the same pass can arrive in either order, and
  a retry can land after a later fact. The docs tell consumers to sort by
  `occurredAt` and to treat `data.status.code` as monotone
  (`BOOKED < IN_TRANSIT < DELIVERED`), and to key their own dedupe on `id`.
  Telling them is not optional; a broker who assumes ordering files a bug against
  us the first time a retry reorders.

---

## Part 9 — The URL a third party chooses (SSRF, in one place)

A webhook URL is attacker-controlled text that our server fetches. That is the
most dangerous single input in this design, and the guard is a policy function
with its own tests:

1. **HTTPS only.** `http://` is refused outright in production; in development
   `http://localhost` and `http://127.0.0.1` are allowed so a broker can test
   against their own laptop. The rule is on the stored value and re-checked at
   send time.
2. **The hostname must resolve to a public address.** Resolve, then reject
   loopback, RFC1918, CGNAT (100.64/10), link-local (169.254/16 — the cloud
   metadata address), multicast, and the IPv6 equivalents. Re-resolve on each
   attempt rather than pinning a resolved IP at save time, because a hostname
   that resolved public yesterday can resolve to `169.254.169.254` today. Pin the
   connection to the resolved address for the attempt.
3. **No redirects followed.** A 301 is a failure, not a hop: redirects are the
   classic way to defeat a resolved-address check.
4. **Ten-second timeout** via `AbortSignal.timeout(10_000)`, and the response body
   is read with a 2 KB cap (we keep at most that in `lastResponse`).
5. **`fetch` is injected**, not global, in the sender's constructor — matching
   `fmcsa.client.ts`, which already does `doFetch(url, ...)` so its tests can
   substitute one. Every delivery test here is a test against a fake fetch: no
   test in this module may touch the network.

Refusing a URL is a 400 with a message that says which rule it broke, because a
broker whose URL was refused needs to know whether to fix their host or their
scheme.

---

## Part 10 — Endpoints, in full

Tenant-facing (session auth, `ADMIN` for issuing; `ADMIN`/`DISPATCHER` for
reading the delivery log):

```
POST   /api/api-keys                      → { id, prefix, secret, scopes, ... }  (secret shown once)
GET    /api/api-keys                      → keys with prefix, scopes, lastUsedAt, partner name
DELETE /api/api-keys/:id                  → revoke (sets revokedAt; effective on the next request)
POST   /api/api-keys/:id/rotate           → new secret, same scopes, shown once

POST   /api/webhooks/endpoints            → create; returns the signing secret once
GET    /api/webhooks/endpoints
PATCH  /api/webhooks/endpoints/:id        → url, eventTypes, description, active
DELETE /api/webhooks/endpoints/:id
POST   /api/webhooks/endpoints/:id/rotate → new signing secret, previous still verifies
DELETE /api/webhooks/endpoints/:id/rotate → stop accepting the previous secret
POST   /api/webhooks/endpoints/:id/test   → sends a synthetic event; the single most
                                            valuable button on this whole surface
GET    /api/webhooks/deliveries?endpointId=&state=&loadId=&limit=&cursor=
POST   /api/webhooks/deliveries/:id/replay
```

`POST .../test` earns its place: integration day is otherwise a broker waiting
for a real load to move while staring at an empty log. It sends a
`webhook.test` event through the real path (same signing, same retry, same
delivery row), which proves the URL, the TLS chain, the signature and the retry
machinery in one click.

Partner-facing (API key auth, `/api/v1/*`): the four reads in Part 1, each
carrying `config: { rateLimit: { max: 600, timeWindow: '1 minute', keyGenerator:
(req) => req.api.keyId } }`.

The per-key limit matters: `@fastify/rate-limit` is registered globally at
200/min by IP, and a broker's TMS calls from one NAT — so without a per-key
generator, a broker polling every five seconds eats the shared limit and takes
down their own integration along with any other tenant behind the same address.
600/min is twenty times what a compliant poller needs, which makes it a
backstop rather than a constraint.

**The plan gate belongs at issue time, not at call time.** A `SOLO` tenant
cannot mint an API key (checked with the existing `billing`/`Feature` machinery),
but nothing re-checks the plan on each `/api/v1` call. If the gate were at call
time, a tenant downgrading would silently break a live integration that a broker
depends on — and we would rather refuse to create a credential than kill one that
is running in someone else's system. The corollary is stated in the UI: revoke
the key when you downgrade.

---

## Part 11 — Tests, and what each one is actually protecting

Pure policy (fast, no database — the shape this repo already prefers):

- `api.policy.ts`: `mayReadLoad` for first-party, partner-as-poster,
  partner-as-booking-carrier, unrelated tenant, no-`loads:read` scope. Plus
  `parseScopes` refusing an unknown scope, and `requiredScope(route)` mapping.
- `key.policy.ts`: key format parsing, prefix extraction, `sha256` comparison,
  and the degenerate cases (no key, wrong length, `lw_` only, unicode).
- `signature.policy.ts`: exact HMAC for a fixture body, tolerance boundary at
  300 s, a body whose key order was changed after signing, `secretPrev`
  acceptance, hex-vs-base64 mismatch.
- `webhook.policy.ts`: retry classification (200/204 → delivered; 400/403/404 →
  dead; 429/408/500/502 → retry), backoff sequence with jitter bounded, the
  20-consecutive-failure disable rule, and `dedupeKey` derivation for each event
  type — including that the same milestone yields the same key on a re-derive.
- `url.policy.ts`: the SSRF table — public OK; `http://` in production refused;
  `https://169.254.169.254/...`, `https://10.0.0.5/`, `https://[::1]/`,
  `https://user@host/`, and a hostname that resolves private all refused.

Integration (`buildApp` with an injected fake `fetch`, following
`tests/integration/*`):

- A key minted, used, revoked: 201 → 200 → 401, with the 401 arriving on the
  very next request after revoke.
- A partner key gets 404 for a load its tenant is not party to, and 200 for one
  where it is the booking carrier — the binding tested from the outside.
- A key without `tracking:read` gets 403 with `missing_scope`, and the same key
  with it gets 200.
- `POST .../test` writes one delivery row and the fake fetch sees a request whose
  signature verifies against the endpoint secret.
- A 500 from the fake fetch leaves the row `PENDING` with `attempts=1` and a
  future `nextAttemptAt`; a 400 leaves it `DEAD` with `attempts=1`; a 429
  retries.
- Two sweeps over the same milestone produce exactly one delivery row and one
  HTTP call (the dedupe constraint, asserted through the fake fetch's call count).
- The milestone sweep produces `stop.arrived` for a load whose trail arrives
  *out of order* and hours late, with `occurredAt` equal to the fix's time and not
  the sweep's.
- A payload-key-set assertion that locks the exact JSON keys of each event type:
  the test that makes "no rates in the payload" a property rather than a promise.
- Disabling after the failure threshold, including the bell row.

---

## Part 12 — Operations: what an operator sees, what a broker sees

- **Diagnostics** (`src/modules/diagnostics/diagnostics.routes.ts`, already
  admin-key guarded) gains counts only, never values: `{ apiKeys: { active,
  revoked }, webhooks: { endpoints, active, deliveriesPending, deliveriesFailed24h,
  endpointsDisabled } }`. An operator's first question in an integration incident
  is "is anything queued", and that answer should not require database access.
- **Logging**: every send attempt logs `tenantId`, `endpointId`, `deliveryId`,
  `eventType`, `attempt`, `statusCode`, `durationMs`. The signature, the secret
  and the API key are never logged; `lastError` stores the failure class and
  status, not the broker's body. A webhook URL can legitimately contain a token
  in a query string, so the log prints `url` with the query string stripped.
- **`lastUsedAt` is throttled to once a minute per key.** Otherwise a 600 rpm
  integration writes a row on every call to report that it is in use, which is
  exactly the kind of write-amplification that shows up as a mystery in
  production.
- **A database dump exposes signing secrets but not API keys.** Stated plainly
  because it should drive decisions: if this product ever handles something where
  that is not acceptable, `WebhookEndpoint.secret` needs envelope encryption with
  a key held outside the database (the same machinery the SMTP password will
  eventually need). Until then, the mitigation is that the secret is scoped to
  one endpoint and can only produce a webhook a broker could have received
  anyway.

---

## Part 13 — Build order

Five slices, each independently shippable and testable, in an order where
nothing later invalidates anything earlier.

| # | Slice | Effort | Ends with |
|---|---|---|---|
| 1 | Migration + `ApiKey` model + mint/list/revoke + `apiKeyAuth` + `GET /api/v1/me` | M | A key that authenticates and can do nothing else |
| 2 | The read surface: `mayReadLoad`, `GET /api/v1/loads`, `.../tracking`, cursor + `updatedSince` | M | A broker's TMS can poll. **This is already useful with no webhooks at all** |
| 3 | `WebhookEndpoint` + `WebhookDelivery` + enqueue from the two existing bus subscribers + the delivery sweep + signing + test-send | L | Status webhooks end to end |
| 4 | The milestone sweep (`stop.arrived` / `stop.departed`) + the disable-with-notification rule + the tenant delivery log and replay | M | The event a broker actually wants, and the tools to debug it |
| 5 | Diagnostics, docs page for brokers (signature samples in Node and Python, event catalogue, retry table), and the ADR note in GAP_ANALYSIS | S | Handed to a real integration |

Slices 1–2 are useful alone, which is the point of the order: the cheapest path
to "a broker's TMS can see freight" does not require the queue, the signer or the
retry policy.

Two things to be careful about while building, both learned from this week's
work:

- The `listPublic`-style trap: the milestone sweep must select the loads it needs
  and nothing more (an indexed `status`/window query with a cap), because a sweep
  that fans out over every load is one that shows up as a production incident
  when a tenant posts 500 loads.
- The `perMile()` trap: this is a payload with money-shaped fields *next to* the
  ones we send. The payload test that locks the key set is the guard, and it must
  run on every event type, not just the status one.

---

## Part 14 — What this does not include

- **Inbound tenders (2.1).** The key model is built for it: `tenders:write` is
  already a reserved scope, and the counterparty binding is what makes it safe
  for a broker to POST us a load. `POST /api/v1/tenders` (idempotent on a broker
  reference, answering with our load id) is the next document, and it needs an
  `ExternalTender` log — who sent what, what we answered — because the day a
  broker disputes a tender, the log is the defence.
- **EDI 214 / 990 / 997.** Ride on the same internal shape once tenders exist.
  Do not model the API around X12 segments.
- **A broker-facing UI.** The scorecard page they log into is a different product
  decision than the API they integrate with.
- **mTLS, IP allow-lists, per-event payload filtering, and delivery to a queue
  the broker owns.** All reasonable; none of them is what is blocking the first
  integration.
- **Metering.** Usage-per-key counts are obviously billable, and the delivery and
  request logs already hold them; the billing decision is not this document's.
