# ESP32 cloud staging: preparation and supervised cutover

Prepared 2026-11-19 from main `c7340a8`. This work does not deploy, provision hosted
records, flash, connect the board to staging or authorize a pulse. Existing Mac
configuration and command history remain intact. No schema migration is needed.

## Boundaries and audit

The main firmware already supports HTTPS with `setCACert`, hostname validation,
NTP before requests, authenticated heartbeats, expedited contact reports
with a 5 s fallback, boot diagnostics, reconnect recovery and accepted-heartbeat
polling inhibition. A 200 alone is insufficient: JSON must explicitly accept the
heartbeat/result. Samples retain timestamp ordering/freshness validation. Requests
use 2 s HTTP/connect and 5 s TLS timeouts. Server loss closes polling on the next
failed heartbeat; pending results retry with bounded backoff. Firmware rejects
non-HTTPS URLs and networking before time >= 2026-01-01. NTP must be reachable
(UDP 123); it is not authenticated time. Rejected/stale/future samples fail closed.

GPIO26 output, GPIO27 pull-up contact, CLOSED-only preflight, durable consume-before-
pulse journal, cooldowns, hard 5000 ms ceiling and no networking during active
pulses are unchanged. Delivery/pulse completion is never proof of door opening.
Contact OPEN/CLOSED is an observation, not proof of mechanical latch engagement.
No real Wi-Fi/reset/pulse/timing acceptance is claimed by the simulations.

Staging runtime forces `DEVICE_MAX_PULSE_MS=0` and `CUSTOMER_UNLOCK_PULSE_MS=0`.
The generated firmware independently sets `ACTUATION_ENABLED=false` and
`MAX_PULSE_MS=0`. Both administrator/customer submissions and delivery of historical
queued commands remain denied. Do not change the runtime loader to permit pulses.

The dashboard can create lockers and inspect device/reliability information; its
Device setup control does not provision devices. Provisioning is a privileged SSH
operator procedure. Do not reuse `locker-bench-001`, its Mac token or local DB IDs.
Create a distinctly named simulated identity first, then a separately approved
physical staging identity. One device per locker is enforced by PostgreSQL.

## TLS trust

