# Supervised ESP32 staging updates

The standard cloud and bench builds keep OTA off. Only an explicitly provisioned OTA bootstrap and a separately enabled staging API participate. A CI merge compiles an image. Device installation requires a signed-in administrator to select a device-bound release and create a time-limited update with an audit reason. Existing ESP32 boards require USB preparation before their first OTA.

## Build and trust boundaries

CI uses Arduino-ESP32 3.3.12 for the classic ESP32. The firmware job tests policy and recovery in host simulations, compiles existing sketches and a zero-pulse OTA application, inspects the generated partition table and application descriptor, and checks the artifact SHA-256. Main push artifacts are retained for 30 days. The zip contains one application .bin and SHA256SUMS. The CI run number identifies the monotonic build and the filename includes the source revision. Use a newer main push for a new build number. Never serve PR builds or upload a USB directory.

The generic image contains the fixed staging origin and verified public CA roots. Private Wi-Fi and bearer credentials, device and locker IDs and the original cloud command-journal namespace come from NVS after the supervised USB bootstrap. The bootstrap keeps the complete command journal in its existing namespace. Protect the bootstrap binary and the physical board: the bootstrap embeds credentials, and this design does not configure flash encryption, secure boot or independently signed firmware. The device trusts the authenticated HTTPS API for the expected hash. A compromised trusted publisher or server can authorize malicious code.

## Prepare the server during a separately approved maintenance window

