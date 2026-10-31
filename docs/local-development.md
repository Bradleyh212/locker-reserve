# Local development: startup, recovery and device testing

## Daily workflow

Prerequisites: Docker Desktop/Engine running with Compose v2 supporting `--wait`,
Node.js (the project was checked with Node 24.21.0), npm, Python 3.10+, `lsof` and `ps`.
The supervisor supports macOS and Linux/WSL; run inside WSL for Windows.

Create/fill `services/api/.env` and `services/web/.env.local` from their examples
as described in the root README. Existing credentials must be kept, not replaced.
Then run from the repository root in **your own terminal**:

```sh
./scripts/dev-start.sh
```

Wait for **READY**, then open http://localhost:3000/devices. Keep that terminal
open. Codex is not required. Ctrl+C or closing that terminal stops API/web.
In a second terminal:

```sh
./scripts/dev-status.sh
./scripts/dev-stop.sh
# If dependencies/client/startup state need to be rechecked:
./scripts/dev-reset.sh
```

`reset` stops only recorded, owned application processes, revalidates dependencies,
regenerates Prisma Client and restarts in the foreground. It does **not** run
`prisma migrate reset`, delete the database, remove volumes or reset device
command history. Both stop and Ctrl+C leave DB/Redis running. Existing
`./scripts/start-local.sh` is an alias to this same supervisor, not a second system.
Do not run separate `npm run dev` / `npm run start:dev` instances alongside it.

## Ownership and readiness

| Service | Owner | Local port | Readiness |
| --- | --- | --- | --- |
| PostgreSQL | local Docker Compose | 127.0.0.1:5433 → 5432 | pg_isready |
| Redis | local Docker Compose | 127.0.0.1:6379 | redis-cli ping |
| NestJS API | supervisor process group | 3001 | /health checks DB + Redis + run ID |
| Device HTTPS | same API | 3443, when configured | /health with certificate validation |
| Next.js web | supervisor process group | 3000 | /login returns 200 |

The ESP32 reaches the configured LAN HTTPS address, not `localhost` on the board.
The browser uses http://localhost:3001. The supervisor checks API PORT, CORS,
web API URL, local DB/Redis addresses and TLS file presence before startup. The
explicit private env files take precedence over stale terminal exports. Secrets
are not printed. Dollar signs in password hashes are treated literally.

Startup checks Docker and legacy containers, rejects occupied application ports,
waits for healthy dependencies, checks installed packages against lockfiles,
generates Prisma when schema/lockfile/runtime stamps or generated files require
it, and applies **existing migrations only** with `prisma migrate deploy`.
The database URL must point to localhost:5433/locker before any migration runs.
A missing migration is an error to investigate, not permission to reset data.

API starts with `npm run start:dev`. Its readiness response must match this run's
unique ID, so an old API cannot satisfy the check. Web starts after API readiness.
Readiness timeout or child exit stops the application's managed process groups.
READY includes URLs, PIDs and log paths. Startup is bounded, not just background
process creation. Dependencies are installed with `npm ci` only when needed;
first-time installs may need internet. No Prisma/Next major upgrade was made.

State, lock, fingerprints and logs live in ignored `.local-dev/` (directory mode
0700). Inspect `api.log`, `web.log`, `docker.log`, `migrations.log` or
`prisma-generate.log` for the named failed step. Status exits nonzero if the
managed supervisor or a required readiness check is missing.

A checkout lock prevents duplicate starts. Stop validates the supervisor's path,
checkout and process creation time; cleanup uses dedicated process groups so npm,
Nest and Next descendants stop too. A crashed supervisor's still-identifiable
children can be recovered. Untracked or ambiguous processes are never killed
just because they own a port: status prints the listener; stop it in its original
terminal after confirming ownership.

Obsolete `locker_web` / `locker_api` containers are removed without volumes only
when their Compose labels identify this checkout's `infra/local`. Ambiguous
containers stop startup with an explanation. DB/Redis containers and persistent
Postgres data are retained. Production Compose/deployment remains unchanged.

## Audit findings and fixes (2026-10-22)

The checkout originally contained `start-local.sh`, not `dev-start.sh`. It ran
`npm ci` each time, migrated without explicitly generating Prisma, backgrounded
API/web without readiness or port checks, and tracked npm parents rather than
complete process groups. That permitted false startup success and lingering apps.
No old web/API Docker containers were present during this audit, but protections
now detect their return. Stale generated Prisma types caused missing model/client
exports after schema/install changes; generation is now explicit and fingerprinted.

Next 16.1.1's development hot reloader awaits an optional npm registry version
query without a timeout. A listener can exist while this request stalls startup.
The dev launcher now supplies a **3-second timeout only for that exact optional
version URL**, inherited by Next's dev child. Other fetches and production
build/start are untouched; no edits to node_modules are required. Dev uses webpack
and disables Node's module compile cache/source maps to avoid the observed local
cache/read overhead. Local filesystem or dependency failures still report errors.

### Reed contact UNKNOWN

Previously a sample gap over 250 ms discarded the reliable observation, and a
state read more than 250 ms after sampling returned UNKNOWN. Synchronous HTTPS
can exceed that interval even with successful HTTP 200 responses. This was a
firmware sampling/freshness bug, not evidence by itself of a bad reed connection.
A second problem logged a new state after HTTP instead of the state actually sent.

The sensor now retains its last debounced OPEN/CLOSED observation through sampling
and communication gaps. **Freshness is checked independently for authorization**:
boot is UNKNOWN; stable input requires 50 ms; a gap over 250 ms requires renewed
sampling; a raw opening immediately prevents a new unlock. Heartbeat and
pre-actuation paths sample for 55 ms after blocking work. If input is still
unstable, the heartbeat legitimately sends UNKNOWN and the API blocks unlock.
Serial output logs debounced changes and the exact heartbeat snapshot sent.

