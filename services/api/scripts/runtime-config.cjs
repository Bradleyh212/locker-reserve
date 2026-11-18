// Optional staging-only file secrets. Never print the configuration or child env.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const allowed = ['DATABASE_URL', 'ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH', 'JWT_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
function configuration(env) {
  const next = { ...env };
  if (!env.STAGING_CONFIG_FILE) return next;
  const data = JSON.parse(fs.readFileSync(env.STAGING_CONFIG_FILE, 'utf8'));
  if (!data || Array.isArray(data) || Object.keys(data).some(k => !allowed.includes(k)) || allowed.some(k => typeof data[k] !== 'string' || !data[k]))
    throw new Error('Invalid staging configuration fields');
  if (!data.STRIPE_SECRET_KEY.startsWith('sk_test_') || !data.STRIPE_WEBHOOK_SECRET.startsWith('whsec_') || data.JWT_SECRET.length < 32 || !/^\$2[aby]\$/.test(data.ADMIN_PASSWORD_HASH))
    throw new Error('Staging requires test Stripe keys and strong authentication configuration');
  const db = new URL(data.DATABASE_URL);
  if (db.hostname !== 'db' || db.pathname !== '/locker_staging' || db.protocol !== 'postgresql:') throw new Error('Staging database must be the isolated Compose database');
  return { ...next, ...data, NODE_ENV: 'production', DEVICE_MAX_PULSE_MS: '0', CUSTOMER_UNLOCK_PULSE_MS: '0', DEVICE_TLS_KEY: '', DEVICE_TLS_CERT: '' };
}
module.exports = { configuration };
if (require.main === module) {
  try {
    const env = configuration(process.env);
    const args = process.argv.slice(2);
    if (!args.length) throw new Error('Missing runtime command');
    const child = spawn(args[0], args.slice(1), { env, stdio: 'inherit' });
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
    child.on('error', () => { console.error('Runtime process could not start'); process.exitCode = 1; });
    child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
  } catch { console.error('Runtime configuration rejected; check private staging files'); process.exitCode = 1; }
}
