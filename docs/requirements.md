# Locker Reserve requirements

Status: current software baseline plus planned embedded integration, reviewed 2026-10-02.

## Direction

Customers find, reserve and pay for storage lockers. The next milestone is authorized physical access using ESP32 C++ firmware, a 12V solenoid lock and an optional reed/door sensor. Cloud software remains Next.js, NestJS, Prisma/PostgreSQL and optional Redis. Docker hosting replaces AWS/EKS as the target; the provider and database hosting choice remain open.

## Implemented baseline

- Locker creation/listing, activation and deactivation; availability by location and time.
- Ten-minute holds, confirmation, cancellation and scheduled expiration inside the API.
- Overlap lookup before creating a hold; inactive lockers rejected.
- Public booking at `/book`, PaymentIntent creation and Stripe Elements payment UI.
- Backend-calculated payment amounts and signature-verified Stripe webhooks.
- Admin login and guarded routes using an httpOnly JWT cookie; Secure is enabled when NODE_ENV is production.
- Dashboard, filtering/sorting and optional Redis caching with invalidation.
- Dockerfiles and local startup via `./scripts/start-local.sh`.

These are implementation observations, not a claim that production acceptance tests have passed. Current behavior is shown in the [reservation sequence](diagrams/reservation-sequence.mmd).

## Existing correctness gaps

- Overlap checking and insertion are separate operations. There is no database exclusion constraint or enclosing transaction protecting concurrent holds.
- Webhook event recording and reservation confirmation are separate writes; do not claim atomic/exactly-once payment processing. The webhook confirms a HOLD without checking its expiresAt.
- Admin confirmation checks hold expiry but does not verify payment. Define whether such reservations authorize access before adding hardware.
- Public reservations have no customer owner/access credential. A reservation UUID is not proof of entitlement.
- Redis is a cache, not the source of truth for holds or commands.

These gaps need implementation and tests before unattended physical access.

## Planned requirements

| Area | Acceptance requirement |
| --- | --- |
| Hosting | Deploy web/API with Docker, HTTPS, persistent database, tested backups, documented updates and rollback. |
| Firmware | Separate `firmware/` project; C++ domain logic testable with fake hardware before components arrive. |
| Device identity | Unique revocable credential per device, with server-controlled locker mapping. |
| Access | Verify customer entitlement, allowed reservation state, active time window and locker availability before issuing a command. |
| Commands | Persist IDs, target, validity window and outcome; reject expired/wrong-target commands and prevent automatic duplicate activation. |
| Lock output | Boot inactive; enforce a locally bounded activation duration based on the selected lock/driver. |
| Connectivity | Provision Wi-Fi; reconnect with bounded backoff; validate HTTPS certificates; deny new remote unlocks while offline. |
| Sensor | Optional open/closed input with debounce; report unknown when unavailable. Door position does not prove latch engagement. |
| Recovery | Record uncertain execution, avoid replay after reboot, and document authorized physical recovery. |
| Operations | Heartbeats, firmware version, credential rotation, installation checks and observable failures. |

Reservation status, command outcome, actuator output and door position must remain separate concepts.

## Remaining decisions

Exact ESP32 board, solenoid/driver ratings, power supply and sensor; one controller per locker versus multiple lockers; firmware framework and pinned versions; hosting provider; customer access credential and delivery method; timing/rate limits and recovery policy. Proposals are tracked in [ADRs](README.md#models-and-decisions).

## Configuration and security

Current application environment variables are documented in the [root README](../README.md) and [deployment guide](deployment.md). Keep backend secrets and device credentials out of browser bundles, source control and logs. No firmware variables or device routes exist yet. Planned API examples are in the [device contract](embedded/device-api.md).

## Historical work

The previous docs recorded ECR image publishing, RDS migrations and EKS deployment. Keep that history in the [legacy guide](legacy/aws-eks-deployment.md); Kubernetes/Ingress work is no longer a primary milestone.