Device base URL is **https://api-staging.lockerreserve.com**, with no `/api` suffix.
Public roots and fingerprints are documented in [firmware/certs](../../firmware/certs/README.md).
The bundle contains self-signed ISRG Root X1 and X2, verified against their recorded
DER fingerprints. Sources: [Let's Encrypt chains](https://letsencrypt.org/certificates/).
The actual served chain on 2026-11-19 was leaf → YE1 → Root YE → X2, cross-signed
by X1. Strict TLS 1.2, hostname and chain validation passed using this bundle.
No leaf/intermediate pin, Mac CA, IP URL, redirect workaround or `setInsecure` is used.

```sh
python3 scripts/firmware-cloud.py check-tls
```

This opens only a TLS handshake, sends no token or HTTP request and creates no
application records. Run before every cutover and after issuer changes. Routine
leaf renewals/YE issuer rotations chaining to these roots need no firmware edit.
A new root/CA, revocation, root-program distrust or hostname change requires review,
a bundle update and separately approved rebuild/flash. Do not trust a certificate
merely because it arrived from the target server. Review roots at least annually;
X1/X2 trust policies end earlier than their PEM expiry. Firmware does not implement
online certificate revocation checking or automatic trust updates/OTA.

## Private profile and compilation (no board access)

Keep the original Mac `firmware/include/config.local.h` in the primary worktree.
Never copy a cloud header over it. Use `.device-local/cloud/` (Git ignored) or a
private directory outside Git. Directory mode 0700; profile/token/header mode 0600.
Do not put secrets in terminal arguments, shell history, screenshots or GitHub.
The token file is generated during approved provisioning below, not from Mac data.

```sh
python3 scripts/firmware-cloud.py init
# Prompts for Wi-Fi name/password, dedicated hosted device ID, hosted locker UUID,
# and token file path. Password is hidden; no secret is printed.
python3 scripts/firmware-cloud.py build --output "$PWD/.device-local/cloud/build-UNIQUE"
```

The profile is JSON with exactly `wifi_ssid`, `wifi_password`, `device_id`,
`locker_id`, `token_file`; relative token paths resolve beside the profile. Inputs
must be regular private files, not symlinks. Use WPA-protected Wi-Fi; the helper
requires a nonempty password. Its endpoint and disabled actuation cannot be
overridden by extra JSON fields. An existing profile/output is never replaced.
To rotate, prepare a new profile/output path referencing the new token file.

Build uses the same `firmware/src` code in a private temporary copy; it never
modifies source configs or discovers serial ports. Output directory and artifacts
are private: **binaries contain Wi-Fi credentials and token**, as can compiler
logs. Never upload them to CI/artifact hosting or commit them. A failed compile
retains its private log; inspect it locally. Use Arduino CLI with ESP32 core
**3.3.12**, FQBN **esp32:esp32:esp32**. CI uses CLI 1.5.1; Mac validation used 1.6.0
with the same core. Public example and cloud-fixture builds are also covered by
`python3 scripts/ci-firmware.py`. A nonstandard CLI path can use `--cli`.

Optional Arduino IDE header export (new file, never overwrite Mac fallback):

```sh
python3 scripts/firmware-cloud.py render --output "$PWD/.device-local/cloud/config.local.h"
```

Cloud journal namespace is a stable 14-character hash-derived name scoped to API
hostname/device ID. Changing a token keeps that namespace. Mac builds default to
`locker-api`; neither environment erases or submits the other's pending results.
Do not create another identity to bypass an unresolved command. Review/settle any
Mac pending or blocked report before physical cutover. A return to the same cloud
identity retains its command history. Do not erase flash/NVS during flashing.

## Hosted provisioning — approval required before these steps

Persistent actions below are **not executed** by this preparation. Obtain approval
for the exact locker label, device identity (simulated vs physical), operator,
reason, credential destination and any simulation heartbeat/audit writes. Never
register the same physical device simultaneously against two command authorities.
Both pulse limits must remain zero throughout this connectivity-only milestone.

1. Sign in through the IP-allowlisted staging dashboard. Create a new locker with
   a clear staging label/location, e.g. `STAGING-CLOUD-SIM-YYYYMMDD`, location
   `Simulated cloud connectivity — no hardware`. Record its hosted UUID from the
   authenticated lockers response. Do not edit operational records or reuse the
   previous payment verification locker without approval.
2. Inspect existing identity and locker mapping read-only. Refuse collisions;
   never upsert or silently overwrite. Use `esp32-staging-sim-YYYYMMDD` for the
   simulator and a different approved identity/locker for the physical board.
3. After tooling is reviewed, run it as an ephemeral migrator container using the
   existing runtime loader/private config. The currently deployed `c7340a8` image
   predates these tools; bind-mount these **reviewed files** into the migrator for
   this operation, or deploy an approved image containing them. Do not deploy new
   application code merely to provision. The runner API image has no operator CLI.

Example **on the VPS**, from the reviewed checkout, after approval:

```sh
export STAGING_ENV_FILE=/etc/locker-staging/compose.env
# Match the migrator's node UID (1000) after verifying it. Root-only parent stays 0700.
sudo install -d -o 1000 -g 1000 -m 0700 /etc/locker-staging/device-output
sudo env STAGING_ENV_FILE="$STAGING_ENV_FILE" sh scripts/staging/compose.sh run --rm --no-deps \
  -v "$PWD/services/api/scripts/staging-device.cjs:/app/scripts/staging-device.cjs:ro" \
  -v "$PWD/services/api/scripts/provision-device.cjs:/app/scripts/provision-device.cjs:ro" \
  -v /etc/locker-staging/device-output:/run/device-output \
  migrate node scripts/staging-device.cjs create DEVICE_ID HOSTED_LOCKER_UUID \
  /run/device-output/DEVICE_ID.token OPERATOR_ID 'Approved staging connectivity only; no hardware actuation'
```

Use a verified dedicated identity; placeholders must be replaced. The CLI rejects
non-staging DB host/name or nonzero pulse ceilings. The loader still requires test
Stripe keys and validated configuration. Creation saves and flushes an exclusive 0600
random 32-byte token before DB commit; PostgreSQL stores only SHA-256. Defaults are
enabled connectivity with actuation disabled and zero capability. An operator,
reason and timestamp are appended to DeviceEvent, never a token/hash. Ambiguous
commit retains the file: inspect the DB identity/hash privately before retrying.
Known provision conflicts reject; no reassignment or overwrite is provided.

Transfer without displaying the token: on the Mac, use strict verified SSH host
keys and redirect into a new private file, never into a chat/tool output:

```sh
umask 077
mkdir -p .device-local/cloud
chmod 700 .device-local/cloud
# noclobber protects an existing token file. Check SSH exit status before using it.
(set -C; ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes \
  -i ~/.ssh/id_ed25519_lockerreserve_vps ubuntu@198.245.52.176 \
  'sudo -n cat /etc/locker-staging/device-output/DEVICE_ID.token' \
  > .device-local/cloud/DEVICE_ID.token)
```

An interrupted transfer leaves an unusable partial file; retain/inspect it locally,
use a new filename, and verify the local token's hash matches the hosted hash
without printing either token. Never paste it into a terminal command argument.
Restrict/retain the VPS copy as a private credential; removal needs separate approval.

### Rotation and revocation

Use the same approved container/mount command, replace its final arguments with:

```text
node scripts/staging-device.cjs rotate DEVICE_ID - /run/device-output/NEW_UNIQUE.token OPERATOR_ID 'Mandatory approved reason'
node scripts/staging-device.cjs revoke DEVICE_ID - - OPERATOR_ID 'Mandatory approved reason'
```

Rotation changes only the hash, preserves enabled state and never re-enables a
revoked device. Revocation disables authentication. There is deliberately no
implicit re-enable operation. Both append audit events under the same device row
lock used for enqueue/delivery; commands, outcomes and reconciliation history are
untouched. A new saved rotation file remains on any DB failure, including unknown
commit. Stop/quiesce the simulator/device before rotation, wait out in-flight HTTP
requests, then verify old token 401 and new token acceptance. Already-authenticated
in-flight requests are not retroactively canceled. Keep staging pulses zero; do
not use this as a substitute for emergency physical power isolation.

## Communication acceptance

Automated tests use disposable local PG/Redis and simulated device HTTP requests,
not hosted records or the actual ESP32. Coverage: token auth, OPEN/CLOSED ordering,
stale rejection, command polling, disabled enqueue/delivery, token rotation/revoke
and audit preservation. Existing tests cover diagnostics/boot changes, retired
boots, pending recovery, duplicate results, reconciliation, concurrent commands,
and customer payment authorization. Host tests cover reconnect/failed heartbeat
polling inhibition and timed-output/sensor safety. Actual network/radio/reset and
ESP32-to-Caddy latency remain supervised acceptance, not simulated successes.

After approval and provisioning, prepare a private profile with device ID starting
`esp32-staging-sim-` and run this reproducible probe (not executed in preparation):

```sh
python3 scripts/firmware-cloud.py probe --profile PRIVATE_SIM_PROFILE.json --approved-hosted-simulation
# After separately approved revocation, check rejection without printing bodies/tokens:
python3 scripts/firmware-cloud.py probe --profile PRIVATE_SIM_PROFILE.json --approved-hosted-simulation --expect-rejected
```

It requires explicit approval acknowledgement, refuses physical/non-simulator IDs,
uses strict TLS1.2, submits CLOSED/OPEN/CLOSED with fresh boot diagnostics and
requires accepted acknowledgements plus polling 204. It never enqueues a command,
reports a command outcome or prints response bodies. It stops on any unexpected
command response. These calls persist state/security events; the flag is not a
substitute for the user's approval. No automatic repeating/background probe runs.

Once approved to create a hosted simulator, use its **separate** identity to send
fresh authenticated `POST /v1/device/heartbeat` with `doorState` OPEN/CLOSED,
`observedAtMs` current Unix ms, `outputState=INACTIVE`, `actuationEnabled=false`,
`maxPulseMs=0`, a clear `firmwareVersion=staging-sim-no-hardware`, and protocol-valid
diagnostics. Require HTTP200 **and** `accepted:true`. Poll `GET
/v1/device/commands/next`, expect 204. Invalid/revoked token probes also persist
security events and need approval. Never queue an unlock for connectivity testing.
Use mocked HTTP/server loss locally; do not stop the hosted API to simulate outage.

## Approved physical connection checklist (future, not performed)

- Approve exact dedicated physical hosted identity/locker and token transfer.
- Verify both hosted pulse limits remain 0; generated firmware false/0; verify
  DNS, TLS1.2 root/hostname trust and Wi-Fi/NTP reachability from the locker network.
- Review Mac pending command journal/history and preserve private Mac fallback.
  Do not migrate or erase unknown outcomes. Inspect coil power isolation physically.
- Build cloud firmware privately, inspect compile success and actual board/port.
  **Separate explicit flashing approval is required.** With coil power disconnected:
  `arduino-cli upload --fqbn esp32:esp32:esp32 --port APPROVED_USB_PORT --input-dir PRIVATE_BUILD_DIR firmware/src`
  Upload only the reviewed non-actuating cloud build; never erase NVS.
- Monitor at 115200: `LockerReserve device boot`, `Preferences storage: READY`,
  `WiFi connected`, `Starting NTP synchronization`, `NTP synchronized`, `Output inactive`,
  requests to the cloud URL and `Heartbeat HTTP 200; contact CLOSED/OPEN; output inactive`.
  Serial200 alone does not establish server acceptance: confirm fresh lastSeen,
  correct boot ID/mapping and observed contact timestamps in the authenticated dashboard.
- Verify polling 204, no queued commands, current actuation disabled and recent
  contact changes. Reboot/reconnect only when approved; confirm fresh accepted boot
  before polling. No unlock/button click/pulse is needed or authorized here.
- Before any future unlocking: separate approval, hardware safe-condition review,
  unresolved-command review, validated duty cycle/wiring/cooldown/interlocks and a
  reviewed staging policy change. Paid digital-key eligibility cannot bypass this.

## Troubleshooting and rollback

- No Wi-Fi: verify local private credentials/2.4GHz network; reconnect attempt is
  every 10 s. No NTP/time: requests log `system time not synchronized` and fail closed.
- TLS failure: check DNS/hostname/full chain/current roots/clock and outbound 443;
  do not increase trust to arbitrary certs or use an insecure client. TLS/HTTP
  deadlines and cloud latency may cause failures; validate real-board timing later.
- 401: wrong dedicated token, identity disabled or rotation mismatch. Don't reuse
  Mac credentials or provision another identity silently. Security events persist.
- 200 but offline/ignored: check explicit acknowledgement, timestamps, boot ID and
  monotonic uptime; older reports must not overwrite newer health/door state.
- 403 dashboard: tester IP allowlist/admin login; device routes bypass the IP gate
  but still require a device bearer. Do not broaden the staging allowlist.
- Persisted report-blocked: inspect correct environment's journal and server
  history; do not delete journal/history, auto-acknowledge uncertainty or retry pulses.

Rollback after approval: disconnect coil power, compile the **unchanged** primary
Mac private config with `firmware-cloud.py build --local-config ABSOLUTE_MAC_CONFIG
--output NEW_PRIVATE_BUILD_DIR`, then separately approve/upload it as above. It
restores the original URL/CA/identity and default `locker-api` journal; it may have
actuation enabled, so review it before flashing and do not send a command. No Mac
API restart, credential change or database reset is needed. Revoking the unused
hosted identity is another explicitly approved audited action. Never erase NVS to
make rollback work.

## Validation record — 2026-11-19

- Firmware host controller/protocol/diagnostics/contact/heartbeat/reconnect suites
  and fake-output simulation: passed.
- ESP32 core 3.3.12, `esp32:esp32:esp32`: main example, device-check, usb-check,
  reed-check, cloud profile and unchanged private Mac fallback all compiled.
  Cloud build used 1,058,696 bytes flash (80%) and 49,032 bytes globals (14%).
- 11 profile/build/probe refusal/response tests; 13 provisioning/credential tests;
  91 API unit/device/database tests; 109 reservation/payment/customer tests;
  2 application HTTP smoke tests: passed, isolated local services/fixtures only.
- API type check/build, new TypeScript test formatting, Python/Node syntax,
  8 staging runtime-config guards, 7 staging preflight guards and whitespace
  checks: passed. All seven existing migrations applied to a fresh disposable DB;
  no migration/schema changes or hosted migration execution.
- Local migrator image build and network-disabled operator-module loading: passed.
  Operator scripts remain absent from the runtime image COPY list.
- Public TLS1.2 chain/hostname verified with the committed roots. Read-only VPS
  inspection: all five services healthy, release c7340a8, both pulse limits 0,
  no registered devices. Primary Mac config SHA-256 unchanged; private profile,
  token and firmware-config paths ignored; staged secret/private-key scan passed.
- Not performed: hosted simulator records/heartbeats/revocation, physical board
  cloud handshake, radio reconnect/NTP/reset/latency acceptance, flashing or pulses.
  Hosted persistent tests and physical cutover each require approval.
- Existing lockfile audit reports 33 advisories across all API dependencies;
  `npm audit --omit=dev` reports 8 (1 critical, 6 high, 1 moderate), including
  proxy-addr's IP-trust advisory. These are inherited dependencies, not introduced
  by this change. Exploitability has not been assessed here; separate dependency
  remediation/security review is needed before wider exposure. No dependency
  versions or deployed allowlist/authentication settings were changed.

## Approved hosted follow-up — 2026-11-19

See [hosted simulator results](esp32-cloud-hosted-validation-20261119.md) and the
[dependency security review](../security/dependency-review-20261119.md). The user
approved the isolated simulator lifecycle; it passed and was left revoked with
audit history retained. These results supersede the earlier not-performed hosted
simulator notes only; physical-device provisioning/flashing remains unapproved.
No new server deployment was needed or performed.
