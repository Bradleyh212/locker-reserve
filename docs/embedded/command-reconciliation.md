# Administrative acknowledgement of uncertain device commands

## Meaning and prerequisites

An expired command without a device result (or with a final `UNKNOWN` result) has an uncertain historical physical outcome. Expiry, a new boot, an INACTIVE output, a CLOSED door and successful heartbeats do not prove that its pulse completed or never began. Never change its result to success/rejection by inference and never delete its history to unblock another request.

An identified administrator must first review the physical locker's safe condition, outstanding work, available serial/journal evidence and surrounding command history. Reconciliation is appropriate only when that review supports proceeding despite documented historical uncertainty. If the condition is unsafe, the evidence is inadequate or a live command still exists, do not acknowledge or attempt another pulse. The API records the administrator's attestation; software cannot verify the physical inspection.

This feature adds no automatic acknowledgement, command retry, physical activation or firmware changes. It does not acknowledge any existing real device records during installation or migration.

## Administrator operation

`POST /v1/admin/devices/:deviceId/commands/:commandId/reconciliation` uses the existing administrator session cookie and additionally requires verified JWT claims `role: admin` and a nonempty `sub`. Device bearer credentials and customer credentials cannot authorize it. HTTP 200 returns the immutable `acknowledgement`, the current `commandOutcome`, and `unlockRequested: false`; it does not claim the device is ready.

The JSON body has exactly these fields:

```json
{
  "reason": "Explain why uncertainty remains and why it is appropriate to proceed",
  "evidence": "Record the physical safety inspection and relevant available evidence",
  "physicalSafetyConfirmed": true
}
```

Reason is 10–500 characters; evidence is 10–2000 characters. Whitespace-only values, false/missing attestation, extra fields and caller-supplied operator identity are rejected. Do not put credentials or private configuration in evidence.

The target must belong to the device, be expired and have no result or an explicit UNKNOWN result. A different live command blocks review. Known successful, failed or rejected outcomes do not require this operation. An identical retry by the same administrator returns the first record and timestamp without creating another event. Changed evidence, reason or actor conflicts with the immutable record; there is no overwrite endpoint.

The separate `DeviceCommandReconciliation` row stores operator identity, server/database acknowledgement time, reason, evidence, physical-review attestation, and a snapshot of the original result/reason/completion time. Original command fields and prior events remain unchanged. `COMMAND_UNCERTAINTY_ACKNOWLEDGED` links the command and operator to that audit row.

## Current readiness remains independent

All unresolved **and unacknowledged** commands are counted across the device's full history, not only the newest or five visible recent commands. Acknowledging one does not acknowledge any other. Enqueue and delivery both refuse remaining historical blockers. The admin reliability endpoint separates `unresolvedCommands` from `acknowledgements`; the dashboard shows the unresolved count, historical outcome and operator acknowledgement separately, even when an older blocker is outside recent activity. No acknowledgement form is added to the dashboard in this change.

After an acknowledgement, the device must provide an accepted heartbeat whose stored observation time is strictly later than the acknowledgement. Rejected timestamps, duplicate/decreasing diagnostics and retired boot sessions cannot refresh readiness. Merely reloading the dashboard or retrying acknowledgement cannot satisfy this condition. A stale sampled heartbeat received after review is insufficient.

Existing CLOSED-only observation freshness, online/enabled/armed status, active locker, inactive output, server/device pulse ceilings and cooldown continue to apply. Firmware's accepted-heartbeat polling gate and no-networking-during-pulse behavior remain unchanged. A subsequent pulse requires a **separate explicit supervised request** after all gates pass. The acknowledged command remains expired and is excluded from delivery; acknowledgement never requeues it.

Reconciliation, enqueue, delivery, result handling, heartbeat and expiry share the device row lock; operations touching a command lock device first, then command. This serializes concurrent review/enqueue/result races across API instances. If enqueue wins before review it sees the unresolved blocker; if review wins, enqueue waits for a new accepted heartbeat. Two simultaneous identical reviews produce one row and one event.

## Late device reports

If no device result existed at review, a later authenticated report may fill the original command's result and completion timestamp using the existing result route. `COMMAND_LATE_RESULT_AFTER_RECONCILIATION` records that arrival. The acknowledgement and its original-outcome snapshot remain immutable and visible alongside the later device report. A reported pulse completion describes a device output interval, not independently verified latch movement.

An identical repeated device result remains idempotent. A conflicting final report is rejected with 409, including an attempt to replace an already-recorded UNKNOWN with success. Acknowledgement does not weaken result authentication or the immutable-final-result rule. Late reports are never interpreted as instructions to repeat a command.

## Migration and verification

Apply `20261114000000_command_reconciliation` and regenerate Prisma before starting this version. The migration only creates the audit table/index; it does not update command, device or event rows. Use a backup and the normal approved deployment process. Do not apply it to the running development database as part of tests.

Automated HTTP/PostgreSQL tests use disposable databases and synthetic devices. They cover old blockers beyond recent history, ownership/device matching, administrator identity/role, mandatory evidence, expiry/live-command rejection, all readiness gates, ignored boot/timestamp reports, duplicate review/results, conflicting results, late reports, concurrent review/enqueue/results and retained history. Browser tests intercept the API and verify the separate outcome, acknowledgement and readiness presentation without posting unlocks. Existing booking/payment and device regressions must remain green.

Historical command `191b7cc6-2d18-4b9c-aa6a-ea53b1a86051` is not reconciled by this change. Its review and any later local database migration/reconciliation require separate explicit operator authorization.

Local verification on 2026-11-13: 77 API unit/device HTTP/PostgreSQL tests (29 new reconciliation cases), 61 booking/payment regressions, 2 HTTP smoke tests, 7 provisioning checks, 9 test-target safety checks and 41 browser tests passed. API/web TypeScript and builds and web lint passed. Six migrations applied from scratch; upgrading the five-migration `dc286b3` schema preserved synthetic command outcomes, events, devices, health and booking credentials byte-for-byte and created no acknowledgement rows. Both databases matched the final schema. Hosted CI remains pending until an approved push.
