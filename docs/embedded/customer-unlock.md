# Customer digital keys and reservation access

## One booking, one ownership credential

Use the existing `/book` flow and `/public/reservations/hold`, `/public/reservations/recovery`, owned status/cancel routes, and `/public/payments/create-intent` contracts described in [booking recovery](../booking-recovery.md). There is no separate customer hold or payment endpoint. The browser persists a random bearer proof and creation UUID before creation; PostgreSQL stores its hash and the original ten-minute hold deadline. Recovery never extends that deadline. Reservation IDs, Stripe redirect parameters and administrator knowledge of an ID are not ownership proof.

Main's payment service is retained: signed webhooks and provider retrieval validate the stored intent ID, reservation association, expected amount/currency and exact amount received. Payment processing, reversals, revoked grants, canceled/expired holds and late-success reconciliation remain authoritative. Customer access requires CONFIRMED, a bound intent, paidAt, SUCCEEDED payment state, no revocation, and `startTime <= serverNow < endTime`. Manual confirmation alone cannot authorize access.

## Digital key

After server verification, a confirmed reservation shows its assigned locker/location, start/end times, payment status, current eligibility, explicit Unlock button, own request history and fresh door observations. The private receipt remains the key; it is not offered for deletion during an active paid reservation. Receipts with a recorded unlock request remain retained for outcome recovery. Import the existing private code on `/book` to recover the same booking and key; no account login is needed for this milestone.

Every explicit tap selects a separate UUID, persists it before POST and disables repeated submissions. If storage cannot persist it, the UI requires the user to save an extended private code and confirm that backup before sending. The compatible format is `LR1.<creation UUID>.<bearer token>.UK.<unlock UUID>`; base booking codes still work. Codes are credentials, never URLs, device credentials or Stripe client secrets. Keep them private. Losing all copies cannot be repaired using a reservation ID.

Refresh, navigation, focus, reconnection and periodic recovery use GET only. A lost POST response is recovered by the saved UUID and owner-scoped recent command history. A 404 lookup never automatically issues another POST; an explicit subsequent tap reuses an unrecorded saved key. A known completed request permits a new intentional tap only when the current server gate allows it. Uncertain outcomes require support and are not inferred successful.

The browser never treats cached paid details as current access authorization. Readiness and authoritative server checks control requests. Failure disables the action and hides stale door state as UNKNOWN. Server timestamps govern eligibility; client clock changes cannot authorize access.

## Customer access endpoints

All paths are relative to `/v1/customer/reservations` and require the existing `Authorization: Bearer <reservation credential>`. HTTPS is mandatory outside loopback development, with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Do not trust arbitrary forwarded headers to establish HTTPS or client identity.

| Method/path | Behavior |
| --- | --- |
| `GET /:id/access` | Current availability/code, server time, payment state, up to ten own commands and an allowlisted door state/sample timestamp/freshness within an eligible reservation. No private diagnostics or operator evidence. |
| `POST /:id/unlock-requests` | UUID-v4 `Idempotency-Key`, empty JSON body. Creates or returns the same command; server resolves device and duration. |
| `GET /:id/unlock-requests` | Lookup using the same UUID header after a lost response; never creates a command. |
| `GET /:id/unlock-requests/:commandId` | Reads only a command associated with the authenticated reservation. |

History is readable for 24 hours after reservation end. Wrong credentials/resources return the same 404; malformed or missing credentials return 401. Ineligible access returns 403; device safety/conflict returns 409; cooldown includes retryAt. Extra unlock parameters are rejected. Customer responses never expose device tokens, boot diagnostics, administrator identities/reasons/evidence or raw Stripe objects.

Redis rate limits customer routes and unlock attempts, failing closed with 503 if limits cannot be enforced. Redis does not determine ownership, payment state, holds, command idempotency or history; those remain in PostgreSQL. Observe 429/retry delays without automatically resubmitting unlocks.

## Shared device safety and command progress

Customer and administrator requests share main's device policy and locks. Keep all-history unresolved/unacknowledged blockers, accepted heartbeat after operator review, CLOSED-only freshness, boot-session ordering, enabled/armed device, active locker, inactive output, server/device limits and existing cooldown unchanged. Customer access additionally considers unresolved history for the assigned locker across device replacement. Acknowledgement is an operator action; customers cannot perform it. See [audited reconciliation](command-reconciliation.md).

