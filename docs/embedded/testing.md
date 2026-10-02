# Embedded acceptance test plan

Status: planned tests, not executed results. Use fake hardware first, then the selected board with actuator disconnected, then supervised bench hardware. No firmware/device endpoints currently exist.

| Scenario | Expected result |
| --- | --- |
| Valid grant in confirmed reservation window | One command for assigned device; bounded pulse and recorded result. |
| Missing/invalid grant, HOLD, cancellation, before start or at/after end | No command/activation. |
| Admin-confirmed unpaid reservation | Follow explicitly selected payment/override policy; no implicit paid entitlement. |
| Wrong/revoked device credential or wrong locker target | Reject without output change or cross-device data exposure. |
| Duplicate delivery or lost result acknowledgement | Same ID does not trigger another pulse; result can be resent. |
| Expired command after reconnection | Reject; no delayed automatic unlock. |
| Reboot before/during/after pulse | Output inactive on boot; consumed commands not replayed; incomplete result is UNKNOWN. |
| Network loss during activation | Local deadline still disables output; report outcome after reconnect. |
| Invalid TLS trust, hostname or unavailable reliable time | No command execution through an insecure/time-unchecked fallback. |
| Excessive pulse, malformed payload, unknown protocol | Reject without activation. |
| Concurrent customer requests | One in-flight command per actuator; no pulse extension. |
| Sensor absent/bouncing/disconnected | Unknown or debounced position according to validated circuit; no invented lock state. |
| Cancellation after delivery | Measure/document the short command-validity race; no claim of instantaneous recall. |
| Power interruption, supply sag and repeated use | Document observed mechanical state and limits; no unintended boot pulse. |

For each run record firmware/API versions, hardware revisions, test input, expected/observed result, command IDs, timestamps and pass/fail. Keep secrets out of captures. Use a meter/appropriate instrumentation to verify output duration, supply and boot behavior; software logs alone do not validate wiring.

Also test concurrent reservation creation and webhook retry/expiry cases identified in [requirements](../requirements.md) before enabling unattended access. Production acceptance includes Docker restart persistence, HTTPS login, Stripe test webhook verification, backup restoration and operator recovery. A simulator pass is not bench or production acceptance.
