# Private Ubuntu staging with HTTPS

Status: local implementation and disposable-container validation only. No remote host, DNS, Stripe account, Mac service, physical locker, credentials or running application database has been changed. Integrated base: main `f77582c` (merged PR #14) on 2026-11-17; preserves infrastructure commit `2ebc659`. Infrastructure branch: `codex/linux-https-staging` in its separate worktree.

## Audit and integration dependencies

- Existing `infra/local/docker-compose.prod.yml` is not safe for an internet-facing server: fixed credentials, published database/API/web ports, no TLS, Redis or controlled migration runner. Leave it for historical reference; use `infra/staging/compose.yml` for this runbook.
- Reused the reviewed build design, Node 24 digest, non-root runtime users, minimal Docker context allowlists and Next.js standalone output from `ci/cd-foundation` (`583740e`). Its worktree was read only. Added a pinned-dependency migrator target to the API Dockerfile; no runtime Prisma downloads. Do not merge that entire older branch blindly: its release workflow/firmware packaging changes are separate unfinished work, and its Dockerfile paths now overlap these changes. Future GHCR candidate publishing can reuse its immutable release image approach; no duplicate publishing pipeline is added here.
- PR #14 is merged in main `f77582c` and integrated here. Customer digital keys reuse the canonical recovery credential, verified Stripe entitlement and shared command safety policy. Both staging pulse settings remain forced to zero; a paid reservation does not authorize physical actuation in this environment.
- The combined schema has seven migrations. Existing six-migration staging databases receive only PR #14's additive command/reservation association migration; this infrastructure change adds no competing tables or fields. Existing command outcomes, audits and payment proofs must be preserved. Inspect `_prisma_migrations` before any real upgrade; an environment that applied the old experimental customer migration requires separate history reconciliation, never a reset.

## Architecture and server

Use Ubuntu Server 24.04 LTS with a supported Docker Engine and Compose plugin >=2.24.4, direct-to-origin DNS and system time synchronization. A practical staging starting size is 2 vCPU, 4 GB RAM and 40 GB SSD plus encrypted off-host backup space. Prefer 4 vCPU/8 GB if building Next.js on the host; alternatively build reviewed images on a trusted matching architecture runner. This is a sizing estimate, not a load test. Support amd64 or arm64 after validating the selected image manifests. Current local builds were Linux arm64 on Docker Desktop, not an amd64 server test.

Only Caddy publishes TCP 80 and 443. Port 80 serves ACME/redirects; HTTPS is the application transport. HTTP/3 UDP is not published. PostgreSQL and Redis have no host bindings and use an internal data network. API/web share a separate internal proxy network; Caddy uses an exact fixed peer IP. Dynamic allocations use the upper half of that subnet to avoid collisions with the proxy IP. `api-proxy` and `web-proxy` aliases resolve only on that network. API has outbound access for Stripe; Caddy has outbound access for certificates. Web has no external network. Named volumes retain PostgreSQL, Next.js cache, ACME account/certificates and Caddy configuration. Redis is disposable; no authoritative reservation or payment state is kept there.

Caddy supports two distinct hostnames:

- `WEB_DOMAIN`, e.g. `staging.example.com`: all browser pages and `/api/*`, stripped to the Nest routes. Browser uses `https://WEB_DOMAIN/api`; this keeps host-only secure cookies on the same origin and retains Stripe's redirect recovery behavior.
- `API_DOMAIN`, e.g. `api-staging.example.com`: exact public Stripe webhook and device protocol paths. Other API routes remain IP restricted. CORS permits only `https://WEB_DOMAIN`, with credentials; no wildcard.

Both hostnames need DNS A records to the server's stable IPv4. Publish AAAA only if IPv6 actually reaches that server and has equivalent firewall policy. Do not put a CDN/proxy in front without a new security review: private staging uses the socket remote IP, not spoofable forwarded headers, to admit testers. CAA records must permit the chosen ACME CA. Ports 80/443 and outbound DNS/HTTPS must work for automatic ACME issuance/renewal; persist Caddy `/data`. Automatic HTTPS redirects are enabled; TLS 1.2/1.3 are allowed. Local tests use Caddy's temporary internal CA, explicitly trusted by the test client only; remote Stripe requires a valid public chain.

## Private staging boundaries and secrets

`STAGING_ALLOWED_CIDRS` is a space-separated narrow tester/operator egress IP allowlist. Default `127.0.0.1/32` denies remote browsers/admins. Keep it to actual /32 IPv4 or /128 IPv6 egress addresses whenever possible. Do not use 0.0.0.0/0, ::/0 or a broad ISP range. This gate protects the whole unfinished dashboard as well as browser booking, including API access on either origin. Admin login and JWT authorization still apply behind it. No Basic Auth is layered over customer/device Authorization bearer headers.

Only these machine paths bypass IP restriction on API_DOMAIN:

- POST `/payments/webhook` (1 MB maximum): Stripe signature is still mandatory.
- GET/POST paths `/v1/device/heartbeat`, `/v1/device/commands/next`, `/v1/device/commands/*/result` (64 KB maximum): Nest still enforces route methods and device token authentication.

Do not register a physical device or permit pulses during infrastructure validation. Disposable tests may create an isolated simulated device and synthetic paid entitlement; they never copy Mac credentials or contact a physical locker. Staging runtime reads a private JSON file and unconditionally sets DEVICE_MAX_PULSE_MS=0 and CUSTOMER_UNLOCK_PULSE_MS=0. It also disables the Mac-specific extra TLS listener. Device capabilities, tokens, cooldowns, boot/heartbeat ordering, diagnostics and reconciliation code are unchanged. Enabling future actuation requires a separately approved, reviewed change to this staging policy, not an env edit.

The API trusts forwarded scheme/client IP only from TRUSTED_PROXY_IP, the exact Caddy peer on the internal network. Caddy overwrites X-Forwarded-Proto/For/Host and removes Forwarded. Arbitrary forwarded HTTPS sent directly to API cannot pass its HTTPS ownership guard. NODE_ENV=production keeps cookies Secure, HttpOnly and SameSite=Lax. No certificate checks are disabled.

Before remote work, secure SSH with keys, restrict 22 to operator IP/VPN, disable password/root login after verifying access, install security updates, and use a provider firewall with only 22 (restricted), 80 and 443. Docker published ports can bypass UFW rules; do not rely on UFW alone and do not publish 3000/3001/5432/6379/2019/8080. Restrict Docker daemon/socket access (root-equivalent); never mount its socket into the stack. Verify externally from a non-allowed IP that pages/admin API return 403 and database/cache ports are closed. A provider firewall remains essential.

Store files outside the checkout under e.g. `/etc/locker-staging` with directory mode 0700, root-owned. `compose.env` should be 0600. Compose file secrets are bind mounts, not encrypted-at-rest vault storage; the non-root API must be able to read its mounted JSON. One simple host arrangement is secret files 0444 inside the root-only 0700 parent; only assigned containers receive those files. Confirm actual container readability with the chosen host filesystem. Use encrypted disk/backups and restrict container exec access. Avoid `set -x`, full `docker inspect`, or printing interpolated Compose config on a real system. Secret rotation/restarts require operational approval; no secrets are committed here.

## Configuration inventory (names only; templates contain placeholders)

Copy `infra/staging/.env.example` and `api-config.example.json` to the private directory and replace placeholders locally. Do not copy Mac .env or TLS/device files into image contexts.

| Source | Variables |
| --- | --- |
| External compose.env | RELEASE_ID (reviewed commit SHA), WEB_DOMAIN, API_DOMAIN, ACME_EMAIL, STAGING_ALLOWED_CIDRS, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (pk_test_), API_CONFIG_FILE, DB_PASSWORD_FILE |
| Proxy networking | PROXY_SUBNET, PROXY_DYNAMIC_RANGE, PROXY_IP; defaults use 172.30.88.0/24, upper /25 dynamic, .2 proxy. Change all together if this overlaps host/VPN/Docker routes. |
| Dependency image overrides | POSTGRES_IMAGE, REDIS_IMAGE, CADDY_IMAGE. Defaults/templates pin tested manifest digests; review patches/security advisories before remote approval and record any updated digest. |
| Private api.json | DATABASE_URL (postgresql://locker:URL_ENCODED_PASSWORD@db:5432/locker_staging?schema=public), ADMIN_EMAIL, ADMIN_PASSWORD_HASH (bcrypt), JWT_SECRET (>=32 random characters), STRIPE_SECRET_KEY (sk_test_), STRIPE_WEBHOOK_SECRET (whsec_) |
| Private db-password file | PostgreSQL password matching the URL-encoded password in DATABASE_URL; raw password in this file. No env expansion. |
| Fixed by Compose/runtime | NODE_ENV=production, PORT=3001, exact HTTPS CORS_ORIGIN, TRUSTED_PROXY_IP, internal REDIS_URL, STAGING_CONFIG_FILE, both pulse settings=0 |
| Web build only | NEXT_PUBLIC_API_BASE_URL=https://WEB_DOMAIN/api and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY. These are public build values; a domain/key change needs a new web image. |

API/web runtimes are non-root and have restart policy unless-stopped. Migration is a one-off profile tool with full pinned Prisma dependencies, not an automatic application startup side effect. Health endpoints check API database+Redis, web /book and private Caddy :8080/health; only Caddy may reach the application from outside the host. Unhealthy status alone does not trigger Docker restart; monitor/alert and investigate rather than create an uncontrolled restart loop.

## Stripe test mode

Use a dedicated Stripe test environment/sandbox. Match sk_test_ and pk_test_ keys; loader rejects live secret keys and preflight rejects live publishable keys. Register a **snapshot** webhook endpoint at exactly `https://API_DOMAIN/payments/webhook` (no `/api` prefix on this hostname, no redirects), with that endpoint's test signing secret. A Stripe CLI local listener has a different whsec_ and is not the hosted endpoint's secret.

Subscribe to payment_intent.succeeded, payment_intent.processing, payment_intent.payment_failed, payment_intent.canceled, charge.refunded and charge.dispute.created. Main's signature verification uses Nest rawBody:true. Caddy forwards original bytes without parsing/re-serialization. Stored intent ID, expected amount/currency and receipt verification remain unchanged. A valid signature plus reservation ID alone never confirms a hold. Late payments and reversals preserve reconciliation/revocation behavior. Stripe publishable keys go only into the web build; secret keys/signing secrets never do.

The local infrastructure smoke test signs synthetic ignored events with a fixture secret and verifies byte alteration/unsigned delivery fail. Main's isolated integration suite mocks provider traffic for complete booking/payment/reversal recovery. A real hosted signed delivery and Stripe test checkout/redirect acceptance remain separate approved staging tests; no real or live-mode transactions are needed.

## Reviewed deployment procedure (do not execute remotely without approval)

Run from the reviewed infrastructure checkout as an authorized operator. These commands assume private files are prepared and a unique release SHA, not a mutable latest tag.

```sh
export STAGING_ENV_FILE=/etc/locker-staging/compose.env
export STAGING_PROJECT_NAME=locker-staging
python3 scripts/staging/preflight.py
sh scripts/staging/compose.sh --profile tools build api web migrate
sh scripts/staging/compose.sh run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sh scripts/staging/compose.sh up -d --wait db redis
```

For an existing staging database, take a backup **before** migrations and verify a scratch restore. For first initialization, record that it is a new empty staging volume. Do not point this stack at the Mac database.

```sh
sh scripts/staging/backup.sh /secure-backups/unique-before-release.dump
sh scripts/staging/restore-check.sh /secure-backups/unique-before-release.dump
sh scripts/staging/compose.sh run --rm migrate
sh scripts/staging/compose.sh up -d --no-build --wait api web caddy
sh scripts/staging/compose.sh ps
```

`backup.sh` uses a private pg_dump custom archive, refuses overwrite and writes SHA256; `restore-check.sh` restores into a newly created scratch DB, never overwrites the application DB, and reports its name. Inspect row counts, migration history and application invariants there; explicitly drop that scratch DB only after review. Store encrypted backups off-host; define retention (initial proposal daily 14 days plus pre-upgrade copies), owner and restore objectives before deployment. A checksum/list alone is insufficient; perform actual restores regularly.

On upgrades, record old release IDs/digests, schema history, web public build configuration and backup checksum. Review migration compatibility before running migrate. Do not run startup migration from every API replica. Existing PostgreSQL credentials are initialized only on a new volume; changing db-password later does not rotate an existing database password.

Then verify HTTPS certificates/hostnames/expiry with a normal trusted client, HTTP redirect, approved-IP access, non-approved-IP denial with spoofed X-Forwarded-For, /api/health, login/logout and unauthenticated API denial, test Stripe webhook/booking recovery, logs and volume persistence. Do not connect the real ESP32 yet. PR #14 is integrated; apply its seventh migration using the approved procedure and verify owner-bound digital-key access with pulses disabled before any hosted acceptance.

Caddy admin API is disabled; a mounted Caddyfile edit is not automatically loaded by Compose up. After validating a changed Caddyfile, use an approved `up -d --no-deps --force-recreate --wait caddy` for that project. Same precaution applies to changed secret files; process env is read at startup. Record short proxy downtime in the operator window.

## Restart and rollback

Application-only restart, when approved: `sh scripts/staging/compose.sh restart api web`, then `up -d --wait api web` and verify HTTPS health/login/recovery. Never restart the Mac development supervisor as part of this procedure.

Before update, retain previous API/web/migrator images and exact Compose/Caddy configuration. For a compatible application rollback, restore the previous reviewed infrastructure checkout and its external RELEASE_ID, then `up -d --no-build --wait api web caddy`; do not rebuild old tags from new source. Caddy config changes need explicit validated recreation as above. Database upgrades are forward-only by default. If the prior application is incompatible with the migrated schema, stop and plan a forward fix or a separately approved maintenance restore.

A real database restore is a distinct recovery operation: disable ingress/stop application writers, reconcile Stripe/provider events and reservations changed since backup, verify archive integrity, restore into a NEW database/volume, validate in isolation, then perform an explicitly approved cutover. This runbook deliberately supplies no automatic destructive overwrite/reset command. Never use `down -v` on staging; image rollback does not undo a migration or payment event. Do not delete old device command history, tokens or acknowledgement records.

## ESP32 readiness and cutover gate

Leave the physical ESP32 using its Mac URL/config/token until hosted API validation is complete. Firmware currently uses WiFiClientSecure.setCACert(API_CA_PEM), HTTPS API_BASE_URL, hostname verification and a synchronized clock before networking. A public domain requires the actual issuing chain's trusted root PEM (not the leaf or old Mac self-signed certificate), valid SAN/hostname, NTP connectivity and outbound TCP 443/DNS. Validate the served full chain and firmware trust on a simulator/bench-approved plan; ACME renewals keep hostname stable but issuer/root changes may require trust updates. Never setInsecure or disable verification. Firmware does not automatically adopt a new URL or CA; a future separately approved configuration/build/flash is required.

The root API domain (no /api suffix) maps directly to firmware /v1/device routes. Preserve the device's unique token, server-side hash, locker mapping, disabled/armed state and historical command/reconciliation data through an explicitly planned data migration. A fresh empty staging database will reject the existing token; do not silently create a second device or copy production/Mac credentials during this task. No admin credentials may be used as device authentication. Decide isolated staging device vs approved existing-device cutover before provisioning anything.

Even after connectivity works, keep both pulse settings zero, validate accepted heartbeats and timestamp/boot freshness, and do not infer latch opening from command delivery or pulse completion. No hardware change is needed for this infrastructure PR.

## Logs and troubleshooting

Nest production logs and Caddy access/runtime logs are JSON on stdout; Docker rotates json-file logs at 10 MB x 3 per service. Caddy removes request URI (including query strings) and Stripe signature from access logs; built-in Authorization/Cookie/Set-Cookie redaction remains on. No request bodies are logged. Logs still contain IPs and operational metadata: restrict access and set retention. Never enable log_credentials, body logging or print runtime env. Back up Caddy /data securely (contains ACME private material); never commit it.

- TLS/ACME failure: verify direct A/AAAA, clock, CAA, provider firewall and ports 80/443, DNS egress and persisted /data. Do not repeatedly retry issuance against ACME rate limits.
- 403 private staging: compare actual tester egress IP; forwarded spoofing must not help. Do not broaden the allowlist to fix a login.
- HTTPS credential guard 403: check exact TRUSTED_PROXY_IP, proxy-only aliases and loaded Caddyfile; do not set trust proxy=true or weaken the guard.
- API unhealthy: inspect sanitized logs and DB/Redis health; secret readability, DATABASE_URL and migrations must match. Redis fails closed for customer rate enforcement in the combined branch; noeviction prevents loss of live rate-limit counters under memory pressure.
- Stripe 400: hosted endpoint whsec_, raw body and snapshot payload mode; do not bypass signature verification. 502: check API build, DNS alias, network and readiness. Payment confirmation/reconciliation issues require owner-scoped evidence, not manual CONFIRMED writes.
- Offline device: verify DNS/time/root chain/token/mapping without sending commands. Do not flash or rotate credentials as an automatic diagnostic step.

## Validation and remaining acceptance

See `scripts/staging/runtime-config.test.cjs`, `test-preflight.py`, API proxy tests and fixture-only `smoke.py`. The smoke test refuses any project except locker-staging-validation and targets only staging.localhost/api-staging.localhost resolved to loopback with explicit CA trust. It creates only fixture data in that disposable project's database and does not invoke Stripe provider APIs or contact physical devices. It proves authenticated customer/admin unlock submissions are denied, then inserts a synthetic historical queued command directly into the fixture database and proves authenticated delivery remains blocked without altering that history.

Run `python3 scripts/staging/test-local.py --build` to build images and exercise a fresh disposable stack. It refuses existing containers or data volumes for project locker-staging-validation, uses loopback-only 58080/58443, a temporary internal CA with strict client trust, fixture keys and an isolated 172.30.91.0/24 network, then removes only its own fixture volumes/containers. Ports and subnet must be free. It checks denied/spoofed access before allowing the exact local Docker gateway, signed-byte validation, ownership/recovery, backup checksum and scratch restore, container replacement persistence, migration rerun and a six-to-seven migration upgrade preserving synthetic audit/payment history. Do not use its cleanup commands on real staging.

Run `node --test scripts/staging/runtime-config.test.cjs` and `python3 scripts/staging/test-preflight.py` for the configuration guard tests; these are also included in the existing CI tooling job. Standard web builds/start remain unchanged locally; only Docker builds enable NEXT_STANDALONE=1.

The final task report records the completed results. Public ACME issuance/renewal, DNS/provider firewall reachability, an actual Ubuntu host/amd64 build, hosted Stripe test deliveries, Safari and hosted digital-key acceptance remain unverified until separately approved. No public launch, automated release publishing, OTA or account authentication is included.

Primary references: [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https), [reverse proxy headers](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Stripe signed webhooks](https://docs.stripe.com/webhooks), [Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/), [Docker firewall behavior](https://docs.docker.com/engine/network/packet-filtering-firewalls/).


Historical pre-integration validation (2026-11-16, main `0f65521`): API production/migrator and standalone web Docker images built successfully; 90 API unit/device/reconciliation/proxy tests, 61 booking/payment integration tests, 2 HTTP smoke tests, 41 Playwright browser tests, 8 runtime-secret tests and 7 preflight safety tests passed. API/web type checks, production builds, web lint, shell/Python syntax and firmware host tests passed. Fresh six-migration install plus no-op upgrade from the current-main schema passed. The repeatable Docker harness verified strict CA/hostname trust, HTTPS redirect, private allowlists/spoof rejection, raw signed webhook acceptance and tamper rejection, Secure cookie login, owner-bound hold retry/recovery with unchanged deadline, backup checksum/scratch restore, non-root cache writes and persistent data across full container replacement. All disposable test containers/volumes were removed; the existing Mac database/Redis/services and ESP32 remained untouched. No real provider transaction, digital-key acceptance, public ACME issuance, remote Ubuntu deployment or real previous-release rollback was performed. This older validation predates the integration; see the 2026-11-17 merge-validation results below.


OVHcloud target: Ubuntu 24.04 with Docker Engine and Compose installed; operator reports SSH secured and UFW allowing 22/80/443. No VPS connection or firewall change is authorized by this merge. Before deployment confirm actual web/API hostnames and DNS, tester egress IP allowlist, matching Stripe test configuration, private file permissions, image architecture and off-host backup destination. Verify published Docker ports externally and review OVHcloud network firewall coverage; UFW alone is not proof that unpublished database/cache services or future published ports are protected.


Merge validation completed 2026-11-17 (`2ebc659` + main `f77582c`): both documentation/environment conflicts preserve the complete combined variable/comment set without duplicates. Passed 109 booking/payment/customer integration tests, 90 API unit/device/reconciliation/proxy tests, 2 HTTP smoke tests, all 50 browser tests, 8 runtime-config tests and 7 Compose preflight tests. API/web type checks, production builds, web lint, shell/Python syntax, firmware host tests and all three Linux Docker image builds passed. The disposable Caddy stack passed strict TLS/hostname verification, IP restrictions, signed raw webhook validation, secure admin cookies, ownership/recovery, paid digital-key reads and backup/restore/persistence. Customer and administrator unlock requests both returned 403 without creating commands; authenticated delivery of a synthetic queued pulse returned 204 and preserved its unknown outcome. Fresh seven-migration installation and six-to-seven upgrade passed, preserving synthetic command/reconciliation/event/health/payment records. The test harness now refuses pre-existing validation volumes as well as containers. No production secrets, local application database, Mac service, physical device or remote VPS was changed. Public DNS/ACME issuance, hosted Stripe test transactions and actual OVHcloud deployment remain operator-approved follow-up steps.

## Cloud device preparation (2026-11-19)

Follow [ESP32 cloud integration](embedded/esp32-cloud.md) for the dedicated cloud
profile, verified public roots, safe provisioning and separate journal. Hosted
staging is now deployed at `c7340a8`; the historical local-only status/validation
notes above describe earlier work. Read-only verification found all five services
healthy, both forced pulse limits zero and zero registered devices. No hosted
identity is created by the preparation tooling or TLS check. Off-server paid
backup storage is intentionally deferred for this disposable, no-real-customer
staging environment; retained on-server backups are not disaster protection.
