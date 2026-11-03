# Building release candidates

CI tests changes on pull requests and on main. The separate **Release candidates** workflow packages a reviewed revision on demand. It creates downloadable GitHub Actions artifacts with 14-day retention. This is the handoff point for a later deployment system. Package versions in the two npm manifests remain independent of the release label.

## Trigger and inspect a candidate

1. Once this workflow is on the default branch, choose a main commit whose CI jobs passed. Use a reviewed, protected tag of the form `vMAJOR.MINOR.PATCH` on that commit. Tag creation and approval are separate maintainer operations.
2. Go to **Actions → Release candidates → Run workflow**, select **main**, and enter the existing tag. The workflow verifies that the tag resolves to the exact dispatched commit. A moved main requires a new candidate version or a separately designed historical rebuild procedure.
3. Supply public browser build values through the repository variables `RELEASE_PUBLIC_API_BASE_URL` and `RELEASE_PUBLIC_STRIPE_KEY` if testing a real staging environment. The defaults are inert placeholders. Browser values are embedded during compilation and visible to anyone downloading the web image.
4. Wait for both image jobs and the firmware job to pass. Download each artifact from the same run and attempt. Extract it into its own directory, then run `sha256sum -c SHA256SUMS` (on macOS use `shasum -a 256 -c SHA256SUMS`). A checksum detects corruption. Authenticity currently depends on the trusted workflow and artifact download channel.

Each Linux amd64 image archive contains the same image tagged with the release version and with `sha-<full commit>`. Inspect locally with `docker load -i <archive.tar.gz>` followed by `docker image inspect locker-reserve/api:<version>` or the corresponding web reference. The OCI version and revision labels identify the source. Services run as the node user. The API starts Nest directly. The dashboard uses the Next standalone server.

Builds use npm lockfiles, a digest-pinned Node 24 base and pinned ESP32 tools. Checksums identify the actual build outputs. Timestamps, Debian package mirrors and the dashboard's Google Fonts downloads still limit byte-for-byte reproduction across independent builds. Retain the reviewed artifacts for promotion instead of rebuilding for deployment.

## Firmware and OTA coordination

The firmware build reads tracked C++ source and headers at HEAD, substitutes the public example configuration and embeds the release version in the existing heartbeat version field. It exports only the application binary for `esp32:esp32:esp32`, built with Arduino CLI 1.5.1 and ESP32 core 3.3.12. Network and trust settings are placeholders, the token is empty, and actuation is disabled. This candidate is suitable for packaging and compatibility work. Flashing it over a working device would replace its compiled-in configuration.

To reproduce locally with the pinned tools installed, run `python3 scripts/package-firmware.py v1.2.3 /tmp/locker-fw-candidate` from the desired committed revision. Use a new output directory. The manifest records the version, full commit, board target, core, byte length and SHA-256. It is a **provisional build inventory** for reviewers. Its fields are not an OTA API specification.

Coordinate with the OTA contributor on application partition size and layout, board variants, version comparison, preserving per-device provisioning, signed firmware and trusted key rotation, staged rollout and recovery from interrupted or invalid updates. Agree on those and run hardware acceptance before offering a binary to devices.

## Deployment handoff

`infra/release/images.compose.yml` is an image-consumption template. Supply `API_IMAGE`, `WEB_IMAGE` and `API_ENV_FILE` (outside the repository). Validate it with `docker compose -f infra/release/images.compose.yml config --quiet`. It binds application ports to loopback and sets the device pulse ceiling to zero. The eventual environment supplies its own PostgreSQL, Redis, reverse proxy, TLS, and runtime secrets. The existing local startup flow is separate.

Choose a host, registry, backup and rollback process, public browser endpoints, and durable artifact storage before production. GHCR is an option once ownership, package visibility and retention are agreed. A later promotion job should use a protected GitHub environment with reviewers and only the permissions needed for its target. Prefer short-lived identity credentials and a runtime secret manager. Separate image publication, operator-approved schema migrations and deployment. Test a database restore and migration rollback strategy first. Keep device tokens, Wi-Fi settings, TLS keys and Stripe secrets out of build inputs and artifacts.

The manual packaging workflow has read-only repository access. It has no registry login, deployment credentials, API commands, migrations or physical device connection.
