# Owned booking recovery and payment verification

## Contract and authority

PostgreSQL owns reservation state, the original `expiresAt`, creation idempotency, ownership hashes and payment bindings. Redis remains an availability cache. A recovery attempt never renews the ten-minute hold. Cached availability is advisory; the locker-row lock still serializes overlap checks and insertion.

The browser generates a cryptographically random 32-byte base64url bearer token and a UUID-v4 creation key **before** the first hold POST. It saves both with the exact booking terms. The API stores only SHA-256 of the token, matching `feat/customer-reservation-unlock`'s credential format. An ID, a Stripe return parameter, an admin's knowledge of an ID or a browser receipt alone does not authorize disclosure of payment credentials.

A recovery code is `LR1.<creation UUID>.<bearer token>`. Treat it as a private credential. It is never put in a URL or sent to Stripe. HTTPS is required outside loopback development; the guard does not trust client-supplied forwarded-protocol headers. Deploy the credential routes over the API's HTTPS listener or configure a deliberately trusted TLS termination path. Responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

## HTTP routes

All customer operations below require `Authorization: Bearer <token>`.

| Route | Additional input | Behavior |
| --- | --- | --- |
| `POST /public/reservations/hold` | `Idempotency-Key: <UUID v4>` and locker/start/end body | Atomically creates ownership and the hold. Same key, proof and terms return the existing booking, even after terminal state. Changed terms conflict; different proof does not disclose the booking. |
| `GET /public/reservations/recovery` | Same idempotency header | Finds the committed booking after its creation response was lost. Verifies ownership and reconciles any bound Stripe intent. |
| `GET /public/reservations/:id` | Owner proof | Current server state and payment state; no raw Stripe object, token hash or payment secret. |
| `POST /public/payments/create-intent` | `{ reservationId }` | Requires ownership and an unexpired payable hold. Creates once with `reservation:<id>` or retrieves the bound intent. Releases only the client secret of a currently payable intent. |
| `POST /public/reservations/:id/cancel` | Owner proof | Cancels using the existing lifecycle, revokes the grant and attempts provider reconciliation. |

The admin `/payments/create-intent` route additionally requires its existing admin JWT and the same ownership proof/HTTPS protections. The admin UI links to the private-receipt booking flow instead of attempting ID-only payment. Admin listing/manual confirmation/cancellation remain guarded administrative workflows; manual confirmation is not payment proof and does not set `paidAt`.

Missing or malformed credentials return 401. A correctly formatted wrong proof or unknown resource returns the same 404. No public ID-only status lookup is added. Body validation rejects extra creation fields. The hourly CAD pricing policy is unchanged and the expected amount/currency are persisted with the grant.

## Browser recovery

Owned receipts use a new, API-origin-scoped session-storage key. Old ID-only receipts cannot be upgraded into ownership credentials and are not used to disclose information.

Creation persists the proof and creation key before sending HTTP. If browser reads/writes are blocked, the UI provides a private backup code and requires acknowledgement that it was saved before creating a new hold. The draft's retry button cannot bypass this step. A backup can be imported after reload or in another tab; a missing proof cannot safely be recovered from the reservation ID.

On entry, focus, visibility return and periodic polling, the UI rechecks server state with the owner proof. It uses server time plus a monotonic elapsed timer, rather than the browser wall clock, for checkout gating. Older concurrent status responses cannot overwrite newer observations. Payment confirmation rechecks server eligibility; unverified/stale state hides payment controls.

Stripe redirects return to `/book?checkout=<creation UUID>`. The UUID is not authorization. The page removes redirect query parameters and uses only the previously saved/imported bearer proof to reconcile the outcome. The Stripe client secret is not persisted in browser storage. An error-free Stripe callback is not local payment confirmation: receipts remain until the server establishes the outcome. Processing and reconciliation-required receipts cannot be dismissed as settled. The UI supports unpaid, processing, confirmed, canceled and expired states; it explicitly warns against paying again when reconciliation is required.

## Payment binding and races