Wi-Fi reconnect does not erase state. A true MCU reboot creates a new sensor and
legitimately starts UNKNOWN. Electrical bounce/noise can prevent settling; this
still needs hardware diagnosis if UNKNOWN persists after flashing the fix.
Historical CLOSED cannot bypass the firmware's freshness check. API enqueue and
delivery still require recent CLOSED and reject OPEN, UNKNOWN and offline/stale
heartbeats (15 seconds). A heartbeat is an observation, not latch confirmation.

### Pulse configuration

| Layer | Setting/behavior |
| --- | --- |
| Main private firmware config | MAX_PULSE_MS=5000; actuation already enabled by operator |
| Shared firmware controller | independent HARD_MAX_PULSE_MS=5000; rejects larger requests |
| Local API private env | DEVICE_MAX_PULSE_MS=5000, verified without printing secrets |
| API enqueue and delivery | positive integer bounded by server + reported device limits; hard ceiling 5000 |
| Dashboard | explicit required duration, 1..effective server/device maximum; preserves chosen duration |
| Diagnostic device-check | separate smaller limits; not the main 5-second target |

The old dashboard used a literal 200 ms default and reset the entire form after a
request. Earlier private diagnostic/API settings also used 200 ms; the local API
was already 5000 when this audit began. Private settings were not overwritten.
Now the requested value is sent and stored unchanged, with no fallback/clamping
to 200. The confirmation checkbox resets after submission; duration is retained.
An example config remains disabled by default and API defaults to zero/disabled.
The dashboard derives its maximum from the API; shared firmware checks use one
C++ constant and API checks one TypeScript constant (separate runtimes).

GPIO26 is LOW at boot; GPIO27 is INPUT_PULLUP. TLS authentication, command target
and expiry checks, persistent journal, replay prevention and local pulse cutoff
remain intact. No blocking HTTP/NVS writes occur while output is energized.
Completion means **output pulse completed**, never mechanical unlock confirmed.
5000 ms is a software ceiling, not a validated coil duty rating or independent
hardware cutoff. A frozen MCU or failed MOSFET needs hardware mitigation.

## Verification and remaining physical work

Automated checks completed during this audit:

- Shell syntax, Python syntax and six supervisor ownership/config/cleanup tests.
- Node test: the optional registry fetch times out; unrelated requests are unchanged.
- API build; 31 tests across 11 suites, including isolated PostgreSQL device fixtures.
- Prisma generation and migration deployment against the existing local database.
- Web TypeScript and production webpack build.
- Firmware host controller/sensor tests, simulator and ESP32 core 3.3.12 compile.
- Live startup, repeated warm startup, status, stop, safe reset, duplicate-start
  rejection and Ctrl+C cleanup; DB/Redis data preserved.
- Boundary tests accept 5000 and reject 5001 in firmware and API; CLOSED-only,
  offline, expiry, duplicate and authentication checks remain covered.

No firmware was uploaded and no real unlock command was issued by these checks.
Flash **firmware/src/src.ino**, not device-check, to use the revised sensor behavior.
See [firmware instructions](../firmware/README.md). First observe stable heartbeats
through repeated polling/reconnects. Then perform the supervised physical tests,
starting with a known short pulse and respecting the actual coil duty rating.
Your previously flashed firmware will continue running old logic until reuploaded.

## Files changed in this audit

This list is scoped to the startup/sensor/timing audit; the working tree also
contains earlier, uncommitted firmware/API integration work.

- `.gitignore`: ignore local supervisor state and Python cache.
- `README.md`, `docs/local-development.md`: daily commands, architecture and audit.
- `docs/embedded/local-api-bench.md`, `firmware/README.md`: current main-target,
  sensor, pulse and validation instructions.
- `infra/local/docker-compose.yml`: DB/Redis health checks and loopback bindings.
- `scripts/start-local.sh`: compatibility entry point into the single supervisor.
- `scripts/dev-start.sh`, `scripts/dev-stop.sh`, `scripts/dev-status.sh`,
  `scripts/dev-reset.sh`: lifecycle entry points.
- `scripts/dev-supervisor.py`: validation, ownership, preparation and readiness.
- `scripts/test-dev-supervisor.py`: config, ownership and cleanup regression tests.
- `scripts/web-dev.cjs`, `scripts/dev-fetch-timeout.cjs`,
  `scripts/dev-fetch-timeout.test.cjs`: bounded optional Next development check.
- `services/web/package.json`: use the development launcher.
- `services/web/app/devices/page.tsx`: explicit pulse input and retained selection.
- `services/api/src/health.controller.ts`,
  `services/api/src/health.controller.spec.ts`: dependency-aware readiness.
- `services/api/src/app.module.ts`: register health controller.
- `services/api/src/cache/redis-cache.service.ts`: Redis readiness probe.
- `services/api/src/main.ts`: shutdown hooks for supervised local runs.
- `services/api/src/devices/devices.service.ts`: positive integer delivery guard.
- `services/api/src/devices/devices.integration.spec.ts`: 5000/5001 boundaries.
- `services/api/src/devices/devices.service.spec.ts`: independent delivery bounds.
- `firmware/include/door_sensor.h`: retained state with independent freshness.
- `firmware/src/firmware_app.cpp`: refreshed observations and accurate diagnostics.
- `firmware/test/locker_test.cpp`: sensor/reconnect/bounce regressions.
