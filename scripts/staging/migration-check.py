#!/usr/bin/env python3
"""Upgrade six staging migrations through the seven-migration baseline and OTA in a new fixture database only."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

if os.environ.get('STAGING_PROJECT_NAME') != 'locker-staging-validation':
    raise SystemExit('Only disposable validation project allowed')
root = Path(__file__).resolve().parents[2]
wrapper = ['sh', str(root/'scripts/staging/compose.sh')]

def run(*args, **kwargs):
    return subprocess.run(wrapper+list(args), check=True, **kwargs)

def sql(statement):
    return run('exec','-T','db','psql','-U','locker','-d','staging_upgrade_fixture','-v','ON_ERROR_STOP=1','-At',input=statement,text=True,capture_output=True).stdout.strip()

# Refuse an existing database; never drop or overwrite one.
run('exec','-T','db','createdb','-U','locker','staging_upgrade_fixture')
source = root/'services/api/prisma'
new_migration = '20261116000000_customer_command_access'
migrations = sorted(p for p in (source/'migrations').iterdir() if p.is_dir())
if len(migrations) != 8 or migrations[-2].name != new_migration or migrations[-1].name != '20261126000000_firmware_ota':
    raise SystemExit('Review migration fixture baseline for changed history')
with tempfile.TemporaryDirectory(prefix='staging-migrations-') as directory:
    target = Path(directory)
    target.chmod(0o755)  # Non-root migrator must be able to read this fixture mount.
    shutil.copy(source/'schema.prisma', target/'schema.prisma')
    (target/'migrations').mkdir()
    shutil.copy(source/'migrations/migration_lock.toml', target/'migrations/migration_lock.toml')
    for migration in migrations[:-2]:
        shutil.copytree(migration, target/'migrations'/migration.name)
    def migrate():
        run('run','--rm','--no-deps','-e','STAGING_CONFIG_FILE=',
            '-e','DATABASE_URL=postgresql://locker:fixture-password-only@db:5432/staging_upgrade_fixture?schema=public',
            '-v',str(target)+':/fixture-migrations:ro','migrate',
            'node_modules/.bin/prisma','migrate','deploy','--schema','/fixture-migrations/schema.prisma')
    migrate()
    sql('''
INSERT INTO "Locker" (id,code,location,"updatedAt") VALUES ('upgrade-fixture','UPGRADE-FIXTURE','Simulated',NOW());
INSERT INTO "LockerDevice" (id,"lockerId","tokenHash") VALUES ('upgrade-fixture','upgrade-fixture','fixture-only-upgrade-token-hash');
INSERT INTO "DeviceCommand" (id,"deviceId","lockerId","requestedBy",reason,"pulseMs","expiresAt",result) VALUES ('upgrade-unknown','upgrade-fixture','upgrade-fixture','fixture','Historical simulation',500,NOW()-INTERVAL '1 day','UNKNOWN');
INSERT INTO "DeviceCommandReconciliation" ("commandId","deviceId","operatorId",reason,evidence,"physicalSafetyConfirmed","originalResult") VALUES ('upgrade-unknown','upgrade-fixture','fixture-operator','Fixture acknowledgement','Fixture evidence',true,'UNKNOWN');
INSERT INTO "DeviceEvent" (id,"deviceId",type,severity,"dedupeKey") VALUES ('upgrade-event','upgrade-fixture','FIXTURE','INFO','upgrade-event');
INSERT INTO "DeviceHealth" ("deviceId","bootId","updatedAt") VALUES ('upgrade-fixture','fixture-boot',NOW());
INSERT INTO "Reservation" (id,"lockerId",status,"startTime","endTime","expiresAt","updatedAt") VALUES ('upgrade-paid','upgrade-fixture','CONFIRMED',NOW(),NOW()+INTERVAL '1 hour',NOW()+INTERVAL '10 minutes',NOW());
INSERT INTO "CustomerReservationAccess" ("reservationId","tokenHash","paymentIntentId","paidAt","expectedAmount","paymentState") VALUES ('upgrade-paid','fixture-only-owner-hash','pi_upgrade_fixture',NOW(),500,'SUCCEEDED');
''')
    snapshot = '''SELECT json_build_object(
'command',(SELECT to_jsonb(c)-'reservationId'-'requestKey' FROM "DeviceCommand" c WHERE id='upgrade-unknown'),
'review',(SELECT to_jsonb(r) FROM "DeviceCommandReconciliation" r WHERE "commandId"='upgrade-unknown'),
'event',(SELECT to_jsonb(e) FROM "DeviceEvent" e WHERE id='upgrade-event'),
'health',(SELECT to_jsonb(h) FROM "DeviceHealth" h WHERE "deviceId"='upgrade-fixture'),
'access',(SELECT to_jsonb(a) FROM "CustomerReservationAccess" a WHERE "reservationId"='upgrade-paid'));'''
    before = json.loads(sql(snapshot))
    for migration in migrations[-2:]:
        shutil.copytree(migration, target/'migrations'/migration.name)
        migrate()
        if json.loads(sql(snapshot)) != before:
            raise SystemExit('Incremental migration changed fixture history')
    if json.loads(sql(snapshot)) != before:
        raise SystemExit('Migration altered fixture history or payment proof')
    if sql('SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;') != '8':
        raise SystemExit('Unexpected migration history')
    if sql('SELECT COUNT(*) FROM "DeviceCommand" WHERE "reservationId" IS NULL AND "requestKey" IS NULL;') != '1':
        raise SystemExit('Unexpected association for old administrator command')
print('PASS six-to-eight migration upgrade preserves unknown command, operator audit, event, health and payment proof')
