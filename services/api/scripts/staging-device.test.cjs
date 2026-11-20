const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { credentialOperation, stagingOnly } = require('./staging-device.cjs');

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-device-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  let device = { id: 'staging-simulated', enabled: true, tokenHash: 'old', lockerId: 'fixture', maxPulseMs: 0 };
  const events = []; let locked = false;
  const tx = {
    $queryRaw: async () => { locked = true; },
    lockerDevice: {
      findUnique: async () => { assert.ok(locked); return device; },
      update: async ({ data }) => { assert.ok(locked); device = { ...device, ...data }; },
      create: async ({ data }) => { device = { ...data }; },
    },
    deviceEvent: { create: async ({ data }) => { events.push(data); } },
  };
  return { db: { $transaction: async fn => fn(tx) }, tx, events, get device() { return device; },
    args: { deviceId: device.id, lockerId: 'fixture', tokenFile: path.join(folder, 'token'),
      actor: 'test-operator', reason: 'Simulated credential lifecycle validation' } };
}
test('guard refuses Mac URLs, nonzero ceilings and missing runtime loader', () => {
  const env = { STAGING_CONFIG_FILE: '/run/secrets/api_config',
    DATABASE_URL: 'postgresql://fixture:fixture@db/locker_staging',
    DEVICE_MAX_PULSE_MS: '0', CUSTOMER_UNLOCK_PULSE_MS: '0' };
  stagingOnly(env);
  for (const data of [{ DATABASE_URL: 'postgresql://fixture@localhost/locker_staging' },
    { DEVICE_MAX_PULSE_MS: '1' }, { CUSTOMER_UNLOCK_PULSE_MS: '1' }, { STAGING_CONFIG_FILE: '' }]) {
    assert.throws(() => stagingOnly({ ...env, ...data }));
  }
});
test('create uses separate durable token and records accountable operator', async t => {
  const f = fixture(t);
  await credentialOperation(f.db, { ...f.args, operation: 'create' });
  const token = fs.readFileSync(f.args.tokenFile, 'utf8').trim();
  assert.equal(f.device.tokenHash, createHash('sha256').update(token).digest('hex'));
  assert.equal(f.events[0].type, 'CREDENTIAL_CREATE');
  assert.equal(f.events[0].details.operatorId, 'test-operator');
  assert.ok(!JSON.stringify(f.events).includes(token));
});
test('revocation locks against enqueue and keeps history/mapping', async t => {
  const f = fixture(t);
  await credentialOperation(f.db, { ...f.args, operation: 'revoke' });
  assert.equal(f.device.enabled, false);
  assert.equal(f.device.tokenHash, 'old');
  assert.equal(f.device.lockerId, 'fixture');
  assert.equal(f.events[0].type, 'CREDENTIAL_REVOKE');
  assert.equal(fs.existsSync(f.args.tokenFile), false);
});
test('rotation does not re-enable revoked device; never overwrites token file', async t => {
  const f = fixture(t);
  await credentialOperation(f.db, { ...f.args, operation: 'revoke' });
  await credentialOperation(f.db, { ...f.args, operation: 'rotate' });
  const token = fs.readFileSync(f.args.tokenFile, 'utf8');
  assert.equal(f.device.enabled, false);
  assert.notEqual(f.device.tokenHash, 'old');
  assert.equal(fs.statSync(f.args.tokenFile).mode & 0o777, 0o600);
  await assert.rejects(credentialOperation(f.db, { ...f.args, operation: 'rotate' }), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(f.args.tokenFile, 'utf8'), token);
});
test('ambiguous transaction failure retains the new credential', async t => {
  const f = fixture(t);
  f.db.$transaction = async () => { throw new Error('unknown commit'); };
  await assert.rejects(credentialOperation(f.db, { ...f.args, operation: 'rotate' }));
  assert.match(fs.readFileSync(f.args.tokenFile, 'utf8').trim(), /^[a-f0-9]{64}$/);
});
test('mandatory operator and reason validated before file or database writes', async t => {
  const f = fixture(t);
  await assert.rejects(credentialOperation(f.db, { ...f.args, operation: 'rotate', reason: '' }));
  assert.equal(fs.existsSync(f.args.tokenFile), false);
  assert.equal(f.events.length, 0);
});
