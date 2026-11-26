# Supervised ESP32 staging updates

The standard cloud and bench builds keep OTA off. Only an explicitly provisioned OTA bootstrap and a separately enabled staging API participate. A CI merge compiles an image. Device installation requires a signed-in administrator to select a device-bound release and create a time-limited update with an audit reason. Existing ESP32 boards require USB preparation before their first OTA.

## Build and trust boundaries

CI uses Arduino-ESP32 3.3.12 for the classic ESP32. The firmware job tests policy and recovery in host simulations, compiles existing sketches and a zero-pulse OTA application, inspects the generated partition table and application descriptor, and checks the artifact SHA-256. Main push artifacts are retained for 30 days. The zip contains one application .bin and SHA256SUMS. The CI run number identifies the monotonic build and the filename includes the source revision. Use a newer main push for a new build number. Never serve PR builds or upload a USB directory.

The generic image contains the fixed staging origin and verified public CA roots. Private Wi-Fi and bearer credentials, device and locker IDs and the original cloud command-journal namespace come from NVS after the supervised USB bootstrap. The bootstrap keeps the complete command journal in its existing namespace. Protect the bootstrap binary and the physical board: the bootstrap embeds credentials, and this design does not configure flash encryption, secure boot or independently signed firmware. The device trusts the authenticated HTTPS API for the expected hash. A compromised trusted publisher or server can authorize malicious code.

## Prepare the server during a separately approved maintenance window

1. Review this release, its new additive migration **20261126000000_firmware_ota**, and its Compose/Caddy changes. Install the reviewed controller following [the staging CD runbook](../staging-cd.md). Use the existing backup, restore rehearsal and per-SHA migration approval process. Keep both staging pulse limits at zero. A CD application switch alone does not refresh the running Caddy configuration. Validate and apply the reviewed Caddyfile through the existing proxy maintenance procedure, retaining the dashboard allowlist. From the device network, an unauthenticated GET to /v1/device/firmware/next must return 401.
2. In the approved private staging Compose environment use OTA_ENABLED=true only for the supervised window. Apply it to the API using the normal reviewed deployment. The API mounts a named firmware volume read-only; the tools migrator mounts the same volume read/write. Provision its root for the non-root node user once. Include the volume and database in the staging backup policy; a PostgreSQL dump alone contains only metadata.
3. On the controller host use the existing STAGING_ENV_FILE, RELEASE_ID and STAGING_IMAGES_FILE for the verified release, and the locker-staging project. In a root operator shell in the controller checkout run:

   ```sh
   compose() { sh scripts/staging/compose.sh "$@"; }
   compose --profile tools run --rm --no-deps --user 0 --entrypoint chown migrate node:node /firmware
   ```

4. Obtain the successful protected-main firmware artifact from Actions. Verify the run SHA, build number and artifact identity through the authenticated GitHub account. Extract it on the host into a directory readable by the migrator, containing only the public binary and checksum. Bind-mount it read-only. Set DEVICE_ID to the supervised device's provisioned ID and ARTIFACT_DIR to that absolute directory.

   ```sh
   (cd "$ARTIFACT_DIR" && sha256sum -c SHA256SUMS)
   read -r EXPECTED_SHA APP_NAME < "$ARTIFACT_DIR/SHA256SUMS"
   compose --profile tools run --rm --no-deps \
     -v "$ARTIFACT_DIR:/input:ro" -e FIRMWARE_RELEASE_DIR=/firmware migrate \
     node scripts/publish-firmware.cjs "$DEVICE_ID" "/input/$APP_NAME" "$EXPECTED_SHA"
   ```

   Registration checks the digest, application descriptor, slot limit and embedded version/build marker. A private bootstrap is rejected. A release is bound to one device. Registering it is safe to retry and does not approve installation.

## First supervised USB and OTA test

