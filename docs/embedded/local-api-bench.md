> Main target: `firmware/src/src.ino` (see `firmware/README.md`). The API now
> requires a CLOSED contact and a heartbeat less than 15 seconds old, both at
> enqueue and delivery. The absolute software ceiling is 5000 ms; diagnostic
> targets retain their own smaller limits. Existing private limits are unchanged
> by the migration. No five-second physical pulse has been validated.

# Local API-to-device bench workflow

This implements the admin-only prototype slice of device-api.md, not customer
reservation access. The database stores hashed device credentials, heartbeat
observations and durable audited commands. Redis does not own command delivery.

1. Run `./scripts/dev-start.sh` from the repository root in your own terminal.
   It starts DB/Redis, prepares dependencies/Prisma and waits for API/web health.
2. Open http://localhost:3000/devices. Existing admin cookie login is unchanged.
   See [local development](../local-development.md) for status/stop/reset commands.
3. Create a locker through the existing dashboard. From services/api run:
   `node scripts/provision-device.cjs locker-001 LOCKER_UUID /PRIVATE/PATH/device-token.txt`.
   This creates one device per locker and writes a random credential to a new 0600
   file. It never prints the secret. Keep that file outside the repository.
4. Configure a local HTTPS certificate with a SAN matching the Mac's LAN IP or DNS.
   Set DEVICE_TLS_KEY and DEVICE_TLS_CERT to private local files and optionally
   DEVICE_TLS_PORT (default 3443). The HTTP dashboard listener stays on 3001.
   Put the issuing CA in the firmware config. Do not disable certificate validation.
5. Configure/build firmware/src/src.ino with actuation disabled initially. Keep
   firmware/device-check as a separate diagnostic. Verify heartbeat,
   reed observations, Wi-Fi loss and recovery. A last-seen age >=15s is offline.
6. Validate a coil pulse ceiling independently; set DEVICE_MAX_PULSE_MS in the API
   (defaults 0/disabled) and the matching firmware setting. Restart/reflash.
7. In /devices request one supervised pulse with an audit reason. A 202 response
   means queued, not physically unlocked. Inspect terminal result and hardware.

Implemented routes:
- GET /v1/admin/devices (admin cookie)
- POST /v1/admin/devices/:id/unlock-requests (admin cookie; pulseMs, reason)
- POST /v1/device/heartbeat (unique device bearer)
- GET /v1/device/commands/next (same credential; 204 if no valid command)
- POST /v1/device/commands/:id/result (idempotent matching result)

Firmware OTA release storage is disabled by default. When enabled, set
`FIRMWARE_RELEASE_DIR`; the publish script uses `.device-local/firmware/` when
that variable is unset. This directory is gitignored and holds per-device
firmware images, which contain that device's compiled token.

Commands expire in 10 seconds; per-device row locking serializes admin requests.
Minimum interval is 30 seconds. A missing/UNKNOWN result blocks further commands,
even after expiry; expiration does not prove the pulse did not occur. At this stage
operator reconciliation is manual and must follow inspection, preserving the audit
history. Deactivation prevents new delivery; a delivered command cannot be recalled.

Planned work: authenticated time provisioning, rate limiting, device credential
rotation UI, audited operator reconciliation, independent cutoff validation,
customer reservation entitlements and retention. Do not expose this bench server
publicly. The current admin guard is shared with the existing application.

## Validation recorded during implementation

- ESP32 Dev Module / Espressif 3.3.12 compilation passed (no upload).
- Shared actuator host tests and simulator passed.
- API and web TypeScript checks passed.
- 23 API unit/regression tests passed.
- Opt-in PostgreSQL/HTTP integration test passed using isolated simulated-device
  fixtures: authentication, concurrent requests, same-ID redelivery, idempotent
  results, expiry and credential revocation. Run from services/api with
  `RUN_DEVICE_DB_TESTS=1 npm test -- devices.integration.spec --runInBand`.
- The user has since reported successful HTTPS heartbeat, contact reporting and
  a web-triggered physical pulse. The latest sensor changes still need flashing
  and supervised hardware validation; five-second coil duty and reset/journal
  behavior are not established by those earlier tests.
- See [the startup audit](../local-development.md) for subsequent automated checks.