1. After reviewed merge, wait for the main publisher and hold GitHub’s **staging** review. Record its full SHA. Use a root Bash shell in the separate controller checkout. Keep the main-only reviewer rule, existing forced SSH command, allowlist, and both zero pulse ceilings. Keep the private Compose OTA flag absent or false. After operator approval:

   ```bash
   set -euo pipefail
   umask 077
   cd /opt/lockerreserve-cd
   : "${SHA:?set the reviewed full merged SHA from the waiting main run}"
   [[ "$SHA" =~ ^[0-9a-f]{40}$ ]]
   test -z "$(git status --porcelain)"
   git fetch --quiet origin refs/heads/main
   test "$(git rev-parse FETCH_HEAD)" = "$SHA"
   git switch --detach "$SHA"
   export RELEASE_ID="$SHA" STAGING_PROJECT_NAME=locker-staging
   export STAGING_ENV_FILE=/etc/locker-staging/compose.env
   export STAGING_IMAGES_FILE=/var/lib/lockerreserve-cd/images.json
   compose() { sh scripts/staging/compose.sh "$@"; }
   python3 scripts/staging/preflight.py
   python3 -c 'import runpy,sys; assert runpy.run_path("scripts/staging/cd.py")["migrations"](sys.argv[1]) == ["20261126000000_firmware_ota"]' "$SHA"
   dir=$(mktemp -d /var/lib/lockerreserve-cd/ota-prep.XXXXXXXX)
   sh scripts/staging/backup.sh "$dir/predeploy.dump"
   sh scripts/staging/restore-check.sh "$dir/predeploy.dump"
   install -d -m 0700 /etc/locker-staging/cd-migrations
   (set -C; printf '%s\n' 20261126000000_firmware_ota > "/etc/locker-staging/cd-migrations/$SHA")
   compose --profile tools run --rm --no-deps --pull never --user 0 --entrypoint sh migrate -ec 'test -z "$(ls -A /firmware)" && chown node:node /firmware && chmod 0700 /firmware'
   ```

   Verify the scratch restore has seven migrations and representative history. Review any existing approval or populated volume before proceeding. Approve the waiting main deployment. Verify its healthy journal, exact SHA, eight finished migrations, five healthy services and both zero ceilings. The receiver owns the migration and application switch. See [backend rollback and incomplete migration recovery](../staging-cd.md#recovery-and-troubleshooting).

2. Schedule a brief proxy interruption after backend health passes. Caddy 2.10.2 uses a single ingress container with its admin API disabled. The local operator command discovers the live bind, compares the mounted bytes with the reviewed pre-OTA policy, checks the proxy image, environment and storage, and validates the staged candidate. It recreates only Caddy, reusing certificates and network settings. It verifies HTTPS authentication responses and private API health. Failed startup or verification triggers restoration from the captured root-owned copy. A failed validation leaves the running proxy alone.

   ```sh
   sudo python3 /opt/lockerreserve-cd/scripts/staging/maintenance.py proxy-apply
   # Explicit recovery after interruption or an adverse external check:
   # sudo python3 /opt/lockerreserve-cd/scripts/staging/maintenance.py proxy-recover
   ```

   From a non-allowlisted network, expect 401 for both device paths and 403 for the admin path. From the allowlisted dashboard verify the existing device resumes accepted heartbeats and its firmware version is unchanged. Authentication probes can generate normal failure telemetry. If continuous ingress is required, defer until a separate ingress path has been rehearsed. Retain both proxy snapshots in the root-only state directory while mounted.

   ```sh
   for path in /v1/device/commands/next /v1/device/firmware/next /v1/admin/firmware-releases; do
     curl -sS --max-time 10 -o /dev/null -w '%{http_code}\n' "https://api-staging.lockerreserve.com$path"
   done
   ```

3. Rehearse a paired backup and restore, and repeat following the first binary registration. Freeze new publications and keep immutable blobs in place throughout backup. Run from the administrator shell; backup creates a unique private bundle and refuses overwrite. Restore creates a new scratch database and a new, uniquely named Docker volume and prints their names. It checks the archive digest, restored release metadata, individual blob hashes, and restored file access as the container’s node user.

   ```bash
   bundle=/var/lib/lockerreserve-cd/ota-backups/$(date -u +%Y%m%dT%H%M%SZ)
   sudo python3 /opt/lockerreserve-cd/scripts/staging/maintenance.py backup "$bundle"
   sudo python3 /opt/lockerreserve-cd/scripts/staging/maintenance.py restore-check "$bundle"
   ```

   Keep successful bundles and their manifests together. These commands never expire them. Retain a verified pair spanning each supported release and rollback interval. Inspect scratch destinations before separately approving their disposal. Monitor both filesystems before accepting a publication. Encrypted off-host storage, a retention period approved by the owner, independent checksum custody and an off-host restore rehearsal are still required before relying on these files for host loss. Recover into isolated destinations first. Switching a live PostgreSQL database requires separate authorization and reconciliation of later reservations, commands and events.

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

3. Allow baseline enrolment/reboot and check Wi-Fi, time sync, accepted heartbeat, fresh reed OPEN/CLOSED and non-actuating status. A provisioned identity mismatch requires operator recovery. Keep power stable. Use an allowlisted workstation and an existing authenticated administrator cookie jar stored privately. For the approved test only, open the window from the administrator shell:

   ```sh
   sudo python3 /opt/lockerreserve-cd/scripts/staging/maintenance.py open
   ```

   This recreates the API at the journal’s current immutable image, checks the live flag and both zero ceilings, and blocks deploy/rollback until the window closes. Keep private Compose settings and CI secrets untouched. Use the origin that issued the administrator cookie; for dashboard login set API=https://staging.lockerreserve.com/api. Inspect release history and choose the exact RELEASE_ID returned for this device (use OTA_RELEASE_ID below to distinguish it from the Compose release):

   ```sh
   curl -fsS -b "$ADMIN_COOKIE_JAR" "$API/v1/admin/firmware-releases?deviceId=$DEVICE_ID"
   curl -fsS -b "$ADMIN_COOKIE_JAR" -H 'Content-Type: application/json' \
     --data "$(jq -nc --arg id "$OTA_RELEASE_ID" '{releaseId:$id,reason:"Supervised non-actuating bench test"}')" \
     "$API/v1/admin/devices/$DEVICE_ID/firmware-updates"
   curl -fsS -b "$ADMIN_COOKIE_JAR" "$API/v1/admin/devices/$DEVICE_ID/firmware-updates"
   ```

4. Monitor issuedAt, deliveredAt, VERIFYING and terminal result. The device polls at 30-second intervals, checks its command journal, trusted time, manifest expiry, increasing build and inactive output. It streams to the inactive partition over CA-validated TLS, compares length and SHA-256, then requests acknowledgement before selecting the trial image. Reed sampling continues on the existing independent task. Cloud heartbeats and command requests may pause during the bounded download.
5. The new image must read its journal, sample a fresh reed value, connect to Wi-Fi, synchronize time and receive an accepted heartbeat within its 60-second boot-health window. Check UPDATED with the expected version, healthy subsequent heartbeats, reed transitions and both zero ceilings. A failed or interrupted transfer should leave the previous app selected. A failed trial boot should return to the previous valid slot and report FAILED/ROLLED_BACK. Check the observed running version and report after reconnection. If rollback or recovery reporting fails, stop approving updates and use the known-good private USB procedure without erasing NVS. Never treat an absent report as success.
6. Exercise a failed trial on a spare non-actuating board before expanding use. Leave networking available for the baseline, interrupt it for the trial and restore it for the old image's result retry. Verify loss of power mid-transfer, failed trial boot, unchanged device identity and preserved journal on the actual board. Do not test by pulsing hardware. After collecting the terminal report, close the window:

   ```sh
   sudo python3 /opt/lockerreserve-cd/scripts/staging/maintenance.py close
   ```

   Close is retryable after an interrupted open or close. If verification fails, retain the window interlock, suspend approvals, and retry close after investigating API health. An opening failure attempts to restore the disabled setting. Neither operation replaces the release journal, rollback pair, or CD image override. Disablement blocks new requests; it cannot cancel bytes already committed to flash.

A firmware downgrade after a successfully validated install is a separate approved release built from reviewed known-good code with a higher build number. Bootloader rollback covers an unvalidated trial. See [Espressif's OTA state machine](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/ota.html).
