# API dependency review — 2026-11-19

Scope: cloud branch `c056f8c`, deployed API `c7340a8`. Review only; no package,
lockfile, image, running service or security configuration was changed. Registry
and reviewed advisories were checked on this date. No exploit/crash traffic was
sent to staging. Findings below separate installed code from reachable behavior;
reachability conclusions are code/configuration inferences, not penetration tests.

`npm audit --omit=dev` reports **eight affected package entries**, not eight
independent vulnerabilities: one critical, six high, one moderate. Parent entries
inherit underlying findings; some packages have multiple advisories. The deployed
API contains all eight, including Prisma tooling pulled through the client peer
relationship despite an omit-dev install. Exact deployed versions were checked
inside the running container without printing environment secrets.

| Installed package | Audit severity | Current application exposure | Available fix and priority |
| --- | --- | --- | --- |
| `proxy-addr@2.0.7` | Critical | Used by Express proxy trust. Advisory needs a malformed IPv6 trust subnet; staging uses exact `172.30.88.2`, rejects subnet configuration, has no public API binding and Caddy replaces forwarding headers. The stated exploit prerequisite is absent. | `2.0.8`; **P1**, include in the prompt targeted security patch, preserving exact-peer policy. |
| `body-parser@2.2.2` | High | Nest registers parsers before routing/authentication. Compressed request-body handling is enabled; public device/webhook paths are reachable. Compressed trailing bytes can crash a worker. Caddy body limits do not remove this small-payload error path. | `2.4.0`; **P1 / first remediation**, likely externally reachable availability risk. No destructive live verification. |
| `multer@2.1.1` | High | Installed by the Nest adapter. No application upload interceptors, MulterModule or multipart middleware were found; no reachable upload route identified. The newest listed issue additionally needs an asynchronous fileFilter. | `2.5.0`; **P2**, before adding uploads. Nest 11.2.11 pins this fixed version. |
| `@nestjs/platform-express@11.1.19` | High, inherited | Parent of the vulnerable Multer version; not a separate discovered vulnerability. | Consider coordinated **Nest 11.2.11** core/common/adapter maintenance update, with peer compatibility tests. Do not jump to Nest 12 just because it is latest. P2 for this inherited finding. |
| `qs@6.15.1` | Moderate | Installed in Express/body-parser. No application comma-mode stringify/parse round-trip was found. Listed crashes need specific stringify inputs/options; array-limit bypass needs comma parsing. Those preconditions were not identified in the application. | `6.16.1` covers the four listed findings; **P2**, can accompany the targeted parser/proxy lockfile refresh. |
| `deepmerge-ts@7.1.5` | High | Prisma configuration dependency. The finding needs recursive object graphs. Plain JSON cannot supply cycles; no application request path into deepmerge was found. Tooling reads trusted operator-controlled configuration. | `8.0.0`; **P2** tooling remediation. Do not force an untested major transitive override. |
| `@prisma/config@6.19.3` | High, inherited | Prisma tooling parent of deepmerge; not a separate HTTP exposure. | Audit proposes Prisma `7.10.1` as parent fix; **P2**, separate planned Prisma upgrade/packaging review, not this firmware PR. |
| `prisma@6.19.3` | High, inherited | CLI/config tooling is present in the API image but no server endpoint runs it on request data. Trusted migration/provisioning operations are the identified consumers. | Same planned `7.10.1` candidate, coordinated with client/generator/engine and migration compatibility; **P2**. |

P1 means prepare a narrow security fix promptly and request an approved deployment.
P2 means scheduled maintenance with compatibility validation; installed packages
still need patching even when the current application lacks the vulnerable path.
Do not interpret current mitigations as a clean dependency audit.

## Critical proxy-trust assessment

[GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)
affects IPv4-mapped IPv6 trust subnets with incorrect short prefixes, or IPv6
subnets with zero leading bits. Our `configureProxy` accepts a single literal IP
via `isIP` and rejects subnet syntax. Runtime confirmed the exact IPv4 Caddy peer.
A local check with the installed package trusted that peer and its mapped spelling,
but rejected unrelated IPv4 and mapped IPv4 addresses. Existing proxy HTTP tests
also reject forwarded HTTPS from an untrusted peer.

