require('./environment.cjs').assertTestTargets(process.env);
// Always replace ambient secrets with fixtures, even if the invoking shell has real ones.
Object.assign(process.env, {
  JWT_SECRET: 'reservation-e2e-signing-secret-not-for-real-use',
  ADMIN_EMAIL: 'reservation-e2e@example.invalid',
  STRIPE_SECRET_KEY: 'sk_test_reservation_e2e_not_a_real_key',
  STRIPE_WEBHOOK_SECRET: 'whsec_reservation_e2e_fixture',
  DEVICE_MAX_PULSE_MS: '5000',
});
delete process.env.DEVICE_BENCH_SHORT_COOLDOWN;
delete process.env.DEVICE_TLS_KEY;
delete process.env.DEVICE_TLS_CERT;
// Defense in depth: an accidentally unmocked Stripe request must fail locally.
for (const protocol of ['node:http', 'node:https']) {
  const transport = require(protocol);
  const original = transport.request;
  transport.request = function (...args) {
    const first = args[0];
    const options =
      typeof first === 'string' || first instanceof URL
        ? new URL(first)
        : first;
    const host = options?.hostname || options?.host || 'localhost';
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
      throw new Error(`Reservation E2E blocked outbound HTTP to ${host}`);
    }
    return original.apply(this, args);
  };
}
