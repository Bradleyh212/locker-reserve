#!/usr/bin/env python3
"""Read-only config checks. Never print interpolated configuration or secret contents."""
import ipaddress
import json
from pathlib import Path
import re
import stat
import subprocess


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def verify(c):
    s = c['services']
    require(set(s) == {'api', 'web', 'migrate', 'db', 'redis', 'caddy'}, 'Unexpected services')
    for name, service in s.items():
        require(not service.get('privileged'), 'Privileged service')
        if name != 'caddy':
            require(not service.get('ports'), 'Only Caddy may publish ports')
    require(c['networks']['data']['internal'] and c['networks']['proxy']['internal'], 'Private networks required')
    api = s['api']['environment']
    proxy = s['caddy']['environment']
    require(api['DEVICE_MAX_PULSE_MS'] == '0' and api['CUSTOMER_UNLOCK_PULSE_MS'] == '0', 'Actuation must stay disabled')
    require(api['NODE_ENV'] == 'production', 'Secure cookies require production mode')
    require(re.fullmatch(r'pk_test_[A-Za-z0-9_]+', s['web']['build']['args']['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY']), 'Test publishable key required')
    for key in ['WEB_DOMAIN', 'API_DOMAIN']:
        require(re.fullmatch(r'[a-z0-9][a-z0-9.-]*\.[a-z0-9-]+', proxy[key]), 'Use bare DNS hostnames')
    require(proxy['WEB_DOMAIN'] != proxy['API_DOMAIN'], 'Domains must differ')
    require(api['CORS_ORIGIN'] == 'https://' + proxy['WEB_DOMAIN'], 'Exact web CORS origin required')
    require(s['web']['build']['args']['NEXT_PUBLIC_API_BASE_URL'] == api['CORS_ORIGIN'] + '/api', 'Same-origin browser API required')
    require(str(ipaddress.ip_address(api['TRUSTED_PROXY_IP'])) == s['caddy']['networks']['proxy']['ipv4_address'], 'Proxy trust peer mismatch')
    networks = [ipaddress.ip_network(x['subnet']) for x in c['networks']['proxy']['ipam']['config']]
    require(any(ipaddress.ip_address(api['TRUSTED_PROXY_IP']) in n for n in networks), 'Proxy peer outside network')
    require(bool(proxy['STAGING_ALLOWED_CIDRS'].strip()), 'Empty allowlist')
    dynamic = ipaddress.ip_network(c['networks']['proxy']['ipam']['config'][0]['ip_range'])
    require(ipaddress.ip_address(api['TRUSTED_PROXY_IP']) not in dynamic, 'Proxy IP overlaps dynamic allocations')
    for cidr in proxy['STAGING_ALLOWED_CIDRS'].split():
        n = ipaddress.ip_network(cidr, strict=False)
        require(n.prefixlen >= (24 if n.version == 4 else 64), 'Use narrow staging IP allowlists')
    for secret in c['secrets'].values():
        file = Path(secret['file'])
        require(file.is_absolute() and file.is_file(), 'Private secret file missing')
        require(not (file.stat().st_mode & stat.S_IWOTH), 'Secret must not be world writable')
    return True


if __name__ == '__main__':
    try:
        root = Path(__file__).resolve().parents[2]
        result = subprocess.run(['sh', str(root / 'scripts/staging/compose.sh'), '--profile', 'tools', 'config', '--format', 'json'], check=True, capture_output=True)
        verify(json.loads(result.stdout))
        print('Staging configuration checks passed; no secrets printed.')
    except Exception:
        raise SystemExit('Staging preflight failed. Check private configuration and deployment runbook; no values printed.')
