# Device operations plan

Status: proposed procedures; operator tools, device endpoints and firmware are not implemented.

## Register and install

1. Record device/board/firmware identifiers and inspected hardware limits.
2. Create a unique device identity/credential and explicitly map it to a locker/output. Transfer secrets through the selected provisioning mechanism, never a public URL or repository file.
3. Configure Wi-Fi and HTTPS API trust. Check the installation network's device registration/enterprise or captive-portal requirements; validate the actual ESP32 support before installation. A hotspot is a prototype option.
4. Verify the expected locker mapping with actuator disconnected, then execute the supervised acceptance tests.
5. Record sensor presence, physical recovery procedure and installation test results before making the locker available.

## Observe and troubleshoot

Track last-seen age, firmware version, command latency/failure and stale sensor observations. The offline threshold is configurable and must be chosen with poll/heartbeat intervals. Decide whether offline lockers are removed from new booking availability; that behavior is not currently implemented.

For failures, distinguish power, Wi-Fi, TLS/time, authentication, API and mechanical issues. An API command acknowledgement is not proof of door opening. An uncertain command requires operator inspection or a new authorized request, never a blind automatic retry with a fresh ID.

## Maintenance

Use USB flashing initially, recording image version and performing the boot/default-output checks after updates. OTA is deferred. Rotate device credentials with an explicit replacement/revocation procedure and verify the old credential fails. Re-provision changed Wi-Fi settings through the selected local process without exposing passwords in logs.

When replacing a device, take the locker out of service, revoke the old credential, invalidate its pending commands, update mapping, provision the replacement and repeat installation tests. Preserve relevant audit history. Resetting a device must not resurrect old commands.

For power loss or a jammed latch, use the approved physical recovery method with an authorized operator and an incident record. Actual power-loss behavior must be recorded for the chosen lock. Define customer support and reservation/payment handling separately; do not mark access successful solely to clear an alert.