`CUSTOMER_UNLOCK_PULSE_MS` is server-only and disabled when unset. Enabling/changing it requires independent operator validation; this implementation and its tests do not change real pulse settings. The command deadline is bounded by the existing ten-second TTL and reservation end minus pulse duration. Delivery rechecks payment eligibility, assigned locker, remaining window, configured duration, current device readiness and unresolved history. Cancellation, revocation, reassignment or expiry observed before delivery suppress it. A response already in flight cannot be recalled; local firmware still enforces expiry, replay protection and pulse bounds.

Lock ordering is reservation -> payment grant -> locker -> device for customer enqueue. Main's device-first order remains for delivery/results/reconciliation. Delivery reads payment entitlement with MVCC rather than obtaining reservation row locks after a device lock. No provider network requests occur inside these command transactions. Main's firmware, expedited/fallback heartbeat scheduler, polling inhibition and no-networking-during-active-pulse behavior are unchanged.

| Display | Evidence |
| --- | --- |
| Request accepted | Command persisted, result awaited |
| Delivery attempted | Server prepared a device response; receipt is not proven |
| Pulse completion reported | Authenticated device reported output completion; latch position unverified |
| Door OPEN/CLOSED observed | Separate fresh door report and timestamp, not proof of command causation |
| Unknown command outcome | Expired without result or explicitly UNKNOWN; retain history and seek support |

Operator acknowledgement is exposed only as a boolean with an uncertainty explanation. It never rewrites the original outcome or implies pulse completion. Late reports and conflicting/duplicate results retain main's audited semantics.

## Migration and deployment

Integrates main through `0f65521`. Before consolidating migrations, a read-only check verified the experimental `20261106000000_customer_reservation_access` migration had not been applied to the local development database. Its duplicate grant table and payment-field additions are replaced by `20261116000000_customer_command_access`, which only adds nullable reservationId/requestKey, their pair constraint, the reservation foreign key and per-reservation unique request key to DeviceCommand. Main's six migrations, payment fields, device diagnostics and reconciliation records remain intact. Existing admin commands retain null customer association.

Apply via the normal approved deployment procedure, regenerate Prisma and deploy API/web together. If another experimental environment already applied the old customer migration, inspect and reconcile that migration history before deploying; do not silently rewrite applied migrations or reset data. This branch does not migrate the running application database.

## Future verified student accounts

This milestone authenticates ownership of a paid reservation credential, not student identity. A future verified uOttawa account can be linked using both authenticated account identity and current reservation ownership proof. Email-domain matching, payment receipt IDs or reservation IDs alone must not claim existing bookings. Account recovery, eligibility policy and credential rotation are separate work; do not build a second payment or device-command authorization path.

## Verification

Use disposable PostgreSQL/Redis, signed Stripe fixtures, mocked provider create/retrieve/cancel, and simulated devices only. The expanded customer integration suite covers canonical creation recovery, eligibility/time boundaries, payment processing/mismatches/reversals/late success, concurrent customer/admin requests and cancellation, historical acknowledgement, reboot/timestamp atomicity, delivery checks, private audit filtering, lost responses and late/duplicate/conflicting results. Browser tests cover paid key retention, persisted/backup-imported request UUIDs, navigation, response loss, connectivity/storage failures and independent progress/door states. Run existing booking, payment, device reliability, reconciliation and dashboard tests as well as firmware host/compile checks.

No real payment, credential change, firmware flash, physical activation, operator acknowledgement, push or deployment is performed by these tests. Hosted CI and a separately approved supervised acceptance test remain required before enabling real customer use.


Local verification (2026-11-15): 109 booking/payment/customer integration tests, 77 API unit/device/reconciliation tests, 2 HTTP smoke tests, 7 provisioning and 9 test-target safety checks passed. All 50 browser tests passed, including a complete mocked booking-to-key flow, storage backup/import, stale response ordering and preservation of the newest unlock UUID across an older booking refresh. API/web type checks and production builds and web lint passed. Firmware host protocol/controller/diagnostics/heartbeat tests and all four `esp32:esp32:esp32` example-configuration compilations passed without upload. Fresh seven-migration installation and an upgrade from main's six migrations passed; synthetic commands, operator acknowledgements, events, device health and payment proofs were preserved. Hosted CI, Safari acceptance and separately authorized Stripe test-mode/physical acceptance remain pre-deployment checks.
