# Reservation lifecycle E2E tests

This suite exercises the Nest HTTP routes, PostgreSQL persistence, Redis cache,
admin cookie authentication, Stripe raw-body signature verification, and device
poll/result protocol together. It runs without the web server, Stripe CLI,
account credentials, firmware uploads, or physical hardware.

## Run locally

Use Node 24, Docker with Compose v2, and the checked-in npm lockfile. From the
repository root:

```sh
npm ci --prefix services/api
sh scripts/test-reservation-e2e.sh
```

The helper starts **separate disposable** PostgreSQL 16 and Redis 7 containers,
waits for health, generates Prisma Client, applies migrations, runs the tests,
and removes its containers on success or failure. It does not use or stop
`infra/local`, the dashboard, or your development database. Failure output includes
the test-service logs. Ports 55440 and 56390 must be free. Run one local helper at
a time; a unique Compose project prevents a failed second run from stopping the
first run's containers.

The fixtures are deleted between cases and on normal suite teardown. PostgreSQL
uses tmpfs; Redis persistence is disabled. There are no persistent test volumes.
If the process is forcibly killed, remove only the orphaned
`locker-reservation-e2e-<pid>` Compose project, not your local development project.

To run against already-provisioned **disposable test services**, create a database
named `locker_reservation_e2e`, apply migrations, and use:

```sh
cd services/api
export NODE_ENV=test RESERVATION_E2E=1
export DATABASE_URL='postgresql://ci:ci@127.0.0.1:55440/locker_reservation_e2e?schema=public'
export REDIS_URL='redis://127.0.0.1:56390/15'
npx --no-install prisma migrate deploy
npm run test:reservation
```

The suite deliberately **deletes all fixture tables in that database**. Before
application startup, it requires the explicit opt-in, test mode, loopback hosts,
that exact database/public schema, and Redis database 15. It refuses normal local
or remote targets. The setup does not load `.env`; JWT, admin password, Stripe
values and device credentials are test fixtures. Outbound HTTP to non-loopback
hosts is blocked as an additional defense against an accidentally unmocked Stripe
call. The application listens on a loopback ephemeral port, never port 3001/3443.
An isolation lease refuses overlapping suites on the same Redis/database pair.

## What is real and what is simulated

- **Real:** AppModule, routes, guards, login cookie, Prisma transactions, database
  constraints, Redis reads/writes/invalidation, Stripe SDK webhook signature and
  timestamp checks, reservation handlers, device command handlers.
- **Mocked:** Only outbound `stripe.paymentIntents.create`. Its inputs and stable
  reservation idempotency key are asserted. No payment is sent to Stripe.
- **Simulated device:** A fixture token authenticates heartbeat, polling and result
  HTTP calls. Repeated delivery is the same command ID, not another activation.
  There is no separate delivery-ack endpoint on main; result posting acknowledges
  the simulated outcome.
- **Controlled time:** Jest replaces `Date`, while socket/event-loop timers remain
  real. Background reservation cron jobs are stopped in the test application.
  Tests advance time and explicitly invoke the actual expiration handler. The concurrent-hold regression holds the locker row until both requests are
  waiting in PostgreSQL, then releases it; a bounded database-state check replaces
  timing guesses. Tests
  do not sleep for ten minutes or wait for a cron tick. PostgreSQL timestamps and
  Redis TTL clocks remain real; cooldown tests use persisted issue/completion
  times, and expiration tests assert explicit cache invalidation.

Existing unit tests and `src/devices/devices.integration.spec.ts` remain in place.
The new suite uses the same protocol with the full application and adds the
reservation/payment chain and clock-boundary cases. Existing application smoke
tests still check `/health` against PostgreSQL and Redis separately.

## Covered scenarios

- Available, disabled, occupied and adjacent time ranges; invalid/equal/reversed
  ranges; ten-minute holds and persisted deadlines; competing hold requests synchronized at a PostgreSQL row-lock barrier.
- Manual confirmation, concurrent/double confirmation, expiry at the deadline,
  cancellation, authentication and cache invalidation/released availability.
