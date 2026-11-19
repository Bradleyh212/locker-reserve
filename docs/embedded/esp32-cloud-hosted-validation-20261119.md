# Hosted simulated-device validation — 2026-11-19

User approved a dedicated simulator and its credential/heartbeat/rotation/revocation
records. Executed against the existing `c7340a8` OVHcloud staging deployment using
cloud branch tooling from `c056f8c`. No new application deployment, image replacement,
migration, service restart, allowlist change, physical-device contact or flash.

## Isolated retained records

- Locker: `STAGING-CLOUD-SIM-20261119`, UUID
  `4bb92d2f-1e63-4a68-8081-1e8a3cc58e7f`, location
  `Simulated cloud connectivity — no hardware`, **inactive**.
- Device: `esp32-staging-sim-20261119`, dedicated random token unrelated to Mac
  credentials. Device capability remained actuation false/maxPulseMs 0.
- Final state: **device revoked/disabled**, contact CLOSED, output INACTIVE.
  Historical observations/boot diagnostics and credential audits retained.
- Credential audit timestamps UTC: CREATE 20:41:24.170, ROTATE 20:42:36.485,
  REVOKE 20:43:38.170. Actor `ubuntu/authorized-cloud-verification` and mandatory
  reasons were recorded; no raw token or hash was printed or placed in Git.

The authenticated SSH operator used the existing migrator image with read-only
bind mounts of the reviewed provisioning scripts. Their SHA-256 matched the local
reviewed files. To keep this unattended and avoid borrowing/minting an admin web
session, the new inactive locker and reviewed device provisioning were performed
atomically in one operator Prisma transaction. No pre-existing records were
upserted/reassigned. This is the privileged operator equivalent of the runbook's
new-locker step, not an HTTP authorization bypass or an application deployment.

## Hosted results

| Check | Result |
| --- | --- |
| Strict public TLS 1.2/root bundle/hostname | Passed; API certificate expires 2027-02-16, no insecure override |
| Invalid simulated bearer | Poll 401 |
| Initial dedicated token | Three accepted heartbeats, CLOSED → OPEN → CLOSED; each poll 204 |
| Explicit heartbeat acknowledgement | Every successful heartbeat required 200 and accepted:true |
| Token rotation | Audited; old token poll 401; new token accepted three contact reports and polls 204 |
| Revocation | Audited; rotated token poll 401 and heartbeat 401 |
| PostgreSQL device state | Authenticated observations/boot/uptime stored; denied post-revocation OPEN did not replace CLOSED |
| Command history | Zero commands before and after; no unlock or synthetic result submitted |
| Safety limits | DEVICE_MAX_PULSE_MS=0 and CUSTOMER_UNLOCK_PULSE_MS=0 before/after |
| Device/locker isolation | Inactive simulated locker; final device disabled, capability false/0; no physical identity created |
| Service compatibility | All five containers healthy; same release and uninterrupted uptime; remote Git checkout clean |
| Networking | Only Caddy 80/443 published; PostgreSQL/Redis/API/web ports not host-bound |
| Private browser/API restriction | Request from current test egress to web /api/health returned 403; allowlist not broadened |
| Credential permissions | VPS/local simulator token files 0600; separate private directories; original Mac firmware config checksum unchanged |

A 403 on the private health path is the existing Caddy IP restriction, not a
failed device handshake; public machine paths worked with device authentication.
Service health was independently healthy in Compose. Private dashboard acceptance
from a newly changed tester IP would require separately approved allowlist review.

## Validation and retained operational files

Reran 11 cloud tooling tests, 13 credential/provisioning tests, 8 runtime-config
safety tests, 7 preflight guards and 39 focused API proxy/device/reliability tests;
all passed. API TypeScript check passed. Exact-peer trust was also checked locally
against IPv4 and mapped IPv4 spellings; unrelated addresses were rejected. No local
application PostgreSQL/Redis data was used. Application/firmware source and lockfile
were unchanged; this follow-up adds review/validation documentation only.

Revoked credentials are retained privately under
`/etc/locker-staging/device-output-sim-20261119/`; local simulator-only inputs are
under `/tmp/locker-cloud-hosted-sim-20261119/`. Reviewed operator scripts remain in
`/var/tmp/locker-cloud-sim-c056f8c-20261119/`. These files are outside Git and were
not silently deleted. The revoked token files are not physical ESP32 inputs.
A future simulation needs a separately approved re-enable/new-identity workflow;
rotation deliberately does not re-enable this revoked device. Do not reactivate it
as the eventual physical identity or remove its audit records.

See the [dependency security review](../security/dependency-review-20261119.md).
No security fixes have been deployed: the likely reachable body-parser crash path
needs prompt targeted remediation; the critical proxy advisory's specific subnet
precondition is absent. PR review can proceed with this limitation explicit; this
is not a clean-audit/deployment security sign-off.

## Remaining physical gate

Hosted simulated authentication, observations, recovery through a new boot, rotation
and revocation passed. Real ESP32 TLS/NTP/radio reconnect/latency, board reset and
physical interlocks were not tested here. The eventual physical identity, private
profile transfer and flashing each require approval, and both staging server pulse
limits must remain zero. No physical actuation is possible through this simulator
path: no physical device is registered, no commands exist, both server ceilings are
zero, device actuation is false/zero, and the simulated locker/device are disabled.
This does not change or certify the separate Mac hardware setup.
