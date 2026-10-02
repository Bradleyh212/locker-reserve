# Docker cloud deployment plan

Status: target runbook, not a validated deployment. AWS/EKS is historical; see the [legacy guide](legacy/aws-eks-deployment.md). No provider, domain or new infrastructure is provisioned by this documentation change.

## Target layout

Use one Docker host initially for Next.js and NestJS behind an HTTPS reverse proxy. PostgreSQL may use a persistent Docker volume or a managed service; record the choice before deployment. Redis remains an optional internal cache. ESP32 devices make outbound HTTPS requests to the API; they do not need public inbound ports. Firmware runs on the device, outside Docker.

## Existing files and blockers

- `infra/local/docker-compose.yml` supplies development PostgreSQL and Redis. Its host ports and credentials are for local use.
- `infra/local/docker-compose.prod.yml` builds web/API and PostgreSQL, but still uses fixed database credentials, a published database port, localhost CORS, no Redis service and no HTTPS proxy.
- That production-named file does not pass `NEXT_PUBLIC_API_BASE_URL` as a web build argument. The web Dockerfile supports it; supply the public API URL at build time.
- Production API cookies are Secure. Plain HTTP is not a valid production login setup.
- Health/readiness checks, restart behavior, backup automation and a tested migration runner still need implementation. The API runtime omits development dependencies, including the declared Prisma CLI; provide a pinned migration image/job rather than relying on a runtime download.

Do not deploy the existing production-named Compose file unchanged to an internet-facing host.

## Preparation

1. Choose the host, domain, database location and image registry; record them without secrets. A registry is optional if building on the host.
2. Prepare a production Compose configuration with private service networking, secret injection, persistent storage, health checks and restart policy. Publish only the required proxy ports; keep database/cache private.
3. Configure DNS and HTTPS certificate issuance/renewal. Prefer one public origin with an `/api` proxy route that strips the prefix before forwarding: NestJS currently has no global `/api` prefix. Preserve Stripe's raw webhook request body.
4. Define backup retention, restore procedure, deployment owner and recovery objectives. Test a database restore in isolation before launch.

## Configuration

| Component | Configuration |
| --- | --- |
| API | `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; `PORT` defaults to 3001. |
| API/browser boundary | `CORS_ORIGIN` must match the public frontend origin; `NODE_ENV=production` enables Secure cookies. Verify cookie behavior with the chosen domain layout. |
| Redis | Set `REDIS_URL` to the internal service URL if enabled; leave unset to use the implemented cache fallback. |
| Web build | `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`; both are public values compiled into the web build. |
| Devices (planned) | Public HTTPS API URL, server trust configuration and unique device credentials. Never use admin credentials. |

Store secrets outside Git with restricted access. Container-to-container addresses differ from browser/device addresses. On a physical ESP32, localhost refers to the ESP32, not the development computer.

## Release procedure to implement and validate

1. Build and tag web/API images with an immutable release identifier. Include the public web build values and retain the previous images.
2. Validate the selected Compose configuration with `docker compose -f <production-file> config --quiet`; this is a template, not an existing new file.
3. Back up the database and confirm the release's migration compatibility. Run `prisma migrate deploy` using the pinned migration runner with database access before serving incompatible application code.
4. Start/update services and check readiness, logs and HTTPS routing. Do not treat the root API response as a database readiness check.
5. Test login/logout, public availability, a hold, Stripe test payment and signature-verified webhook confirmation. With the proposed proxy layout, the external webhook is `/api/payments/webhook`; internally it is `/payments/webhook`.
6. Verify persistence across container replacement and confirm database/cache ports are not publicly reachable.
7. Once device support exists, perform the [embedded acceptance tests](embedded/testing.md) before connecting customer-facing locks.

## Updates, rollback and operations

Monitor API errors, payment webhook failures, database capacity/backups and eventually device last-seen/command failures. Redact credentials from logs. Define log rotation and certificate renewal checks.

For an application rollback, restore the previous image versions only if compatible with the migrated schema. Database restoration requires a planned recovery window and reconciliation of reservations/payments changed since the backup; it is not an automatic image rollback step. Never delete volumes as routine cleanup.

When migrating an existing AWS deployment, inventory live resources, back up and validate data, test the new host, cut over DNS/webhooks and retain a rollback window. Decommission old infrastructure only after explicit operational review; historical cleanup commands are not migration instructions.

Reference: [Docker's production Compose guidance](https://docs.docker.com/compose/how-tos/production/).
