// Never load dotenv here. Refuse cleanup against a development/remote database.
function assertTestTargets(env) {
  const db = new URL(env.DATABASE_URL || 'invalid:');
  const redis = new URL(env.REDIS_URL || 'invalid:');
  const local = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
  if (
    env.NODE_ENV !== 'test' ||
    env.RESERVATION_E2E !== '1' ||
    db.protocol !== 'postgresql:' ||
    !local(db.hostname) ||
    db.pathname !== '/locker_reservation_e2e' ||
    db.searchParams.get('schema') !== 'public' ||
    redis.protocol !== 'redis:' ||
    !local(redis.hostname) ||
    redis.pathname !== '/15'
  ) {
    throw new Error(
      'Reservation E2E requires NODE_ENV=test, RESERVATION_E2E=1, local locker_reservation_e2e?schema=public and Redis /15. No cleanup performed.',
    );
  }
}
module.exports = { assertTestTargets };
