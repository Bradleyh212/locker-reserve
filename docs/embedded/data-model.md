# Proposed device data model

Status: proposal, not a Prisma migration. [Current ERD](../erd/erd.mmd) remains a representation of implemented models only.

| Proposed entity | Fields and constraints to design |
| --- | --- |
| Device | ID, credential verifier/version, enabled/revoked state, firmware version, lastSeenAt, sensor capabilities. |
| LockerDeviceAssignment | Device, locker, output channel and assignment version; one active controller assignment per physical lock. Cardinality remains open. |
| AccessGrant | Reservation, customer identity or credential verifier, validity/revocation, issuance provenance. Do not persist raw bearer secrets. |
| DeviceCommand | ID, device/locker/assignment version, reservation or audited override, type, payload, issued/expiry times, delivery status and terminal result. |
| DeviceEvent | Device, command correlation where applicable, server receipt time, optional device time, output/door state and reason; define retention. |

Keep reservation state separate from command status and physical observations. An offline device's last reported closed door is a stale observation, not a current guarantee. Changing device assignment invalidates queued commands for the previous assignment.

Before migrating, choose one-controller-per-locker versus multi-channel controllers, customer credential design, paid-entitlement representation, retention and concurrent command constraints. Existing PaymentEvent only records Stripe event IDs; it is not a payment ledger or access grant. Design migration/backfill and indexes with the API implementation, and update the current ERD only after those models exist.
