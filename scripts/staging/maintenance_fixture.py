"""Checks performed only on the test-local.py disposable project."""
import hashlib
import os
from unittest.mock import patch

import cd
import firmware_backup
import maintenance


def exercise_proxy(temp, env, status):
    assert env['STAGING_PROJECT_NAME'] == 'locker-staging-validation'
    state = temp/'proxy-controller'
    state.mkdir(mode=0o700)
    with patch.dict(os.environ, env), patch.object(cd, 'STATE', state):
        def https(path):
            return str(status('api-staging.localhost', path))

        def fail_candidate(path):
            return '503' if path.endswith('/firmware/next') else https(path)

        assert https('/v1/device/firmware/next') == '403'
        original = maintenance.proxy_config()[1]
        with patch.object(maintenance, 'proxy_status', fail_candidate):
            try:
                maintenance.proxy('proxy-apply')
            except cd.ReleaseError:
                assert maintenance.proxy_config()[1] == original
            else:
                raise AssertionError('Failed proxy check unexpectedly passed')
        with patch.object(maintenance, 'proxy_status', https):
            maintenance.proxy('proxy-apply')
            assert https('/v1/device/firmware/next') == '401'
            assert https('/v1/admin/firmware-releases') == '403'
            assert status('staging.localhost', '/book') == 403
            maintenance.proxy('proxy-recover')
            assert https('/v1/device/firmware/next') == '403'
            assert maintenance.proxy_config()[1] == original
        print('PASS proxy rebind, failed HTTPS check recovery and explicit restoration', flush=True)


def exercise(temp, env, release):
    assert env['STAGING_PROJECT_NAME'] == 'locker-staging-validation'
    image = 'locker-staging-api:' + release
    refs = {'api': image}
    state = temp/'controller'
    state.mkdir(mode=0o700)
    with patch.dict(os.environ, env), patch.object(cd, 'STATE', state):
        journal = {'phase': 'healthy', 'refs': refs, 'previous': {'api': 'fixture-prior'}}
        cd.save('release.json', journal)
        cd.save('images.json', {'fixture': 'unchanged'})
        for value in ('true', 'false'):
            maintenance.window(value, refs)
            assert (state/'ota-window.json').exists() == (value == 'true')
            assert cd.read('release.json') == journal and cd.read('images.json') == {'fixture': 'unchanged'}
        print('PASS same-image enable and disable with effective zero ceilings and intact journal', flush=True)

        data = 'immutable simulated application'
        checksum = hashlib.sha256(data.encode()).hexdigest()
        cd.compose('--profile', 'tools', 'run', '--rm', '--no-deps', '--user', '0',
                   '--entrypoint', 'sh', 'migrate', '-ec', 'chown node:node /firmware; chmod 0700 /firmware')
        cd.compose('--profile', 'tools', 'run', '--rm', '--no-deps', '--entrypoint', 'node', 'migrate',
                   '-e', "require('fs').writeFileSync('/firmware/'+process.argv[1],process.argv[2],"
                   "{flag:'wx',mode:0o600})", checksum+'.bin', data)
        cd.sql(f"""INSERT INTO "FirmwareRelease" (id,"deviceId",version,"buildNumber",sha256,"sizeBytes","fileName")
                    VALUES ('fixture','staging-simulated-device','fixture',2,'{checksum}',{len(data)},'{checksum}.bin')""")
        bundle = temp/'paired'
        previous = os.umask(0o077)
        try:
            firmware_backup.backup(bundle, image)
            try:
                firmware_backup.backup(bundle, image)
            except FileExistsError:
                pass
            else:
                raise AssertionError('Retained backup was overwritten')
            _, volume = firmware_backup.restore(bundle, image)
            assert volume.startswith('restore-ota-')
            cd.run('docker', 'volume', 'rm', volume)
            (bundle/'blobs'/(checksum+'.bin')).write_bytes(b'corrupt')
            try:
                firmware_backup.restore(bundle, image)
            except cd.ReleaseError:
                pass
            else:
                raise AssertionError('Damaged backup accepted')
        finally:
            os.umask(previous)
        print('PASS paired restore to isolated database and volume, permissions, tamper rejection', flush=True)
