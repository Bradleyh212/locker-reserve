const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertTestTargets } = require('./environment.cjs');
const safe = {
  NODE_ENV: 'test',
  RESERVATION_E2E: '1',
  DATABASE_URL:
    'postgresql://ci:ci@127.0.0.1:55440/locker_reservation_e2e?schema=public',
  REDIS_URL: 'redis://127.0.0.1:56390/15',
};
test('accepts only the explicit disposable database/Redis opt-in', () => {
  assert.doesNotThrow(() => assertTestTargets(safe));
});
for (const [label, overrides] of [
  ['production mode', { NODE_ENV: 'production' }],
  ['missing opt-in', { RESERVATION_E2E: '' }],
  [
    'development database',
    {
      DATABASE_URL: safe.DATABASE_URL.replace(
        'locker_reservation_e2e',
        'locker',
      ),
    },
  ],
  [
    'remote database',
    { DATABASE_URL: safe.DATABASE_URL.replace('127.0.0.1', 'example.com') },
  ],
  [
    'other schema',
    { DATABASE_URL: safe.DATABASE_URL.replace('public', 'private') },
  ],
  ['default Redis database', { REDIS_URL: 'redis://127.0.0.1:6379' }],
  ['remote Redis', { REDIS_URL: 'redis://example.com:6379/15' }],
  ['missing database', { DATABASE_URL: '' }],
]) {
  test(`refuses ${label} before cleanup`, () =>
    assert.throws(() => assertTestTargets({ ...safe, ...overrides })));
}
