#!/usr/bin/env python3
"""Build/test a new isolated local stack; never attaches to an existing project.
Requires Docker and available loopback ports 58080/58443. No real secrets/payments.
"""
import argparse
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import uuid

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--build', action='store_true', help='build all three images first')
parser.add_argument('--release-id', default='local-validation')
a = parser.parse_args()
project = 'locker-staging-validation'
existing = subprocess.check_output(['docker','ps','-aq','--filter','label=com.docker.compose.project='+project]).strip()
existing_volumes = subprocess.check_output(['docker','volume','ls','-q','--filter','label=com.docker.compose.project='+project]).strip()
if existing or existing_volumes:
    raise SystemExit('Refusing to modify an existing validation project or its data volumes; inspect them first.')
with tempfile.TemporaryDirectory(prefix='locker-staging-test-') as directory:
    temporary = Path(directory)
    envfile = temporary/'compose.env'
    config = temporary/'api.json'
    password = temporary/'db-password'
    override = temporary/'override.yml'
    password.write_text('fixture-password-only')
    envfile.write_text(f'''RELEASE_ID={a.release_id}
WEB_DOMAIN=staging.localhost
API_DOMAIN=api-staging.localhost
ACME_EMAIL=fixture@example.test
STAGING_ALLOWED_CIDRS=127.0.0.1/32
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_fixture
API_CONFIG_FILE={config}
DB_PASSWORD_FILE={password}
PROXY_SUBNET=172.30.91.0/24
PROXY_DYNAMIC_RANGE=172.30.91.128/25
PROXY_IP=172.30.91.2
''')
    import maintenance
    legacy = temporary/'legacy-Caddyfile'
    reviewed = (root/'infra/staging/Caddyfile').read_text()
    legacy.write_text(reviewed.replace(maintenance.OTA_PATHS, ''))
    def write_override(allow):
        override.write_text(f'''services:
  caddy:
    environment:
      TLS_ISSUER: internal
      STAGING_ALLOWED_CIDRS: {allow}
    volumes: ["{legacy}:/etc/caddy/Caddyfile:ro"]
    ports: !override
      - '127.0.0.1:58080:80'
      - '127.0.0.1:58443:443'
''')
    write_override('192.0.2.1/32')
    config.write_text('{}')
    env = {**os.environ,'STAGING_ENV_FILE':str(envfile),'STAGING_PROJECT_NAME':project}
    command = ['docker','compose','--project-name',project,'--env-file',str(envfile),'-f',str(root/'infra/staging/compose.yml'),'-f',str(override)]
    def compose(*args, **options):
        return subprocess.run(command+list(args),check=True,**options)
    started = False
    try:
        if a.build: compose('--profile','tools','build','api','web','migrate')
        hashed = subprocess.check_output(['docker','run','--rm','--entrypoint','node',f'locker-staging-api:{a.release_id}','-e',"process.stdout.write(require('bcryptjs').hashSync('fixture-password-123',12))"]).decode()
        config.write_text(json.dumps(dict(DATABASE_URL='postgresql://locker:fixture-password-only@db:5432/locker_staging?schema=public',ADMIN_EMAIL='fixture@example.test',ADMIN_PASSWORD_HASH=hashed,JWT_SECRET=uuid.uuid4().hex+uuid.uuid4().hex,STRIPE_SECRET_KEY='sk_test_fixture',STRIPE_WEBHOOK_SECRET='whsec_fixture')))
        # Non-root containers can read these mounts; parent temp directory stays 0700.
        config.chmod(0o444);password.chmod(0o444);envfile.chmod(0o600)
        subprocess.run(['python3',str(root/'scripts/staging/preflight.py')],env=env,check=True)
        started = True
        compose('run','--rm','--no-deps','caddy','caddy','validate','--config','/etc/caddy/Caddyfile','--adapter','caddyfile')
        started = True
        compose('up','-d','--wait','db','redis')
        subprocess.run(['python3',str(root/'scripts/staging/migration-check.py')],env=env,check=True)
        compose('run','--rm','migrate')
        compose('up','-d','--no-build','--wait')
        ca = temporary/'root.crt'
        subprocess.run(['docker','cp',project+'-caddy-1:/data/caddy/pki/authorities/local/root.crt',str(ca)],check=True)
        # Fresh strict TLS client tests denied requests before enabling exact tester IP.
        import http.client, socket
        context=ssl.create_default_context(cafile=ca)
        def status(host,path,headers=None):
            connection=http.client.HTTPSConnection(host,58443,context=context)
            connection.sock=context.wrap_socket(socket.create_connection(('127.0.0.1',58443)),server_hostname=host)
            connection.request('GET',path,headers=headers or {})
            response=connection.getresponse();code=response.status;response.read();connection.close();return code
        for host,path in [('staging.localhost','/book'),('staging.localhost','/api/auth/me'),('api-staging.localhost','/auth/me')]:
            if status(host,path,{'X-Forwarded-For':'192.0.2.1'})!=403: raise RuntimeError('Private boundary bypass')
        if status('api-staging.localhost','/v1/device/commands/next')!=401: raise RuntimeError('Device auth bypass')
        print('PASS private pages/admin blocked, spoofing rejected, device auth retained',flush=True)
        from maintenance_fixture import exercise, exercise_proxy
        fixture_env = {**env, 'STAGING_IMAGES_FILE': str(override)}
        exercise_proxy(temporary, fixture_env, status)
        networks=json.loads(subprocess.check_output(['docker','inspect',project+'-caddy-1','--format','{{json .NetworkSettings.Networks}}']))
        gateway=networks[project+'_outbound']['Gateway']
        write_override(gateway+'/32')
        compose('up','-d','--no-deps','--force-recreate','--wait','caddy')
        compose('exec','-T','web','node','-e',"fetch('http://api-proxy:3001/public/reservations/hold',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-Proto':'https'},body:'{}'}).then(r=>{if(r.status!==403)process.exit(1)})")
        compose('exec','-T','web','node','-e',"const fs=require('fs');fs.writeFileSync('/app/.next/cache/fixture','cache-writable');fs.unlinkSync('/app/.next/cache/fixture')")
        subprocess.run(['python3',str(root/'scripts/staging/smoke.py'),'--ca',str(ca)],env=env,check=True)
        exercise(temporary, fixture_env, a.release_id)
        dump=temporary/'fixture.dump'
        subprocess.run(['sh',str(root/'scripts/staging/backup.sh'),str(dump)],env=env,check=True)
        subprocess.run(['sh',str(root/'scripts/staging/restore-check.sh'),str(dump)],env=env,check=True)
        compose('up','-d','--no-build','--force-recreate','--wait','db','redis','api','web','caddy')
        count=compose('exec','-T','db','psql','-U','locker','-d','locker_staging','-Atc','SELECT COUNT(*) FROM "Reservation" WHERE "lockerId"=\'staging-fixture-locker\';',capture_output=True,text=True).stdout.strip()
        if count!='1': raise RuntimeError('Persistent reservation did not survive replacement')
        compose('run','--rm','migrate')
        print('PASS migration rerun, backup/restore, container replacement and database persistence',flush=True)
    finally:
        if started:
            # Destructive cleanup is restricted to this new fixture-only project.
            compose('down','--volumes','--remove-orphans')
