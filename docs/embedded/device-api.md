# Device API contract proposal (v1)

Status: design proposal only. None of these routes, credentials or database entities exist yet. Paths are internal NestJS routes; an HTTPS proxy may expose them under `/api`. Initial transport proposal is outbound HTTPS polling; see [ADR 0003](../adr/0003-device-transport.md).

## Identity and endpoints

Devices use `Authorization: Bearer <unique-device-secret>`, with server-side verification and revocation. This is separate from admin cookie authentication and customer access credentials. Derive device identity from the credential and verify server-owned locker mapping; do not trust a submitted locker ID alone.

| Method and route (proposed) | Purpose |
| --- | --- |
| POST `/v1/reservations/:id/unlock-requests` | Customer-authorized request; returns 202 with a command ID, never a claim of physical success. |
| GET `/v1/device/commands/next` | Return one still-authorized command for this device, or 204 if none. Delivery is retryable until a terminal result/expiry. |
| POST `/v1/device/commands/:id/result` | Idempotent terminal result for this device's command. |
| POST `/v1/device/heartbeat` | Firmware version, uptime, capabilities, output state and optional door state. |

Use `Cache-Control: no-store` for command responses. Provision credentials through a separate operator workflow, not public self-registration. Poll and retry intervals, freshness threshold, request limits and command TTL must be measured/configured before implementation.

## Example command

Illustrative values only; `pulseMs` is not a hardware recommendation. Use only a duration approved for the chosen lock, with a lower device-enforced ceiling if needed.

```json
{
  "protocolVersion": 1,
  "commandId": "example-command-id",
  "deviceId": "example-device-id",
  "lockerId": "example-locker-id",
  "type": "UNLOCK_PULSE",
  "issuedAt": "2026-10-02T16:00:00Z",
  "expiresAt": "2026-10-02T16:00:10Z",
  "pulseMs": 500
}
```

Times are UTC. The server bounds expiry by access authorization; firmware rejects expired commands and commands when reliable time is unavailable. Firmware validates every field, version, target and configured duration ceiling before output changes.

## Results and physical meaning

```json
{
  "result": "OUTPUT_PULSE_COMPLETED",
  "doorState": "UNKNOWN",
  "firmwareVersion": "prototype-example"
}
```

Proposed terminal results: `OUTPUT_PULSE_COMPLETED`, `REJECTED`, `FAILED`, `UNKNOWN`. Include a bounded machine-readable reason for non-success, such as `EXPIRED`, `WRONG_TARGET`, `INVALID_DURATION` or `REBOOT_DURING_EXECUTION`. Door state is `OPEN`, `CLOSED` or `UNKNOWN`; it never proves latch engagement. Report sensor capability separately. Server receipt time is authoritative for last-seen monitoring.

## Delivery, duplicates and uncertainty

- Persist commands durably in PostgreSQL; Redis caching must not own delivery or authorization.
- Keep one in-flight command per actuator. Re-delivery uses the same ID and payload; never generate a new ID just because an acknowledgement was lost.
- Device records consumption durably before output activation. Duplicate IDs return the saved result without a second pulse. Set journal retention to cover the protocol's maximum retry/validity horizon and clock tolerance.
- On reboot with consumed-but-incomplete work, keep output inactive and report UNKNOWN. This may sacrifice execution; it avoids automatic replay. A new intentional customer request can be considered only after uncertainty is surfaced and access is revalidated.
- Server accepts repeated identical terminal results with 200. Reject conflicting results with 409 and retain the original audit record. Accept late results for reconciliation without reviving command validity.
- Retry result reporting with backoff. A timeout means unknown execution, not a successful unlock or permission to repeat a pulse.
- Revalidate queued authorization at delivery. Cancellation after delivery has the bounded race described in [access policy](access-control.md).

## Errors and security

400 malformed request; 401 invalid/revoked credential; 403 forbidden mapping/access; 409 conflicting command state; 429 rate limit with retry guidance; 5xx transient server failure. Expose no other device's data. Authentication failures stop command execution and require re-provisioning or controlled retry, not fallback to anonymous access.

HTTPS certificate/hostname verification is required. Do not log bearer tokens, Wi-Fi secrets or customer access credentials. Firmware updates, credential provisioning and customer credential delivery are separate workflows, not supplied by these four endpoints.
