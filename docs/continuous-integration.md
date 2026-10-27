# Continuous integration

`.github/workflows/ci.yml` runs on PRs targeting `main`, pushes to `main`, and
manual dispatch. All four jobs run without path filters, with timeouts and
cancellation of superseded runs for the same PR/ref. No deployment is included.

## Jobs and required checks

After the first successful GitHub run, select these check names in the `main`
branch ruleset. This change does not modify branch protection automatically.

| Required check | What it validates |
| --- | --- |
| `api` | npm lockfile install, Prisma generation and migrations, 31 unit/device HTTP/database tests, two application e2e smoke tests, Nest TypeScript build |
| `web` | npm lockfile install, existing ESLint command, TypeScript, normal production Next build |
| `firmware` | C++17 host unit tests and simulator; ESP32 builds of main `src`, `device-check`, `usb-check`, `reed-check` |
| `dev-tooling` | Shell/Python/Node syntax, six supervisor tests, fetch-timeout regression, local Compose syntax |

API uses ephemeral PostgreSQL 16 and Redis 7 GitHub service containers with health
checks, not local Compose. The e2e test checks both through `/health`, then closes
Prisma/Nest resources. The web build requires no live API. Existing Google Fonts
integration requires outbound network access during build.

Node 24 matches the locally validated runtime (24.21.0) and supports the locked
Next/Nest/Prisma packages. Python 3.12 and Ubuntu 24.04 are explicit. Production
Node 20 Dockerfiles and dependency versions are unchanged. Actions use immutable
commit pins; Arduino CLI 1.5.1 and Espressif core 3.3.12 are pinned.

`setup-node` caches npm downloads by lockfile, never node_modules. Arduino packages
are cached by OS, architecture, CLI and core versions; core installation is still
checked on each run. No compiled firmware is published.

## Credentials and hardware

No GitHub secrets are required. Service-container passwords, JWT and Stripe values
are public test placeholders, not working account credentials. Device tests create
isolated simulated fixtures in `locker_ci`; they never contact a physical board.
No local `.env`, Wi-Fi passwords, device tokens or TLS material enter the workflow.

`scripts/ci-firmware.py` compiles a temporary copy excluding all `config.local.h`
files. It generates headers only from tracked example configuration, with actuation
disabled, and removes the temporary tree afterward. Local headers are never
modified. The helper never uploads firmware. The archived `circuit-check` experiment
is excluded from supported targets because it can hold an output on when flashed.

The workflow uses `contents: read`, disables persisted checkout credentials, and
uses ordinary `pull_request`, not `pull_request_target`. Fork PRs need no secrets.
There are no deployment permissions, `continue-on-error` steps or force-exit tests.

## Local reproduction

Use a clean checkout without private env files. In `services/api`, set DATABASE_URL
and REDIS_URL to disposable services, NODE_ENV=test, JWT_SECRET to a test string,
the Stripe variables to placeholders, DEVICE_MAX_PULSE_MS=5000 and
RUN_DEVICE_DB_TESTS=1. Then run:

```sh
npm ci
npx --no-install prisma generate
npx --no-install prisma migrate deploy
npm test -- --ci --runInBand
npm run test:e2e -- --ci --runInBand
npm run build
```

Never point that sequence at production. In `services/web`, set the public
placeholder variables shown in the workflow and run:

```sh
npm ci
npm run lint
npx --no-install tsc --noEmit
npm run build
```

From the repo root with the pinned ESP32 core installed:

```sh
sh firmware/scripts/run-host.sh
python3 scripts/ci-firmware.py
python3 scripts/test-dev-supervisor.py
node --test scripts/dev-fetch-timeout.test.cjs
```

The firmware helper accepts `--cli /path/to/arduino-cli` and
`--config-file /path/to/arduino-cli.yaml` for a local Arduino IDE installation.
See the workflow for syntax checks. No check starts the local dashboard or sends
an unlock command.

## Findings and verification (2026-10-23)

- Clean lockfile installs, Prisma generation, both migrations, 31 API tests,
  two e2e tests and API build passed against disposable test services.
- Existing e2e code lacked teardown. It now closes Prisma/Nest and checks actual
  DB/Redis health. No production lifecycle was changed.
- Web had 19 existing lint errors. Thirteen explicit-any annotations were replaced
  with erased TypeScript types/assertions. Six existing effect calls have explained,
  line-specific `set-state-in-effect` exceptions, preserving existing loading and
  selection behavior instead of refactoring product behavior in this CI change.
  The rule remains enabled globally and new occurrences still fail lint.
- Web lint, types and normal production Turbopack build passed without a live API.
- Host tests/simulator and all four ESP32 targets compiled successfully with example
  configuration. The independent 5000 ms cap and CLOSED-only safety code is unchanged.
- All six supervisor tests passed on Linux with Python 3.12 and `ps`. macOS returned
  EPERM during a process-group probe; this was not hidden by skips or app changes.
- Node regression, syntax checks and local Compose validation passed.
- Actionlint 1.7.12 validated the workflow; its official download checksum was verified.

A GitHub-hosted run remains the final runner/network verification; local passes do
not mean Actions has already run. Physical timing, coil duty, reed alignment,
Wi-Fi/TLS provisioning, reset behavior and mechanical latch engagement require
bench tests. Real payment-provider integration is outside this secret-free suite.

## Separate CD phase

Existing Kubernetes/EKS manifests and production Compose examples do not establish
the current deployment owner, target or reviewed credential strategy. No CD was added.

Next, select one staging target and confirm domain/TLS, managed data services,
backups and migration strategy. Design GitHub Environments and approvals,
short-lived OIDC authentication where supported, immutable image publishing,
staged migrations, health checks and rollback. Promote reviewed images only after
a separate CD review. Firmware OTA signing/rollout/rollback needs its own design;
this workflow does not publish or install OTA images.
