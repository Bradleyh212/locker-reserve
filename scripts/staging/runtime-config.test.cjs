const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configuration } = require('../../services/api/scripts/runtime-config.cjs');
const sample = { DATABASE_URL: 'postgresql://locker:fixture@db:5432/locker_staging?schema=public', ADMIN_EMAIL: 'fixture@example.test', ADMIN_PASSWORD_HASH: '$2b$12$fixture', JWT_SECRET: 'x'.repeat(40), STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture' };
function using(data, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-config-test-'));
  const file = path.join(dir, 'api.json');
  try { fs.writeFileSync(file, JSON.stringify(data), {mode:0o600}); fn(file); }
  finally { fs.rmSync(dir, {recursive:true}); }
}
test('existing development env is unchanged without file configuration', () => assert.deepEqual(configuration({NODE_ENV:'development'}), {NODE_ENV:'development'}));
test('file configuration always disables actuation and local TLS listener', () => using(sample, file => {
  const result = configuration({STAGING_CONFIG_FILE:file, DEVICE_MAX_PULSE_MS:'5000', CUSTOMER_UNLOCK_PULSE_MS:'5000', DEVICE_TLS_KEY:'private.key'});
  assert.equal(result.DEVICE_MAX_PULSE_MS, '0'); assert.equal(result.CUSTOMER_UNLOCK_PULSE_MS, '0'); assert.equal(result.DEVICE_TLS_KEY,''); assert.equal(result.NODE_ENV,'production');
}));
for (const [field,value] of [['STRIPE_SECRET_KEY','sk_live_fixture'],['JWT_SECRET','short'],['DATABASE_URL','postgresql://locker:fixture@localhost:5433/locker'],['UNEXPECTED_SECRET','forbidden'],['STRIPE_WEBHOOK_SECRET','']])
  test(`rejects invalid ${field} without revealing values`, () => using({...sample,[field]:value}, file => assert.throws(()=>configuration({STAGING_CONFIG_FILE:file}))));
test('missing private file fails closed', () => assert.throws(()=>configuration({STAGING_CONFIG_FILE:'/nonexistent/staging-test.json'})));