1. Disconnect solenoid power. Identify the board and serial port physically. Confirm a classic ESP32 with 4 MB flash, the pinned core and default dual-OTA layout. Record the current build, command journal status, last heartbeat and stable reed transitions. Resolve outstanding or unknown commands using the existing procedure. Retain the previous private USB build and a tested recovery cable. Inspect the existing partition table before USB flashing; stop on an incompatible NVS layout to avoid losing the journal. Do not erase flash.
2. On the trusted Mac compile a **private build 1** using the existing protected cloud profile. Use a new directory under .device-local and restrict access. The build script validates the emitted partition map, which has otadata at 0xe000 and two 0x140000-byte app slots at 0x10000 and 0x150000. It never uploads. Then, only with the hardware owner's approval and the verified PORT, use Arduino CLI's normal serial upload for the bootloader, table and app:

   ```sh
   umask 077
   USB_DIR="$PWD/.device-local/ota-usb-v1"
   python3 scripts/ota-build.py --build 1 --usb-profile .device-local/cloud/profile.json --output "$USB_DIR"
   arduino-cli upload --fqbn esp32:esp32:esp32 --port "$PORT" --input-dir "$USB_DIR" firmware/src
   ```

3. Allow baseline enrolment/reboot and check Wi-Fi, time sync, accepted heartbeat, fresh reed OPEN/CLOSED and non-actuating status. A provisioned identity mismatch requires operator recovery. Keep power stable. Use an allowlisted workstation and an existing authenticated administrator cookie jar stored privately. Set API to the staging API HTTPS origin. Inspect release history and choose the exact RELEASE_ID returned for this device (use OTA_RELEASE_ID below to distinguish it from the Compose release):

   ```sh
   curl -fsS -b "$ADMIN_COOKIE_JAR" "$API/v1/admin/firmware-releases?deviceId=$DEVICE_ID"
   curl -fsS -b "$ADMIN_COOKIE_JAR" -H 'Content-Type: application/json' \
     --data "$(jq -nc --arg id "$OTA_RELEASE_ID" '{releaseId:$id,reason:"Supervised non-actuating bench test"}')" \
     "$API/v1/admin/devices/$DEVICE_ID/firmware-updates"
   curl -fsS -b "$ADMIN_COOKIE_JAR" "$API/v1/admin/devices/$DEVICE_ID/firmware-updates"
   ```

4. Monitor issuedAt, deliveredAt, VERIFYING and terminal result. The device polls at 30-second intervals, checks its command journal, trusted time, manifest expiry, increasing build and inactive output. It streams to the inactive partition over CA-validated TLS, compares length and SHA-256, then requests acknowledgement before selecting the trial image. Reed sampling continues on the existing independent task. Cloud heartbeats and command requests may pause during the bounded download.
5. The new image must read its journal, sample a fresh reed value, connect to Wi-Fi, synchronize time and receive an accepted heartbeat within its 60-second boot-health window. Check UPDATED with the expected version, healthy subsequent heartbeats, reed transitions and both zero ceilings. A failed or interrupted transfer should leave the previous app selected. A failed trial boot should return to the previous valid slot and report FAILED/ROLLED_BACK. Check the observed running version and report after reconnection. If rollback or recovery reporting fails, stop approving updates and use the known-good private USB procedure without erasing NVS. Never treat an absent report as success.
6. Exercise a failed trial on a spare non-actuating board before expanding use. Leave networking available for the baseline, interrupt it for the trial and restore it for the old image's result retry. Verify loss of power mid-transfer, failed trial boot, unchanged device identity and preserved journal on the actual board. Do not test by pulsing hardware. End the supervised window by disabling API OTA after the terminal report and applying the reviewed configuration. Disablement blocks new requests; it cannot cancel bytes already committed to flash.

A firmware downgrade after a successfully validated install is a separate approved release built from reviewed known-good code with a higher build number. Bootloader rollback covers an unvalidated trial. See [Espressif's OTA state machine](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/ota.html).
