# Staging continuous deployment

## What runs

Pull requests run the existing API, web, firmware and tooling checks plus deployment tests and verification builds. A PR job has no publication or deployment credentials. After all five checks pass on main, the publish job builds the API runner, Next.js standalone runner and Prisma migrator for Linux AMD64 from a Git archive of that commit. Each build uses the current Dockerfiles, public browser settings and tracked source. A scratch build checks that mock private files cannot enter the build context. No build secret mounts, private config, SSH forwarding or workflow artifacts are needed.

GHCR package names are `ghcr.io/bradleyh212/locker-reserve-{api,web,migrate}`. Tags are `sha-<full commit>`. Deployment uses the three manifest digests returned by the pushes. CI pulls each digest and compares its image ID with the image it tested. The VPS verifies package, digest, source/revision/service labels, platform and public-key fingerprint. Trust comes from the protected publisher, restricted SSH identity and exact digest handoff. Restrict package write access accordingly.

## GitHub preparation (repository administrator)

1. Protect main with PR review and required API, web, firmware, dev-tooling and staging-verification checks. Prevent direct pushes and review changes to workflows, Dockerfiles, staging scripts and migrations.
2. In Settings → Environments, configure **staging**, restrict deployments to the main branch only, select the designated reviewer for the first deployment and disable bypass where available. Verify the rules before enabling either switch. If the repository plan cannot enforce the required rules, leave both switches off.
3. In repository Actions variables configure `STAGING_STRIPE_PUBLISHABLE_KEY` to the existing staging **test publishable** key. It is embedded in the browser bundle and must match the server configuration. Leave `STAGING_MANUAL_ENABLED` and `STAGING_AUTO_ENABLED` absent or false initially.
4. In the staging environment set variable `STAGING_SSH_HOST` to the existing SSH destination. Add secrets `STAGING_SSH_KEY` (dedicated forced-command private key) and `STAGING_KNOWN_HOSTS` (the corresponding verified host entry). Compare the server fingerprint through a trusted independent channel. Avoid using an administrator's personal key or trusting a fresh network scan alone.
5. Allow this repository's Actions token to publish the three GHCR packages. For existing packages, grant this repository Actions write access. Give the VPS read-only access to private packages. Keep registry passwords, database credentials, device tokens and Stripe secret keys off the runner. The publisher uses its short-lived Actions token.

## Server preparation (Phase B, after approval)

Keep the existing live checkout, volumes, proxy and private configuration in place. Install the reviewed controller in a **separate root-owned checkout**, including its .git directory. The SSH account must have no write access to that checkout or its parent. A writable controller executed with sudo would grant root privileges.

- Install Git, Ubuntu Python 3.12, curl, coreutils and Docker Engine with Compose v2 supporting `up --wait`, JSON config and `--pull never`. Provision root with read-only Git access to the canonical repository using the existing trust process. For SSH origins pin GitHub's host key. As root, clone the repository into `/opt/lockerreserve-cd`, fetch main and check out the reviewed merged SHA detached. Confirm `git remote get-url origin` identifies Bradleyh212/locker-reserve. Future changes under infra/staging or scripts/staging require installing the corresponding reviewed controller before deployment.
- Create `/var/lib/lockerreserve-cd` root-owned mode 0700. Keep `/etc/locker-staging/compose.env` and its existing private files. Validate the existing project's name is locker-staging, db/redis/caddy/api/web are healthy, and both running app images have the same full revision tag or OCI revision label.
- Authenticate root's Docker client to GHCR with a package-reader account and `docker login ghcr.io --username <reader> --password-stdin` using a protected secret source. Ensure adequate separate space for images and backups. Restrict and monitor backup storage and arrange off-host encrypted copies under your retention policy. The controller never prunes images or backups.
- Add a **dedicated** public key entry to ubuntu's authorized_keys with this exact forced command prefix, before the key type and public key. Keep the administrator's existing keys separate.

```text
restrict,command="/usr/bin/sudo -n /opt/lockerreserve-cd/scripts/staging/cd.py"
```

Install the controller executable mode 0755. Using visudo, preserve only the requested SSH command for this invocation and allow the exact no-argument entry point. Ubuntu's existing administrator permissions do not make an unrestricted private key suitable for CI.

