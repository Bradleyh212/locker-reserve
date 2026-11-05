# Device reliability and diagnostics

## Scope and rollout

This branch is based on main after CI PR #4. The device-dashboard PR was not merged at implementation time, so no web files are changed. The authenticated admin API is ready for a later UI integration.

Apply `20261104000000_device_reliability` and regenerate Prisma before starting this API version. It adds `DeviceHealth`, `DeviceEvent`, delivery/expiry observation timestamps on commands, and health rows for existing devices. It does not modify credentials or resolve existing commands. Test migrations on a disposable database first. Flashing the firmware is a separate operator action; this work does not deploy, flash, or activate hardware.

## Health contract

Existing `POST /v1/device/heartbeat` fields remain unchanged. New firmware adds optional `diagnostics`:

```json
{
  "bootId": "0123456789abcdef0123456789abcdef",
  "uptimeMs": 12345,
  "resetReason": "POWERON",
  "wifiDisconnects": 1,
  "communicationFailures": 2
}
```

Boot IDs are random per boot, not credentials. Uptime uses the ESP32 64-bit monotonic timer rather than the wrapping Arduino millisecond counter. Reset reason comes from `esp_reset_reason()`; unsupported values map to UNKNOWN. Counters saturate at 2,147,483,647 and reset per boot. Wi-Fi counts observed connected-to-disconnected transitions; short losses during blocking calls can be missed. Communication failures count non-2xx requests and requests skipped because connectivity, clock, or HTTPS setup was unavailable. They do not establish the exact cause of failure. The existing firmware version string is preserved for OTA integration.

Reports are authenticated and metadata is allowlisted. SSIDs, passwords, tokens, arbitrary request payloads and network addresses are not stored in events. Device-reported information is not independently verified hardware telemetry.

Legacy firmware without diagnostics remains supported until that device has reported a boot ID. After that, reports lacking diagnostics are ignored, preventing rollback of health state. A planned rollback to legacy firmware needs an explicit administrative health-state migration; there is no automatic reset endpoint. An ignored heartbeat returns `{ "accepted": true, "ignored": true }` but does not update door state or freshness. Updated firmware does not enable new command polling after such a response.

## Freshness and transitions

`DEVICE_HEARTBEAT_FRESH_MS` defaults to 15000 and accepts 1000–15000. A larger value cannot weaken the existing unlock freshness bound. Leave the default with the current five-second heartbeat interval. Invalid configuration fails startup. API receipt time determines freshness; device wall-clock time is not trusted for health. Future server timestamps fail closed until the server clock catches up.

A five-second scheduled sweep runs through Nest's existing ScheduleModule, even with no dashboard or device requests. It processes up to 100 silent devices and 100 unobserved expired commands per pass. Backlogs take additional passes, but unlock decisions use live timestamp checks rather than waiting for the sweep. Database row locks and unique event keys avoid duplicate transitions across concurrent API instances or restarts. Reconnection also checks for gaps missed between sweeps.

Same-boot duplicate/older uptimes, decreasing counters, and previously observed retired boot IDs do not refresh observations. A first observed boot is not labeled a restart. A changed boot ID after an earlier boot is recorded as a restart; it does not prove that the reset was unexpected or caused by power.

## Persistent event types

| Event | Meaning |
| --- | --- |
| DEVICE_FIRST_CONNECTED | First accepted heartbeat |
| DEVICE_BOOT_OBSERVED | First diagnostic boot observed |
| DEVICE_RECONNECTED | Heartbeat after a stale period |
| HEARTBEAT_STALE | Server inference: recent contact missing |
| DEVICE_RESTART_DETECTED | Reported boot session changed |
| BROWNOUT_REPORTED | ESP32 reported its brownout reset reason |
| WIFI_INTERRUPTION_REPORTED | Reported Wi-Fi disconnect counter increased |
| COMMUNICATION_FAILURE_REPORTED | Reported failed-request counter increased |
| BOOT_WITH_UNRESOLVED_COMMAND | First boot observation found unresolved work |
| REBOOT_WITH_UNRESOLVED_COMMAND | Changed boot found unresolved work |
| COMMAND_DELIVERY_ATTEMPTED | API prepared the first command response, not proof of receipt |
| COMMAND_RESULT_RECEIVED | Device result persisted; duplicate results are idempotent |
| COMMAND_EXPIRED_UNKNOWN | Deadline passed without a result; physical outcome remains unknown |
| COMMAND_OUTCOME_UNKNOWN | Device explicitly reported UNKNOWN |
| AUTHENTICATION_FAILURE | Invalid/disabled credentials; aggregated globally per server minute |