The Stripe intent ID is committed before its client secret is released. Concurrent creation retries share a provider idempotency key. A lost provider response can be retried with that same key; a fresh retrieve supplies current status instead of a cached create response.

Signed webhooks retain raw-body signature and timestamp verification. Before granting payment proof, the server validates all of:

- the stored PaymentIntent ID;
- its reservation metadata association;
- stored expected amount and currency;
- succeeded status and exact `amount_received`.

Event deduplication, payment proof and reservation confirmation commit together. An event that reaches an owned booking before binding is complete is retried, not consumed. Invalid/mismatched proof cannot confirm a reservation. A delayed failure cannot erase established payment proof. Refund/dispute events revoke the grant, including reversals observed before intent binding.

Confirmation, cancellation and payment observation serialize using the reservation row; intent binding/reversal also share an intent advisory lock. A canceled or expired hold never becomes confirmed again. Success after the original deadline or cancellation is durably marked `RECONCILIATION_REQUIRED`, without granting `paidAt` for access. Cancellation after an established payment is also flagged for review.

Every five seconds, a bounded in-process sweep reconciles processing payments and known intents attached to canceled/expired/revoked holds. Oldest checked records are processed first to avoid starvation. Retrievable unpaid intents are canceled idempotently. Failed/unavailable cancellation remains pending and is retried; cancellation is not inferred from a timeout. No queue or new external infrastructure is introduced.

`CustomerReservationAccess.reconciliationReason` and `PaymentEvent`'s outcome/intent/reservation fields provide an operator audit trail without storing raw webhook payloads or client secrets. Late successful payments require manual reconciliation/refund decisions; this branch does not initiate automatic refunds or charges.

## Migration and legacy bookings

Apply `20261113000000_booking_recovery`, regenerate Prisma, and deploy API and web together. Fresh and main-schema upgrade paths are tested. The migration does not change existing reservation deadlines, credentials, device diagnostics or device commands.

Existing bookings without a provable grant remain unowned. Never mint a credential from an old ID-only browser receipt or grant access merely because an admin can see the ID. A signed legacy success is recorded as `UNBOUND_LEGACY_PAYMENT` for operator investigation, without confirming the reservation. Previously issued unbound Stripe intents require an operator audit; their IDs cannot be safely reconstructed from browser hints. Existing unpaid holds expire at their original deadline.

## Customer-unlock integration

The base grant names (`reservationId`, `tokenHash`, `paymentIntentId`, `paidAt`, `revokedAt`), 43-character token format and SHA-256 digest agree with `feat/customer-reservation-unlock`. `createHold(dto, hash)` and `createPaymentIntent(id, hash)` remain compatible service entry points; booking adds a creation key and payment-state fields. Only verified payment can set `paidAt`, and revocation is retained across delayed events.

This does not merge or modify the customer-unlock branch, create its physical-access routes or change the device command protocol. A later integration must consolidate the two branches' grant-creation migrations, merge the access-policy helper exports, preserve booking recovery endpoints and retain this stricter payment verification/reconciliation logic. Existing customer-unlock tests that create grants directly will need the stored expected amount and new mock retrieve/cancel fixtures. These are explicit integration tasks, not an automatic clean-merge guarantee.

## Verification

Use `npm run test:reservation -- --ci` with the documented disposable database/Redis opt-in. It includes ownership, lost responses, concurrent retries, mismatched money/intent proof, processing, early reversals and cancellation/expiry races. The SDK's signature parser and real PostgreSQL locks/transactions are exercised; outbound Stripe create/retrieve/cancel calls are mocked and non-loopback HTTP is blocked.

`npm run test:web` covers recovery after refresh/navigation/lost responses, blocked storage and backup import, wrong client clocks, terminal states, processing/redirect returns, thrown provider errors, malformed cached data and delayed older responses. Stripe.js and all off-origin API calls are intercepted. Existing dashboard/device browser tests remain intact.

No live/test-mode charge is initiated by these tests. Real Stripe test-mode end-to-end acceptance and independent hosted CI remain pre-deployment checks. No firmware, OTA or physical hardware is changed.
