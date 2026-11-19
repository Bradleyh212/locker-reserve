# Public cloud trust anchors

Downloaded 2026-11-19 from the PEM links on
[Let's Encrypt's chain documentation](https://letsencrypt.org/certificates/):

- `https://letsencrypt.org/certs/isrgrootx1.pem` — self-signed ISRG Root X1
- `https://letsencrypt.org/certs/isrg-root-x2.pem` — self-signed ISRG Root X2

`firmware-cloud.py` verifies their DER SHA-256 fingerprints before use. These are
public CA certificates, not device credentials. Trust both roots to accommodate
RSA/ECDSA issuer rotation and cross-signing. Do not pin the leaf or intermediate.

Observed API chain: api-staging.lockerreserve.com → YE1 → Root YE → X2 (cross-signed
by X1). Strict hostname/chain verification passed with this bundle. Leaf valid
2026-11-18 to 2027-02-16. This is a dated observation, not a renewal guarantee.
Recheck before flashing and after CA changes. New roots require a reviewed bundle
update and a separately authorized flash; never download trust dynamically from
an unverified connection. Root-program trust may end before certificate notAfter
(X1 planned trust ends 2030; X2 2035); review annually, not just at PEM expiry.
