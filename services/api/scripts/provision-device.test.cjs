const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { provisionDevice, safeError } = require('./provision-device.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locker-provision-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'token');
}
test('credential is durable and private before database creation', async t => {
  const file = fixture(t);
  await provisionDevice({ lockerDevice: { create: async ({ data }) => {
    const token = fs.readFileSync(file, 'utf8').trim();
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(data.tokenHash, createHash('sha256').update(token).digest('hex'));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } } }, 'device', 'locker', file);
});
for (const operation of ['writeFileSync', 'fsyncSync']) {
  test(`${operation} failure never creates a device and cleans file`, async t => {
    const file = fixture(t); let created = false;
    const io = { ...fs, [operation]: () => { throw Object.assign(new Error('secret'), { code: 'ENOSPC' }); } };
    await assert.rejects(provisionDevice({ lockerDevice: { create: async () => { created = true; } } }, 'd', 'l', file, io));
    assert.equal(created, false); assert.equal(fs.existsSync(file), false);
  });
}
test('known database rejection removes newly created token', async t => {
  const file = fixture(t);
  await assert.rejects(provisionDevice({ lockerDevice: { create: async () => { throw { code: 'P2002' }; } } }, 'd', 'l', file));
  assert.equal(fs.existsSync(file), false);
});
test('ambiguous commit failure retains token for recovery', async t => {
  const file = fixture(t);
  await assert.rejects(provisionDevice({ lockerDevice: { create: async () => { throw new Error('connection lost'); } } }, 'd', 'l', file));
  assert.equal(fs.existsSync(file), true);
});
test('existing token is untouched', async t => {
  const file = fixture(t); fs.writeFileSync(file, 'original');
  await assert.rejects(provisionDevice({}, 'd', 'l', file), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
});
test('errors never echo arbitrary messages or codes', () => {
  assert.doesNotMatch(safeError({ code: 'secret', message: 'secret' }), /secret/);
  assert.match(safeError({ code: 'P2002', message: 'secret' }), /already exists/);
});