Events include server timestamp, severity, device ID where known, optional command ID, reported uptime/reset reason and bounded diagnostic metadata. Authentication failures are deliberately unattributed because an invalid token cannot establish device identity. These global events are available in the database, not in a specific device history. No successful-poll/heartbeat event is created on the normal path.

## Admin read endpoint

`GET /v1/admin/devices/:id/reliability` uses the existing admin JWT guard. Returns:

- `online`, `lastHeartbeat`, `firmwareVersion`
- `health` with last reported boot, uptime, reset reason, counters and boot observation time
- latest 50 `events`, newest first
- latest 50 `unresolvedCommands`

`health.offline` is the persisted sweep state; top-level `online` is the current timestamp-based answer. Uptime is the last report, not a live timer. `bootObservedAt` is when the server first saw that boot, not the exact reset time. Existing `/v1/admin/devices` continues to enforce the same guards and display unknown command outcomes. No new dashboard view is shipped until its separate PR merges.

## Command safety

Heartbeat, enqueue and delivery share a per-device row lock. On observing a new boot, outstanding commands are expired before the new heartbeat is accepted, including the first diagnostic boot. They are never converted to successful/rejected outcomes by inference. Result and expiry handling lock the device first and then the command, matching heartbeat/delivery lock order and avoiding deadlocks during concurrent recovery. Expiry sweeps process the oldest unobserved deadlines first.

Updated firmware waits for an accepted heartbeat before polling for new commands at boot or after a Wi-Fi disconnect. Its existing NVS journal still persists consumption before GPIO activation, prevents physical re-execution on duplicate command delivery and reports UNKNOWN if interrupted. Pending journal results can still be submitted. A late result can resolve an expired command, but a conflicting final result is rejected. UNKNOWN and pending commands continue blocking new unlocks; no automatic retry/reconciliation is added.

GPIO26 remains LOW at boot, GPIO27 retains INPUT_PULLUP/debounce, and the 5000 ms ceiling and CLOSED-only unlock rules remain. Existing main cooldown stays unchanged. The separate UI branch's opt-in five-second bench cooldown is not copied into this branch.

## OTA integration

The remote branch is named `OAT-Implementation`. Shared integration files are the Prisma schema, devices service/controller/module, firmware entry point and host test runner. It contains older copies of some main safety fixes; do not replace current main with those versions when integrating.

This branch does not touch OTA headers, update implementation, manifests, routes, partitions, version policy, or NVS journal layout. Firmware diagnostics are a new helper plus hooks in `firmware_app.cpp`. Keep OTA's version reporting when merging; retain the diagnostic payload, first-heartbeat gate, and main's replay/timestamp/reporting protections. An OTA reboot appears as a software reset; it is not classified as a fault. Reconcile any pending command before an update using the existing OTA idle policy.

## Verification and limits

Unit tests cover freshness, clock skew, duplicate reports, restart/brownout distinction, silent-device sweeps, counters, expiration and authentication aggregation. HTTP/PostgreSQL tests exercise concurrent updates, stale unlock rejection, new-boot invalidation, late/duplicate results, unknown outcomes and admin authorization. Host tests check counters and initial/reconnect polling inhibition; existing controller/protocol tests and all four Arduino builds remain required.

No database migration was applied to the running local application, and no hardware was activated. Serial diagnostics remain useful while network reporting is unavailable. RAM counters are lost on reboot; reset reason/boot ID provide only the next boot's evidence. Software cannot independently diagnose loose wiring, voltage drops, failed supplies, or mechanical latch position.

Events are retained without automatic deletion. Boot-event keys are also used to reject retired sessions, so do not prune them without adding a separate boot-history store. Follow-ups include a retention/pagination policy, rate limiting for unauthenticated endpoints, richer Wi-Fi reason capture, and UI integration after the dashboard PR merges. The next independent reservation-E2E branch remains separate.
