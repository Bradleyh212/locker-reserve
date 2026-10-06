# Locker Reserve API

NestJS API for lockers, reservations, admin authentication, Stripe payments and optional Redis caching. Device control is [planned](../../docs/embedded/device-api.md), not implemented.

## Local development

From the repository root, configure the environment described in the [root README](../../README.md), then run `./scripts/start-local.sh`. It starts PostgreSQL/Redis containers, installs dependencies, applies migrations and runs API on port 3001 and web on port 3000. Stopping the script stops the development servers; containers remain running.

For API-only development, start its database first, configure `services/api/.env`, then from this directory run:

```sh
npm ci
npx prisma generate
npx prisma migrate deploy
npm run start:dev
```

## Current routes and behavior

- `/auth/login`, `/auth/logout`, `/auth/me`: admin httpOnly cookie authentication.
- `/lockers`, `/reservations`, `/dashboard`: guarded administrative operations.
- `/public/lockers/availability`, `/public/reservations/hold`, `/public/payments/create-intent`: public booking.
- `/payments/create-intent`: guarded PaymentIntent creation.
- `/payments/webhook`: public signature-verified Stripe webhook; preserve raw request body through a proxy.

There is no global `/api` prefix. Hold expiration runs in the API scheduler; Redis is a cache, not a hold queue. See [requirements and known gaps](../../docs/requirements.md) for concurrency/payment limitations.

## Verification

From this directory: `npm test -- --runInBand` for unit tests, `npm run test:e2e` for end-to-end tests, and `npm run build` for compilation. Prepare any environment/services needed by the selected tests; this documentation update does not claim they were run.

## Deployment and embedded plans

Use the [Docker deployment plan](../../docs/deployment.md). Existing runtime packaging and production Compose still have documented prerequisites. Read the [documentation index](../../docs/README.md) for proposed device identity, authorization and firmware contracts.
