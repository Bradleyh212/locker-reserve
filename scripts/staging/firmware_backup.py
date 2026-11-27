"""Paired immutable-blob and PostgreSQL backups. Restore drills use new destinations only."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import uuid

import cd

HASH = r'[0-9a-f]{64}'
MAX = 0x140000


def volume_cmd(image, volume, script, *args, write=False, root=False):
    mount = 'type=volume,src=' + volume + ',dst=/firmware' + ('' if write else ',readonly')
    return ['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--read-only',
            '--user', '0' if root else 'node', '--mount', mount, '--entrypoint', 'node', image,
            '-e', "const fs=require('fs');process.chdir('/firmware');" + script, *args]


def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def check_blob(name, path):
    cd.require(re.fullmatch(HASH + r'\.bin', name) and not path.is_symlink()
               and path.is_file() and 0 < path.stat().st_size <= MAX
               and (path.stat().st_mode & 0o777) == 0o600
               and digest(path) == name[:-4], 'Firmware blob invalid')


def verify_metadata(database, folder):
    query = 'SELECT "fileName",sha256,"sizeBytes" FROM "FirmwareRelease"'
    rows = cd.compose('exec', '-T', 'db', 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1',
                      '-U', 'locker', '-d', database, '-c', query)
    for row in rows.splitlines():
        name, checksum, size = row.split('|')
        cd.require(re.fullmatch(HASH, checksum) and name == checksum + '.bin'
                   and (folder/name).stat().st_size == int(size), 'Firmware metadata mismatch')


def backup(folder, image):
    folder.mkdir(mode=0o700)  # A previous or interrupted backup is never overwritten.
    blobs = folder/'blobs'
    blobs.mkdir(mode=0o700)
    mount = json.loads(cd.run('docker', 'inspect', cd.compose('ps', '-q', 'api')))[0]['Mounts']
    volume, = [m for m in mount if m['Destination'] == '/firmware']
    cd.require(volume['Type'] == 'volume' and not volume['RW'], 'Expected read-only API firmware volume')
    cd.run('sh', str(cd.ROOT/'scripts/staging/backup.sh'), str(folder/'database.dump'))
    names = json.loads(cd.run(*volume_cmd(image, volume['Name'],
                          "console.log(JSON.stringify(fs.readdirSync('.')))")))
    for name in names:
        cd.require(re.fullmatch(HASH + r'\.bin', name), 'Unexpected publication in progress or volume entry')
        script = """const file=fs.openSync(process.argv[1],fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
const s=fs.fstatSync(file);
if(!s.isFile() || s.size>1310720 || (s.mode&511)!==384 || s.uid!==process.getuid())process.exit(1);
process.stdout.write(fs.readFileSync(file));"""
        with (blobs/name).open('xb') as out:
            subprocess.run(volume_cmd(image, volume['Name'], script, name), stdout=out, check=True)
        check_blob(name, blobs/name)
    verify_metadata('locker_staging', blobs)
    # Written last. Partial bundles are ineligible for recovery.
    (folder/'manifest.json').write_text(json.dumps({'dump': digest(folder/'database.dump'),
                                                    'blobs': sorted(names)}))


def restore(folder, image):
    cd.require(folder.is_dir() and not folder.is_symlink() and
               all(p.stat().st_uid == os.geteuid() and not p.is_symlink() and
                   not (p.stat().st_mode & 0o077) for p in [folder, *folder.rglob('*')]),
               'Expected private operator-owned backup')
    manifest = json.loads((folder/'manifest.json').read_text())
    blobs = folder/'blobs'
    cd.require(manifest['dump'] == digest(folder/'database.dump') and
               manifest['blobs'] == sorted(p.name for p in blobs.iterdir()), 'Incomplete or damaged bundle')
    for name in manifest['blobs']:
        check_blob(name, blobs/name)
    suffix = uuid.uuid4().hex
    database = 'restore_ota_' + suffix
    volume = 'restore-ota-' + suffix
    print('Isolated recovery destinations:', database, volume, flush=True)
    cd.compose('exec', '-T', 'db', 'createdb', '-U', 'locker', database)
    with (folder/'database.dump').open('rb') as dump:
        subprocess.run(['sh', str(cd.ROOT/'scripts/staging/compose.sh'), 'exec', '-T', 'db',
                        'pg_restore', '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl',
                        '-U', 'locker', '-d', database], stdin=dump, check=True, stderr=subprocess.DEVNULL)
    verify_metadata(database, blobs)
    cd.require(not cd.run('docker','volume','ls','-q','--filter','name=^'+volume+'$'), 'Scratch volume exists')
    cd.run('docker', 'volume', 'create', '--label', 'lockerreserve.restore-check=true', volume)
    uid = cd.run('docker','run','--rm','--network','none','--entrypoint','id',image,'-u','node')
    gid = cd.run('docker','run','--rm','--network','none','--entrypoint','id',image,'-g','node')
    cd.run(*volume_cmd(image, volume, "fs.chownSync('.',+process.argv[1],+process.argv[2]);"
                       "fs.chmodSync('.',0o700)", uid, gid, write=True, root=True))
    for name in manifest['blobs']:
        with (blobs/name).open('rb') as src:
            cmd = volume_cmd(image, volume, "fs.writeFileSync(process.argv[1],fs.readFileSync(0),"
                             "{flag:'wx',mode:0o600})", name, write=True)
            subprocess.run(cmd[:2]+['-i']+cmd[2:], stdin=src, check=True)
        actual = cd.run(*volume_cmd(image, volume, "const p=process.argv[1];if((fs.statSync(p).mode&511)!==384)"
                        "process.exit(1);console.log(require('crypto').createHash('sha256')"
                        ".update(fs.readFileSync(p)).digest('hex'))", name))
        cd.require(actual == name[:-4], 'Restored firmware digest mismatch')
    return database, volume


def execute(operation, folder, image):
    cd.require(folder.is_absolute(), 'Use an absolute backup directory')
    if operation == 'backup':
        backup(folder, image)
    else:
        restore(folder, image)
