"""Local administrator operations. The SSH receiver never invokes this module."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import tempfile

import cd

CADDY_PATH = '/etc/caddy/Caddyfile'
OTA_PATHS = ' '.join('/v1/device/firmware/' + path for path in (
    'next', 'updates/*/download', 'updates/*/progress', 'updates/*/result')) + ' '


def apply_api(value, ref):
    os.environ['OTA_ENABLED'] = value
    cd.compose('up', '-d', '--no-deps', '--no-build', '--pull', 'never',
               '--force-recreate', '--wait', '--wait-timeout', '180', 'api')
    cd.require(cd.info('api') == cd.iid(ref), 'API image mismatch')
    cd.compose('exec', '-T', 'api', 'node', '-e',
               "const e=process.env;process.exit(e.OTA_ENABLED===process.argv[1] && "
               "e.DEVICE_MAX_PULSE_MS==='0' && e.CUSTOMER_UNLOCK_PULSE_MS==='0' ? 0 : 1)", value)


def window(value, refs):
    marker = cd.STATE / 'ota-window.json'
    # Persist the interlock before the first mutation, including a retry after a crash.
    cd.save(marker.name, {'api': refs['api']})
    try:
        apply_api(value, refs['api'])
    except Exception:
        if value == 'true':
            apply_api('false', refs['api'])
            marker.unlink()
        raise
    if value == 'false':
        marker.unlink()


def proxy_config():
    cid = cd.compose('ps', '-q', 'caddy')
    current = json.loads(cd.run('docker', 'inspect', cid))[0]
    cfg = json.loads(cd.compose('config', '--format', 'json'))
    desired = cfg['services']['caddy']
    env = dict(v.split('=', 1) for v in current['Config']['Env'])
    cd.require(all(env.get(k) == v for k, v in desired['environment'].items())
               and current['Image'] == cd.iid(desired['image']), 'Proxy image or environment drift')
    mounted = {m['Destination']: m for m in current['Mounts']}
    bind = mounted[CADDY_PATH]
    cd.require(bind['Type'] == 'bind' and not bind['RW'], 'Unexpected Caddyfile mount')
    for v in desired['volumes']:
        if v['type'] == 'volume':
            cd.require(mounted[v['target']]['Name'] == cfg['volumes'][v['source']]['name'],
                       'Proxy storage differs')
    print('Live Caddyfile mount:', bind['Source'])
    # Read the mounted inode. Its host pathname may already point to a replacement.
    return cid, subprocess.check_output(['docker', 'exec', cid, 'cat', CADDY_PATH])


def proxy_switch(file, firmware):
    override = {'services': {'caddy': {'volumes': [
        {'type': 'bind', 'source': str(file), 'target': CADDY_PATH, 'read_only': True}]}}}
    overlay = file.with_suffix('.json')
    overlay.write_text(json.dumps(override))
    cd.compose('-f', str(overlay), 'up', '-d', '--no-build', '--pull', 'never', '--no-deps',
               '--force-recreate', '--wait', '--wait-timeout', '120', 'caddy')
    cid, live = proxy_config()
    cd.require(live == file.read_bytes(), 'Proxy file mismatch')
    cd.compose('exec', '-T', 'caddy', 'wget', '-q', '-O', '/dev/null', 'http://api-proxy:3001/health')
    paths = ['/v1/device/commands/next']
    if firmware:
        paths.append('/v1/device/firmware/next')
    for path in paths:
        cd.require(proxy_status(path) == '401', 'Expected device authentication boundary')


def proxy_status(path):
    host = 'api-staging.lockerreserve.com'
    return cd.run('curl', '-sS', '--max-time', '10', '--resolve', host + ':443:127.0.0.1',
                  '-o', '/dev/null', '-w', '%{http_code}', 'https://' + host + path)


def validate_proxy(cid, file):
    with file.open('rb') as src:
        cd.require(subprocess.run(['docker', 'exec', '-i', cid, 'caddy', 'validate', '--config',
                                   '-', '--adapter', 'caddyfile'], stdin=src,
                                  capture_output=True).returncode == 0, 'Proxy candidate rejected')


def proxy(operation):
    backup = cd.STATE / 'ota-proxy-before.Caddyfile'
    candidate = cd.STATE / 'ota-proxy-reviewed.Caddyfile'
    reviewed = (cd.ROOT / 'infra/staging/Caddyfile').read_bytes()
    cd.require(reviewed.count(OTA_PATHS.encode()) == 1, 'Review firmware matcher')
    previous = reviewed.replace(OTA_PATHS.encode(), b'')
    if operation == 'proxy-recover':
        cd.require(backup.read_bytes() == previous, 'Recovery source differs from reviewed baseline')
        proxy_switch(backup, False)
        return
    cid, live = proxy_config()
    cd.require(live == previous, 'Live file differs from reviewed pre-OTA policy')
    for file, data in ((backup, live), (candidate, reviewed)):
        if file.exists():
            cd.require(file.read_bytes() == data, 'Maintenance snapshot differs')
        else:
            with file.open('xb') as out:
                out.write(data)
                out.flush()
                os.fsync(out.fileno())
    validate_proxy(cid, candidate)
    try:
        proxy_switch(candidate, True)
    except Exception:
        proxy_switch(backup, False)
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=('open', 'close', 'proxy-apply', 'proxy-recover',
                                              'backup', 'restore-check'))
    parser.add_argument('bundle', nargs='?', type=Path)
    args = parser.parse_args()
    cd.require(os.geteuid() == 0 and 'SSH_ORIGINAL_COMMAND' not in os.environ, 'Local root required')
    cd.require(bool(args.bundle) == (args.operation in ('backup', 'restore-check')), 'Invalid bundle argument')
    os.umask(0o077)
    os.chdir(cd.ROOT)
    os.environ.update(STAGING_PROJECT_NAME='locker-staging', STAGING_ENV_FILE=str(cd.CONFIG/'compose.env'))
    with (cd.STATE/'deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        record = cd.read('release.json')
        cd.require(record and record['phase'] == 'healthy', 'Healthy release required')
        os.environ['RELEASE_ID'] = record['active_sha']
        cd.require(cd.run('git', 'rev-parse', 'HEAD') == record['active_sha']
                   and not cd.run('git', 'status', '--porcelain'), 'Reviewed active checkout required')
        with tempfile.TemporaryDirectory(dir=cd.STATE) as temp:
            images = Path(temp)/'images.json'
            images.write_text(json.dumps({'services': {s: {'image': v} for s,v in record['refs'].items()}}))
            os.environ['STAGING_IMAGES_FILE'] = str(images)
            if args.operation in ('open', 'close'):
                if args.operation == 'open':
                    cd.verify_apps(record['refs'])
                window('true' if args.operation == 'open' else 'false', record['refs'])
            elif args.operation.startswith('proxy'):
                proxy(args.operation)
            else:
                base = cd.STATE / 'ota-backups'
                base.mkdir(mode=0o700, exist_ok=True)
                cd.require(args.bundle.is_absolute() and args.bundle.resolve().parent == base
                           and not args.bundle.is_symlink() and base.resolve() == base
                           and base.stat().st_uid == 0 and (base.stat().st_mode & 0o777) == 0o700,
                           'Use a direct child of the private OTA backup directory')
                import firmware_backup
                firmware_backup.execute(args.operation, args.bundle, record['refs']['api'])
    print('Maintenance checks passed.')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        raise SystemExit(str(exc) if isinstance(exc, cd.ReleaseError) else
                         'Maintenance stopped. Inspect service health and retained recovery files privately.')