```sudoers
Defaults!/opt/lockerreserve-cd/scripts/staging/cd.py env_keep += "SSH_ORIGINAL_COMMAND"
ubuntu ALL=(root) NOPASSWD: /opt/lockerreserve-cd/scripts/staging/cd.py ""
```

Confirm the dedicated key rejects interactive shells, rollback, extra arguments and arbitrary refs. A valid handoff can request only a full SHA and three digests. Do not issue a valid deploy request for a connectivity test. Pin the existing SSH host key without changing the dashboard allowlist.

## First rollout and automatic operation

After approval and merge, confirm the main build published all three packages. Set only repository variable `STAGING_MANUAL_ENABLED=true`. Run the **CI** workflow manually on main, select **deploy_staging**, review the SHA and approve the staging environment job. A stale SHA is rejected again before migration. The publisher and receiver serialize changes, with a second exclusive lock on the VPS. New pushes can supersede queued older releases.

The receiver checks staging configuration, both zero pulse ceilings, private networks, free disk and current service health. It verifies the migration history against the release SQL, saves and checksums a private PostgreSQL custom dump, and decodes the complete archive. It journals the current pair of application image IDs and SHA before migration. Only the one-shot migrator and the API/web containers are started. The proxy, database and Redis continue using their existing containers and volumes.

Pending migrations require an operator review that the old applications can run against the new schema. Place their exact directory names, one per line in order, in the root-owned file `/etc/locker-staging/cd-migrations/<full SHA>`. Never approve incompatible SQL through this mechanism. Schedule separate database maintenance with a tested recovery plan. Archive decoding is an integrity check. Exercise the documented restore drill against an isolated database before the first rollout.

On success, check Actions' summary and the root-only journal. Check API/web IDs against the digests and examine healthy service status. The receiver tests the API and web upstreams from Caddy's network, then uses TLS against the two local virtual hosts. An allowlist 403 is accepted only alongside successful private upstream checks. No real payment, device command or unlock is used.

After the first rollout and recovery review, the owner may enable `STAGING_AUTO_ENABLED=true` and disable the manual switch. If subsequent runs should proceed without a human click, deliberately change the environment's reviewer rule after the first deployment while retaining its main-only branch restriction and protected-main reviews. To suspend future deployment, set **both** switches false. A run already handed to the VPS may still finish. Check the journal before intervening.

## Recovery and troubleshooting

As an administrator inspect only release metadata:

```sh
sudo python3 -c 'import json; r=json.load(open("/var/lib/lockerreserve-cd/release.json")); print(r["phase"], r.get("active_sha","verify running containers"), r["sha"], r["previous_sha"])'
sudo docker ps --filter label=com.docker.compose.project=locker-staging --format '{{.Names}} {{.Image}} {{.Status}}'
```

On a failed application switch the receiver attempts to restore both saved images, checks their immutable IDs and health, and marks the workflow failed even if recovery succeeded. For a manual application rollback after a healthy deployment, disable both switches, verify the journal corresponds to the intended deployment, and run:

```sh
sudo /opt/lockerreserve-cd/scripts/staging/cd.py rollback
```

Rollback changes the API and web only. It retains the schema, payments, command journal, Caddy certificates and all volumes. A migration failure leaves the journal at **migrating** and blocks new releases. A failed rollback leaves **switching**. Investigate privately using the saved SHA, image IDs, backup path and Prisma ledger. Reconcile failed SQL and verify the running pair before repairing the journal under change approval. Never discard the journal to make CI green. A database restore can lose writes since backup and requires explicit operator approval.

If publication fails, check package write access and the public test-key variable. For transfer failures check the pinned SSH hostname, forced command, file permissions and read-only registry login. For a rejected release check main HEAD, controller version, image labels, disk, migration approval, proxy health and pulse ceilings. Avoid logging expanded Compose configuration or unfiltered container environments.

## Validation and dependencies

Run `python3 scripts/staging/test-cd.py` for failure injection. Run `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_ci_fixture sh scripts/staging/release-images.sh verify` for local image checks. The disposable integration suite is `python3 scripts/staging/test-local.py --build`; it requires free loopback ports 58080 and 58443 and refuses to use an existing fixture project.

At the November 24, 2026 Phase A check on 40adef1, npm audit --omit=dev reported four high API findings and zero web findings. PR #17 updated dependencies after the earlier dependency review. Remediation remains separate from CD. See [the dependency review](security/dependency-review-20261119.md) and [the staging operations guide](linux-staging.md).
