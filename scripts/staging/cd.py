#!/usr/bin/env python3
"""Root-owned, forced-command staging receiver. No shell commands from SSH."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
STATE = Path('/var/lib/lockerreserve-cd')
CONFIG = Path('/etc/locker-staging')
PREFIX = 'ghcr.io/bradleyh212/locker-reserve'
SOURCE = 'https://github.com/Bradleyh212/locker-reserve'
SERVICES = ('api', 'web', 'migrate')
APPS = ('api', 'web')
SHA = r'[0-9a-f]{40}'
DIGEST = r'sha256:[0-9a-f]{64}'


class ReleaseError(Exception):
    """A diagnostic safe for the Actions log."""


def require(ok, message):
    if not ok:
        raise ReleaseError(message)


def run(*args, data=None):
    # Even Compose errors and migration diagnostics may contain private URLs.
    result = subprocess.run(args, input=data, text=True, capture_output=True, timeout=600)
    if result.returncode:
        raise ReleaseError(f'{Path(args[0]).name} operation failed (exit {result.returncode})')
    return result.stdout.strip()


def compose(*args):
    return run('sh', str(ROOT / 'scripts/staging/compose.sh'), *args)


def save(name, obj):
    path = STATE / name
    with tempfile.NamedTemporaryFile(mode='w', dir=STATE, delete=False) as tmp:
        json.dump(obj, tmp)
        tmp.flush()
        os.fsync(tmp.fileno())
    os.replace(tmp.name, path)
    fd = os.open(STATE, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def read(name):
    path = STATE / name
    return json.loads(path.read_text()) if path.exists() else None


def override(refs):
    save('images.json', {'services': {s: {'image': ref} for s, ref in refs.items()}})
    os.environ['STAGING_IMAGES_FILE'] = str(STATE / 'images.json')


def parse(command):
    parts = command.split()
    require(len(parts) == 5 and parts[0] == 'deploy' and re.fullmatch(SHA, parts[1])
            and all(re.fullmatch(DIGEST, d) for d in parts[2:]), 'Invalid release request')
    return parts[1], {s: f'{PREFIX}-{s}@{d}' for s, d in zip(SERVICES, parts[2:])}


def main_head(sha):
    run('git', 'fetch', '--quiet', 'origin', 'refs/heads/main')
    require(run('git', 'rev-parse', 'FETCH_HEAD') == sha, 'Release superseded or outside main')
    require(not run('git', 'status', '--porcelain', '--untracked-files=no'), 'Dirty controller')
    run('git', 'diff', '--quiet', 'HEAD', sha, '--', 'infra/staging', 'scripts/staging')
    # Infrastructure/control-plane changes need a reviewed controller installation.


def info(svc):
    cid = compose('ps', '-q', svc)
    require(cid, f'{svc} is unavailable')
    image, status = run('docker', 'inspect', '-f', '{{.Image}} {{.State.Health.Status}}', cid).split()
    require(status == 'healthy', f'{svc} is unhealthy')
    return image


def iid(ref):
    return run('docker', 'image', 'inspect', '-f', '{{.Id}}', ref)


def verify_apps(refs):
    for svc in ('db', 'redis', 'caddy', *APPS):
        image = info(svc)
        if svc in APPS:
            require(image == iid(refs[svc]), f'Unexpected running {svc} image')
    # Execute private upstream GETs from the proxy network. Public vhosts
    # still use TLS, hostname verification and the existing IP allowlist.
    for upstream in ('http://api-proxy:3001/health', 'http://web-proxy:3000/book'):
        compose('exec', '-T', 'caddy', 'wget', '-q', '-O', '/dev/null', upstream)
    for host, path in [('staging.lockerreserve.com', '/book'), ('api-staging.lockerreserve.com', '/health')]:
        status = run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '10',
                     '--resolve', f'{host}:443:127.0.0.1', f'https://{host}{path}')
        require(status in ('200', '403'), 'Unexpected Caddy virtual-host response')


def preflight(sha, refs):
    main_head(sha)
    override(refs)
    run('python3', str(ROOT / 'scripts/staging/preflight.py'))
    cfg = json.loads(compose('--profile', 'tools', 'config', '--format', 'json'))
    require(all(cfg['services'][svc]['image'] == ref for svc, ref in refs.items()),
            'Compose image overrides do not match release')
    require(all(Path(secret['file']).resolve().is_relative_to(CONFIG) for secret in cfg['secrets'].values()),
            'Expected root-managed staging secrets')
    args = cfg['services']['web']['build']['args']
    require(args['NEXT_PUBLIC_API_BASE_URL'] == 'https://staging.lockerreserve.com/api', 'Wrong staging URL')
    keyhash = hashlib.sha256(args['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'].encode()).hexdigest()
    db_size = int(sql("SELECT pg_database_size(current_database())"))
    for folder in (STATE, Path(run('docker', 'info', '-f', '{{.DockerRootDir}}'))):
        require(shutil.disk_usage(folder).free >= 3 * 1024**3 + db_size, 'Insufficient disk for release and backup')
    for svc, ref in refs.items():
        run('docker', 'pull', '--platform', 'linux/amd64', ref)
        metadata = json.loads(run('docker', 'image', 'inspect', ref))[0]
        labels = metadata['Config']['Labels']
        require(ref in metadata['RepoDigests'] and metadata['Architecture'] == 'amd64'
                and metadata['Os'] == 'linux' and labels.get('org.opencontainers.image.source') == SOURCE
                and labels.get('org.opencontainers.image.revision') == sha
                and labels.get('org.lockerreserve.service') == svc
                and labels.get('org.lockerreserve.public-key-sha256') == keyhash, f'{svc} provenance/config mismatch')


def sql(query):
    return compose('exec', '-T', 'db', 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1',
                   '-U', 'locker', '-d', 'locker_staging', '-c', query)


def migrations(sha):
    names = run('git', 'ls-tree', '-d', '--name-only', f'{sha}:services/api/prisma/migrations').splitlines()
    require(names and all(re.fullmatch(r'[0-9]{14}_[a-z0-9_]+', n) for n in names), 'Review migration layout')
    rows = sql('SELECT migration_name, checksum, finished_at IS NOT NULL FROM "_prisma_migrations" '
               'WHERE rolled_back_at IS NULL ORDER BY migration_name').splitlines()
    applied = []
    for row in rows:
        name, checksum, finished = row.split('|')
        require(name in names and finished == 't', 'Migration history requires reconciliation')
        blob = subprocess.check_output(['git', 'show', f'{sha}:services/api/prisma/migrations/{name}/migration.sql'])
        require(hashlib.sha256(blob).hexdigest() == checksum, 'Historical migration checksum mismatch')
        applied.append(name)
    require(applied == names[:len(applied)], 'Migration history has gaps')
    return names[len(applied):]


def snapshot():
    previous = {}
    revisions = set()
    for svc in APPS:
        image = info(svc)
        revision = run('docker', 'image', 'inspect', '-f', '{{index .Config.Labels "org.opencontainers.image.revision"}}', image)
        if not re.fullmatch(SHA, revision):
            tag = run('docker', 'inspect', '-f', '{{.Config.Image}}', compose('ps', '-q', svc))
            require(re.fullmatch(f'locker-staging-{svc}:' + SHA, tag), 'Cannot identify previous release')
            revision = tag.rsplit(':', 1)[1]
        revisions.add(revision)
        ref = f'locker-cd-rollback-{svc}:{image.split(":")[1]}'
        run('docker', 'tag', image, ref)
        previous[svc] = ref
    verify_apps(previous)
    require(len(revisions) == 1, 'Running application revisions differ')
    return previous, revisions.pop()


def switch(refs):
    override(refs)
    compose('up', '-d', '--no-build', '--pull', 'never', '--no-deps', '--wait',
            '--wait-timeout', '180', *APPS)
    verify_apps(refs)


def rollback(record):
    # Recheck immutable local IDs before touching either service.
    for ref in record['previous'].values():
        require(iid(ref) == 'sha256:' + ref.rsplit(':', 1)[1], 'Rollback image missing or replaced')
    require(not migrations(record['sha']), 'Schema changed since release; operator review required')
    switch(record['previous'])
    save('release.json', {**record, 'phase': 'rolled-back', 'active_sha': record['previous_sha']})
    print('Previous healthy API and web image IDs restored; database retained.')


def backup_release(sha):
    folder = Path(tempfile.mkdtemp(prefix=f'{sha[:12]}-', dir=STATE))
    backup = str(folder / 'predeploy.dump')
    run('sh', str(ROOT / 'scripts/staging/backup.sh'), backup)
    expected = Path(backup + '.sha256').read_text().split()[0]
    require(run('sha256sum', backup).split()[0] == expected, 'Backup checksum mismatch')
    # Decode the full archive; pg_restore --list alone checks only its catalog.
    with open(backup, 'rb') as dump:
        subprocess.run(['sh', str(ROOT / 'scripts/staging/compose.sh'), 'exec', '-T', 'db',
                        'pg_restore', '--file=/dev/null'], stdin=dump, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, check=True, timeout=600)
    return backup


def deploy(sha, refs):
    record = read('release.json')
    require(not record or record['phase'] in ('healthy', 'rolled-back'), 'Incomplete release; inspect journal first')
    preflight(sha, refs)
    if record and record['phase'] == 'healthy' and record['refs'] == refs:
        verify_apps(refs)
        return
    previous, previous_sha = snapshot()
    pending = migrations(sha)
    if pending:
        approval = CONFIG / 'cd-migrations' / sha
        require(approval.is_file() and approval.read_text().splitlines() == pending,
                'Pending migrations need exact backward-compatibility approval')
    backup = backup_release(sha)
    main_head(sha)
    record = dict(sha=sha, refs=refs, previous=previous, previous_sha=previous_sha, backup=backup, phase='migrating')
    save('release.json', record)
    compose('--profile', 'tools', 'run', '--rm', '--no-deps', '--pull', 'never', 'migrate')
    require(not migrations(sha), 'Migrations incomplete; operator review required')
    record['phase'] = 'switching'
    save('release.json', record)
    try:
        switch(refs)
    except Exception:
        rollback(record)
        raise
    save('release.json', {**record, 'phase': 'healthy', 'active_sha': sha})
    print(f'Staging {sha}: api/web revision verified; db/redis/caddy healthy.')


def require_closed_window():
    require(not (STATE / 'ota-window.json').exists(), 'Close the supervised OTA window before deployment or rollback')


def main():
    os.umask(0o077)
    os.chdir(ROOT)
    os.environ['STAGING_ENV_FILE'] = str(CONFIG / 'compose.env')
    os.environ.pop('STAGING_IMAGES_FILE', None)
    os.environ['STAGING_PROJECT_NAME'] = 'locker-staging'
    operator = sys.argv[1:] == ['rollback']
    if not operator:
        require(not sys.argv[1:], 'Unknown operation')
        sha, refs = parse(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
        os.environ['RELEASE_ID'] = sha
    STATE.mkdir(mode=0o700, exist_ok=True)
    with (STATE / 'deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require_closed_window()
        os.environ['OTA_ENABLED'] = 'false'
        if operator:
            record = read('release.json')
            require(record and record['phase'] in ('healthy', 'switching'), 'Operator reconciliation required')
            os.environ['RELEASE_ID'] = record['sha']
            if record['phase'] == 'healthy':
                for svc in APPS:
                    cid = compose('ps', '-q', svc)
                    require(cid and run('docker', 'inspect', '-f', '{{.Image}}', cid) == iid(record['refs'][svc]),
                            'Running release changed; operator reconciliation required')
            rollback(record)
        else:
            deploy(sha, refs)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(str(exc) if isinstance(exc, ReleaseError) else
              'Deployment stopped. Inspect release journal and service health privately.', file=sys.stderr)
        sys.exit(1)