Caddy's private-site gate uses the socket remote IP, not Express's req.ip. Caddy
replaces X-Forwarded-For/Proto/Host, strips Forwarded, and API/web ports remain
unpublished. Consequently the advisory does not currently demonstrate an admin
allowlist bypass here. Patch nonetheless to avoid future configuration hazards.

## Highest practical risk: request parsing

[GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)
is an unauthenticated compressed-body crash. Parsing precedes bearer/Stripe
signature checks, so those checks do not mitigate it. A crafted compressed stream
may fail after parsing has finished and terminate the process. Runtime has the
affected version and default inflation; the machine endpoints are public by
design. This is a **likely reachable** path, not a verified hosted crash.

`body-parser@2.4.0` also covers the older invalid-limit advisory
[GHSA-v422-hmwv-36x6](https://github.com/advisories/GHSA-v422-hmwv-36x6).
The application does not supply an invalid limit, so that older path was not found.
Disabling compressed request parsing is a documented workaround but would require
an approved source/configuration change and signed-webhook compatibility tests.
No such workaround was applied during this review.

## Other advisory sources and fixed-version checks

- Multer: current findings include [nested fields](https://github.com/advisories/GHSA-72gw-mp4g-v24j),
  [aborted upload cleanup](https://github.com/advisories/GHSA-3p4h-7m6x-2hcm),
  [crafted fields](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm),
  [file-size race](https://github.com/advisories/GHSA-qvfw-j98x-7q72),
  [oversized index](https://github.com/advisories/GHSA-535w-7cp7-47q4), and
  [async-filter teardown](https://github.com/advisories/GHSA-q7qp-rjg7-q26m).
  Version 2.5.0 covers these; no active upload middleware was found.
- qs: [null/comma stringify](https://github.com/advisories/GHSA-q8mj-m7cp-5q26),
  [comma array-limit bypass](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx),
  [isBuffer round-trip](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g), and
  [own toString/comma stringify](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw).
  The last requires 6.16.1; stopping at 6.16.0 leaves it unresolved.
- Deepmerge: [recursive graph exhaustion](https://github.com/advisories/GHSA-ggr8-5vv4-36mx),
  fixed 8.0.0. No request-derived cyclic configuration objects were found.

The registry confirmed availability of proxy-addr 2.0.8, body-parser 2.4.0,
multer 2.5.0, qs 6.16.1 and Prisma 7.10.1. Installed Express 5.2.1 permits the three
proxy/parser/qs fixes through its existing semver ranges; a **targeted lockfile
refresh** is preferable to a broad upgrade, with actual resolved versions reviewed.
Nest 11.2.11 still pins Express 5.2.1 but updates Multer to 2.5.0. Nest 11.1.28 is
insufficient for all current Multer advisories (pins 2.2.0). Express 5.3.0 declares
body-parser^2.3.0, so a parent-version bump alone is also insufficient: verify the
lockfile resolves 2.4.0 or newer. No packages were installed or upgraded to test
these candidates during the review.

## Recommended follow-up, separately approved

1. Patch proxy-addr/body-parser/qs narrowly, review the exact lockfile diff and
   rerun proxy spoofing, raw signed Stripe payload, ownership, booking, recovery,
   device protocol and zero-pulse regressions. Test malformed compressed bodies
   only in a disposable subprocess/container, never the live staging API.
2. Review coordinated Nest 11 maintenance for Multer and all peer dependencies.
3. Review Prisma 7 migration requirements separately. Consider excluding unused
   CLI/config tooling from the API runtime while retaining the trusted migrator;
   validate generated client/engine packaging before changing installation flags.
4. Build reviewed immutable images, back up/verify restore under the runbook,
   then request approval for deployment. Dependency fixes require a new image;
   today's simulator verification did not require or perform one.
