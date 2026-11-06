# Customer reservation access

A client creates a reservation through the customer booking route and receives a
random 256-bit bearer credential once. Possession authenticates the holder for
that reservation alone. PostgreSQL stores its SHA-256 digest. Hold creation and
credential issuance commit together. Existing reservations keep their original
booking/admin behavior. New customer bookings use the routes below.

## Client contract

Use HTTPS and keep the token in the Authorization header. Customer responses
set `Cache-Control: no-store`. Production requires a secure request as recognized
by Express. Development also permits loopback HTTP. For a TLS-terminating proxy,
configure trusted proxy addresses explicitly before enabling this feature. An
untrusted forwarded header must never be sufficient to assert HTTPS or peer IP.

All paths below are relative to `/v1/customer/reservations`.

| Method and path | Purpose and response |
| --- | --- |
| `POST /hold` | Accepts `lockerId`, `startTime` and `endTime`. Returns 201 with `reservationId`, hold `expiresAt`, and one-time `accessToken`. |
| `POST /:id/payment-intent` | Authenticates the holder and returns `clientSecret`, CAD `amount` in cents and `currency` for Stripe checkout. |
| `GET /:id/access` | Returns `available`. When access is blocked, returns `RESERVATION_INELIGIBLE`, `LOCKER_UNAVAILABLE`, or `COOLDOWN` with `retryAt`. This snapshot may change. |
| `POST /:id/unlock-requests` | Requires `Idempotency-Key` (UUID v4) and an empty body. Returns 202 with `commandId`, `expiresAt` and current `status`. |
| `GET /:id/unlock-requests/:commandId` | Reads that command's status under the same reservation credential. |
| `GET /:id/unlock-requests` | Looks up a request by the `Idempotency-Key` header after a lost response. This read never enqueues a command. |

Example hold body, using a time range selected from availability:

```json
{"lockerId":"<locker-id>","startTime":"2026-12-01T15:00:00Z","endTime":"2026-12-01T16:00:00Z"}
```

Example request after payment and one explicit user tap:

```http
POST /v1/customer/reservations/<reservation-id>/unlock-requests
Authorization: Bearer <reservation-credential>
Idempotency-Key: 65a8ecda-d13e-4879-98cf-54431efdc86c
```

A typical accepted response is `{"commandId":"<id>","expiresAt":"<timestamp>","status":"PENDING"}`.
Requests address the reservation. The server resolves the active locker and its
assigned device and chooses the pulse duration. Extra unlock parameters are rejected.

## Payment and access rules

- The server binds the Stripe intent to the credential-bearing reservation before
  releasing its client secret. Legacy payment routes cannot return that secret
  for a customer booking. A signing-verified success event must match the bound
  intent, reservation metadata, succeeded status, CAD currency, expected amount
  and amount received. Confirmation and payment proof commit atomically.
- The payment webhook uses PR #6's event deduplication. A success before binding
  rolls back and returns 503 so Stripe can retry. Refund/dispute events persist
  the reversed intent ID even when they arrive first. A reversal permanently
  disqualifies that grant. Partial refunds are treated conservatively. A success
  arriving after the hold deadline cannot grant access to an expired hold.
- Request eligibility requires the authenticated reservation, `CONFIRMED`,
  recorded payment proof without revocation, and `startTime <= now < endTime`.
  Manual confirmation alone cannot grant access. An admin confirmation racing
  with a valid signed success during the hold period can still receive payment proof.
- Configure `CUSTOMER_UNLOCK_PULSE_MS` to a validated integer duration. Empty
  disables customer pulses. The server and device limits must also permit it.
  The firmware ceiling remains 5000 ms. A command expires at the earlier of its
  existing ten-second TTL or the reservation end minus the pulse duration. The
  API refuses a pulse when insufficient time remains.
- Customer and admin requests share one device lock and command table. The device
  must be enabled, armed, mapped to an active locker, recently online with a
  CLOSED contact, and report an inactive output. Existing cooldown rules apply.
  An unresolved command for the locker blocks another customer pulse, including
  after device replacement.
- Same reservation and same key return the original command. Concurrent distinct
  keys still pass through the shared device gate. The database enforces uniqueness.
  Changing keys is appropriate only for a new intentional action.
- Polling rechecks the command, owner reservation, access window, payment proof,
  locker mapping and device safety before returning the existing ESP32 command
  envelope. Cancellation or revocation already visible at this check suppresses
  delivery. Once a response is in flight, the server cannot recall it. The device
  still enforces local expiry, pulse limits and replay protection.
- Credentials permit read-only command history for 24 hours after the reservation
  ends. Unknown resources, another holder's resource and expired history return
  the same 404. Missing or malformed bearer credentials return 401. An ineligible
  owner receives 403. A busy, unresolved or cooling device returns 409. Cooldown
  responses include `retryAt`.

## Customer experience and recovery

The current web app has public booking and admin screens. A future customer
reservation page or mobile app should use customer booking from the start, retain
the credential in OS secure storage (or a server-managed web session), and use
Stripe's client secret to complete checkout. Keep both secrets out of URLs, logs,
analytics and browser local storage.

Show the unlock button only when the readiness endpoint reports availability.
Disable it while sending and retain the UUID for that tap. Show a countdown for
cooldown and refresh readiness when the countdown ends. On a lost POST response,
look up the key using GET. A 404 means the server has no recorded command for
that key at the time of the read. Leave the decision to make another request to
the user. Never send a pulse automatically after reconnecting.

| Customer status | Meaning |
| --- | --- |
| `PENDING` | The server accepted the command and awaits a device result. It may already have been polled. |
| `OUTPUT_PULSE_COMPLETED` | The device reports the electrical pulse finished. The physical latch position is unverified. |
| `REJECTED` or `FAILED` | The device reported that result. Present the result without guessing latch position. |
| `OUTCOME_UNKNOWN` | Execution is uncertain. Keep polling status for a possible late result and offer operator assistance. |

## Operations and integration

Redis atomically limits 120 customer requests per peer IP per minute, 10 hold
issuances per peer per ten minutes, and 8 unlock attempts per authenticated
reservation per minute. Rate-limit responses use 429 with a conservative retry
delay. If Redis cannot enforce limits, the API returns 503. Accepted commands
persist reservation, requester, reason, request key, expiry and result. Logs
record accepted/replayed command IDs and denied decisions without bearer tokens.

Apply migrations, configure trusted HTTPS and Stripe webhook subscriptions, validate
the physical pulse duration, and test under supervision before enabling customer
pulses. The proof depends on verified Stripe events arriving at this API. Set up
webhook delivery monitoring and reconciliation, operator escalation for uncertain
commands, credential loss/revocation and retention policies before unattended use.
This first version authenticates possession of one booking credential. Account
identity, credential recovery and a customer UI are separate work.

The API CI job uses the reservation harness merged in PR #6: a loopback application,
disposable PostgreSQL/Redis, signed fixture webhooks, mocked Stripe intent creation
and a simulated ESP32. Run `sh scripts/test-reservation-e2e.sh` from the repository
root. Integration tests use no real unlock or payment.

The pending reliability branch extends heartbeat freshness, reboot recovery and
command reporting. When combining it, use its stricter freshness and locking in
the shared device service, retain owner checks at delivery and keep uncertain
commands blocked. OTA may extend the Prisma schema and device module. Combine
those additive changes with this migration and preserve the customer final delivery
gate. The customer feature uses the existing polling/result protocol and introduces
no firmware or OTA wire-format change.
