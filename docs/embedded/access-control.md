# Physical access policy proposal

Status: proposed, not implemented. Public booking currently requires no account. The database has neither customer ownership nor a reservation access credential.

## Entitlement

A reservation ID, locker code, payment UI success message or device ID is not authorization to open a locker. Before physical access is enabled, choose customer accounts or a high-entropy reservation-scoped access credential with a secure issuance/delivery/recovery flow. If using a bearer credential, store a verification hash, scope it to the reservation, expire/revoke it and keep it out of URLs and logs. Delivery and customer recovery remain open decisions.

## Proposed request checks

1. Authenticate the customer or verify the scoped access credential; apply request rate limits.
2. Load the reservation and locker from authoritative storage.
3. Require CONFIRMED and a defined payment/approved-override policy. Current admin confirmation does not prove payment, and PaymentEvent does not record a reservation payment entitlement.
4. Require `startTime <= serverNow < endTime`, an active locker, assigned enabled device and no operational block.
5. Create a short-lived command bound to the device and locker. Cap expiry at reservation end; serialize competing requests for the same actuator and apply a cooldown.
6. Audit actor, authorization reason, reservation and command ID without storing credentials.

Repeat access during the window is a proposed feature, with bounded frequency; final limits are pending. HOLD, EXPIRED and CANCELLED reservations do not authorize access. Payment confirmation does not trigger an automatic pulse.

## Cancellation and overrides

Recheck eligibility when delivering a queued command and invalidate undelivered commands on cancellation/deactivation. A command already delivered cannot be reliably recalled before execution during a network failure; bound this race with a short validity window and document it. Immediate revocation would require a stricter execution protocol.

An admin override must use a separate explicit permission, reason and audit record. It must not bypass device identity, hardware activation limits or duplicate protection. Define the allowed override window before implementation.

## Offline and recovery policy

Initial proposal: no new remote unlocks offline, no cached offline customer grants, and no replay of queued expired commands after reconnection. Output returns inactive at its local deadline even if the network is down. The actual mechanical state depends on the chosen hardware. An authorized operator handles physical recovery; never silently turn a failed/uncertain result into success.

See [device contract](device-api.md), [data model](data-model.md) and [ADR 0004](../adr/0004-access-and-recovery.md).