- CAD payment-intent creation, retry idempotency key, correctly signed success,
  failed events, delayed/reordered events, concurrent duplicate delivery, altered,
  missing and stale signatures, missing metadata, rollback/retry after handler
  failure, and late payments for expired/cancelled holds.
- Admin and device authentication; 5000 ms ceiling; OPEN/UNKNOWN, offline, inactive
  output/arming, disabled locker/device restrictions; polling and redelivery;
  duplicate/conflicting results; command expiry; missing results; reconnection;
  UNKNOWN outcomes; normal and explicitly enabled bench cooldown boundaries.
- One full availability → hold → mocked intent → signed webhook → confirmed
  reservation → authenticated **admin bench** unlock → device polling → simulated
  output completion scenario. Database reservation/event/command state and admin
  command history are asserted.

## Customer access and the admin bench suite

The original lifecycle suite exercises admin bench authorization independently of
payment. The [customer access suite](../embedded/customer-unlock.md) uses this same
harness to test reservation-scoped credentials, bound payment proof, access windows,
idempotency, device safety, and uncertain outcomes. Legacy reservations keep their
admin/public workflow. A standalone confirmed status cannot authorize customer access.

Signed failed events are currently recorded but do not introduce a payment-failed
reservation state. A valid late success is acknowledged and recorded without
reviving an expired/cancelled hold; automatic refunds and reconciliation are not
implemented. There is no independent persistent payment ledger to assert.

`OUTPUT_PULSE_COMPLETED` means only the device reported its output pulse complete.
It never proves a physical latch opened. Expired requests retain an unknown outcome
and block new requests until an actual result resolves them; tests never auto-retry
an uncertain physical action. Wi-Fi, brownouts, real HTTPS provisioning, thermal
limits and mechanics remain hardware tests. The independent device-reliability
and OTA branches are not included.

## Lifecycle fixes exposed by the suite

1. Serialize a locker's hold overlap check and insertion in one transaction with a
   locker row lock. Competing requests through this service cannot both reserve
   overlapping ranges. Direct database writes are not protected by an exclusion
   constraint and must not bypass this path.
2. Make manual confirmation a conditional HOLD/unexpired update so concurrent
   confirmations or cancellation cannot be silently overwritten.
3. Commit webhook deduplication and confirmation together, with conflict-safe
   event insertion. Duplicate deliveries are acknowledged; handler errors roll back
   the event marker so retries can process it.
4. Confirm only a still-valid HOLD on success, retaining final cancelled/expired
   states. Use a stable Stripe idempotency key when creating intents for retries.

No device protocol, firmware, pulse limits, cooldown policy or schema is changed.

## GitHub Actions

The existing `api` job creates a second disposable PostgreSQL database and uses
Redis database 15 for `npm run test:reservation -- --ci`. It reuses that job's
service containers, not Docker Compose, and needs no GitHub secrets. Required
check names stay unchanged (`api`, `web`, `firmware`, `dev-tooling`). The suite
fails the API job normally; no skipped required scenarios or continue-on-error.
Customer authorization tests run in the same required API job.

## Local verification — 2026-11-05

Validated with Node 24.21.0, PostgreSQL 16 and Redis 7 in disposable containers:

- 39 lifecycle E2E tests and 9 target-safety checks passed, with no skips.
- Existing 32 API unit/integration tests, 7 provisioning tests and 2 application
  HTTP smoke tests passed, including the real database device integration test.
- API TypeScript (including tests), Nest build and firmware host/protocol tests
  passed. New test formatting, shell/Node syntax and workflow/Compose YAML parsing
  passed. No web or firmware source was changed; ESP32 compilation and browser
  E2E were not repeated for this API test branch.
- Regression checks against the original main implementations exposed concurrent
  holds, concurrent confirmations, missing intent idempotency, duplicate webhook
  errors, late confirmation and consumed event markers after handler failure.
  The fixed implementation passed. Original implementations were restored only
  temporarily inside this isolated worktree; main was not edited.
- The local helper was exercised on successful and failing suites; test containers
  were removed afterward. No development services or database were modified.

A GitHub-hosted run is still required after pushing. Existing dependency-audit
warnings from the unchanged lockfile remain outside this feature's scope.
