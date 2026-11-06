import { randomUUID } from 'node:crypto';
import { RedisCacheService } from '../../src/cache/redis-cache.service';
import { Harness } from './harness';

const h = new Harness();
const route = '/v1/customer/reservations';
type Booking = { reservationId: string; accessToken: string };
const auth = (b: Booking) => 'Bearer ' + b.accessToken;
const endpoint = (b: Booking) => route + '/' + b.reservationId;

beforeAll(() => h.start(), 30000);
beforeEach(async () => {
  await h.reset();
  const keys = await h.redis.keys('customer-access:*');
  if (keys.length) await h.redis.del(keys);
  process.env.CUSTOMER_UNLOCK_PULSE_MS = '200';
});
afterAll(async () => {
  delete process.env.CUSTOMER_UNLOCK_PULSE_MS;
  await h.close();
});

async function book(
  start = h.now,
  end = start + 3600000,
  lockerId = h.lockerId,
): Promise<Booking> {
  const res = await h
    .http()
    .post(route + '/hold')
    .send({
      lockerId,
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
    })
    .expect(201);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.body.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return res.body;
}
function intent(b: Booking) {
  return h
    .http()
    .post(endpoint(b) + '/payment-intent')
    .set('Authorization', auth(b));
}
function success(b: Booking, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'evt_' + randomUUID(),
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_e2e_' + b.reservationId,
        status: 'succeeded',
        metadata: { reservationId: b.reservationId },
        currency: 'cad',
        amount: 500,
        amount_received: 500,
        ...extra,
      },
    },
  });
}
function reversal(b: Booking, type = 'charge.refunded') {
  return JSON.stringify({
    id: 'evt_' + randomUUID(),
    type,
    data: { object: { payment_intent: 'pi_e2e_' + b.reservationId } },
  });
}
async function pay(b: Booking) {
  await intent(b).expect(201);
  await h.webhook(success(b)).expect(201);
}
function unlock(b: Booking, key = randomUUID()) {
  return h
    .http()
    .post(endpoint(b) + '/unlock-requests')
    .set('Authorization', auth(b))
    .set('Idempotency-Key', key);
}
function status(b: Booking, command: string) {
  return h
    .http()
    .get(endpoint(b) + '/unlock-requests/' + command)
    .set('Authorization', auth(b));
}
function ready(b: Booking) {
  return h
    .http()
    .get(endpoint(b) + '/access')
    .set('Authorization', auth(b));
}
function grant(b: Booking) {
  return h.db.customerReservationAccess.findUniqueOrThrow({
    where: { reservationId: b.reservationId },
  });
}

it('issues an owner credential, binds a real signed payment, polls and reports a bounded simulated pulse', async () => {
  const b = await book();
  expect((await grant(b)).tokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(await grant(b))).not.toContain(b.accessToken);
  await h
    .http()
    .post('/public/payments/create-intent')
    .send({ reservationId: b.reservationId })
    .expect(404);
  await unlock(b).expect(403);
  await pay(b);
  expect((await grant(b)).paidAt).not.toBeNull();
  expect((await ready(b).expect(200)).body.available).toBe(true);
  const created = await unlock(b).expect(202);
  const id = created.body.commandId;
  expect(created.body.status).toBe('PENDING');
  const command = await h.next().expect(200);
  expect(command.body).toMatchObject({
    commandId: id,
    lockerId: h.lockerId,
    deviceId: h.deviceId,
    pulseMs: 200,
    type: 'UNLOCK_PULSE',
  });
  expect(command.body).not.toHaveProperty('reservationId');
  await h.result(id).expect(200);
  const response = await status(b, id).expect(200);
  expect(Object.keys(response.body).sort()).toEqual([
    'commandId',
    'expiresAt',
    'status',
  ]);
  expect(response.body.status).toBe('OUTPUT_PULSE_COMPLETED');
  expect(
    await h.db.deviceCommand.findUniqueOrThrow({ where: { id } }),
  ).toMatchObject({
    reservationId: b.reservationId,
    requestedBy: 'customer-reservation:' + b.reservationId,
    reason: 'Reservation access',
  });
});

it('conceals other reservations and commands, rejects missing credentials, and accepts no caller-selected hardware parameters', async () => {
  const b = await book();
  const other = await book(h.now + 7200000);
  await h
    .http()
    .get(endpoint(b) + '/access')
    .expect(401);
  await h
    .http()
    .get(endpoint(b) + '/access')
    .set('Cookie', h.cookie)
    .expect(401);
  const wrong = { ...b, accessToken: other.accessToken };
  const missing = { ...other, reservationId: randomUUID() };
  expect((await ready(wrong).expect(404)).body).toEqual(
    (await ready(missing).expect(404)).body,
  );
  await intent(wrong).expect(404);
  await unlock(wrong).expect(404);
  await pay(b);
  await unlock(b)
    .send({ lockerId: h.lockerId, deviceId: h.deviceId, pulseMs: 5001 })
    .expect(400);
  await h
    .http()
    .post(endpoint(b) + '/unlock-requests')
    .set('Authorization', auth(b))
    .expect(400);
  const id = (await unlock(b).expect(202)).body.commandId;
  await status(other, id).expect(404);
  await status(wrong, id).expect(404);
  await status(b, randomUUID()).expect(404);
});

it.each(['manual confirmation', 'unpaid', 'cancelled', 'expired'] as const)(
  'denies a reservation that is %s',
  async (mode) => {
    const b = await book();
    if (mode === 'manual confirmation')
      await h
        .http()
        .patch('/reservations/' + b.reservationId + '/confirm')
        .set('Cookie', h.cookie)
        .expect(200);
    if (mode === 'cancelled') {
      await pay(b);
      await h
        .http()
        .patch('/reservations/' + b.reservationId + '/cancel')
        .set('Cookie', h.cookie)
        .expect(200);
    }
    if (mode === 'expired') {
      h.advance(600000);
      await h.expire();
    }
    await unlock(b).expect(403);
    expect(await h.db.deviceCommand.count()).toBe(0);
  },
);

it('uses inclusive start and exclusive end, caps delivery near the end and retains read-only results temporarily', async () => {
  const b = await book(h.now + 1000, h.now + 3601000);
  await pay(b);
  h.advance(999);
  await unlock(b).expect(403);
  h.advance(1);
  expect((await ready(b).expect(200)).body.available).toBe(true);
  h.advance(3600000 - 1000);
  await h.heartbeat();
  const key = randomUUID();
  const cmd = await unlock(b, key).expect(202);
  expect(new Date(cmd.body.expiresAt).getTime()).toBe(h.now + 800);
  h.advance(800);
  await h.next().expect(204);
  h.advance(200);
  await unlock(b).expect(403);
  expect((await unlock(b, key).expect(202)).body.status).toBe(
    'OUTCOME_UNKNOWN',
  );
  expect((await status(b, cmd.body.commandId).expect(200)).body.status).toBe(
    'OUTCOME_UNKNOWN',
  );
  h.advance(24 * 3600000);
  await status(b, cmd.body.commandId).expect(404);
});

it('serializes identical and distinct requests, preserves result on retry, and reports cooldown', async () => {
  const b = await book();
  await pay(b);
  const key = randomUUID();
  const responses = await Promise.all([
    unlock(b, key),
    unlock(b, key),
    unlock(b, key),
  ]);
  expect(responses.map((r) => r.status)).toEqual([202, 202, 202]);
  expect(new Set(responses.map((r) => r.body.commandId)).size).toBe(1);
  const id = responses[0].body.commandId;
  await unlock(b).expect(409);
  expect(await h.db.deviceCommand.count()).toBe(1);
  await h.result(id).expect(200);
  expect((await unlock(b, key).expect(202)).body.status).toBe(
    'OUTPUT_PULSE_COMPLETED',
  );
  expect((await ready(b).expect(200)).body).toMatchObject({
    available: false,
    code: 'COOLDOWN',
    retryAt: expect.any(String),
  });
  expect((await unlock(b).expect(409)).body.code).toBe('COOLDOWN');
  h.advance(31000);
  await h.heartbeat();
  const concurrent = await Promise.all([unlock(b), unlock(b)]);
  expect(concurrent.map((r) => r.status).sort()).toEqual([202, 409]);
});

it('serializes customer and admin requests through the same device gate', async () => {
  const b = await book();
  await pay(b);
  const requests = await Promise.all([unlock(b), h.unlock()]);
  expect(requests.map((r) => r.status).sort()).toEqual([202, 409]);
  expect(await h.db.deviceCommand.count()).toBe(1);
});

it.each([
  'offline',
  'OPEN',
  'UNKNOWN',
  'ACTIVE',
  'disabled locker',
  'disabled device',
  'unarmed',
  'future heartbeat',
  'pulse limit',
  'unknown command',
  'expired command',
])('rejects unsafe access: %s', async (mode) => {
  const b = await book();
  await pay(b);
  switch (mode) {
    case 'offline':
      h.advance(15000);
      break;
    case 'OPEN':
    case 'UNKNOWN':
      await h.heartbeat(mode);
      break;
    case 'ACTIVE':
      await h.heartbeat('CLOSED', 'ACTIVE');
      break;
    case 'disabled locker':
      await h.db.locker.update({
        where: { id: h.lockerId },
        data: { isActive: false },
      });
      break;
    case 'disabled device':
    case 'unarmed':
    case 'future heartbeat':
      await h.db.lockerDevice.update({
        where: { id: h.deviceId },
        data:
          mode === 'disabled device'
            ? { enabled: false }
            : mode === 'unarmed'
              ? { actuationEnabled: false }
              : { lastSeen: new Date(h.now + 1) },
      });
      break;
    case 'pulse limit':
      process.env.CUSTOMER_UNLOCK_PULSE_MS = '5001';
      break;
    default: {
      const id = (await unlock(b).expect(202)).body.commandId;
      if (mode === 'unknown command') await h.result(id, 'UNKNOWN').expect(200);
      h.advance(31000);
      await h.heartbeat();
    }
  }
  const count = await h.db.deviceCommand.count();
  expect([403, 409]).toContain((await unlock(b)).status);
  expect((await ready(b).expect(200)).body.available).toBe(false);
  expect(await h.db.deviceCommand.count()).toBe(count);
});

it.each(['cancel', 'refund', 'dispute', 'disable customer pulse', 'open door'])(
  'rechecks %s after enqueue and before polling',
  async (mode) => {
    const b = await book();
    await pay(b);
    const id = (await unlock(b).expect(202)).body.commandId;
    if (mode === 'cancel')
      await h
        .http()
        .patch('/reservations/' + b.reservationId + '/cancel')
        .set('Cookie', h.cookie)
        .expect(200);
    if (mode === 'refund' || mode === 'dispute')
      await h
        .webhook(
          reversal(
            b,
            mode === 'refund' ? 'charge.refunded' : 'charge.dispute.created',
          ),
        )
        .expect(201);
    if (mode === 'disable customer pulse')
      delete process.env.CUSTOMER_UNLOCK_PULSE_MS;
    if (mode === 'open door') await h.heartbeat('OPEN');
    await h.next().expect(204);
    h.advance(10000);
    expect((await status(b, id).expect(200)).body.status).toBe(
      'OUTCOME_UNKNOWN',
    );
    expect(await h.db.deviceCommand.count()).toBe(1);
  },
);

it.each([
  { amount_received: 1 },
  { amount: 499 },
  { currency: 'usd' },
  { status: 'processing' },
  { id: 'pi_other' },
])('rejects mismatched signed payment evidence %j', async (overrides) => {
  const b = await book();
  await intent(b).expect(201);
  await h.webhook(success(b, overrides)).expect(201);
  expect((await grant(b)).paidAt).toBeNull();
  await unlock(b).expect(403);
});

it('handles success before intent binding, duplicate webhooks and concurrent access', async () => {
  const b = await book();
  const payload = success(b);
  await h.webhook(payload).expect(503);
  expect(await h.db.paymentEvent.count()).toBe(0);
  await intent(b).expect(201);
  const [one, two, maybe] = await Promise.all([
    h.webhook(payload),
    h.webhook(payload),
    unlock(b),
  ]);
  expect([one.status, two.status]).toEqual([201, 201]);
  expect([one, two].filter((r) => r.body.duplicate)).toHaveLength(1);
  expect([202, 403]).toContain(maybe.status);
  if (maybe.status === 403) await unlock(b).expect(202);
  expect(await h.db.deviceCommand.count()).toBe(1);
  expect((await grant(b)).paidAt).not.toBeNull();
});

it('retains reversals that arrive before binding or after success', async () => {
  const b = await book();
  await h.webhook(reversal(b)).expect(201);
  await intent(b).expect(409);
  await h.webhook(success(b)).expect(201);
  expect((await grant(b)).revokedAt).not.toBeNull();
  expect((await grant(b)).paidAt).toBeNull();
  await unlock(b).expect(403);
});

it('does not grant on invalid signature, late payment, or cancellation racing with payment', async () => {
  const b = await book();
  await intent(b).expect(201);
  await h.webhook(success(b), 'invalid').expect(400);
  expect((await grant(b)).paidAt).toBeNull();
  h.advance(600000);
  await h.webhook(success(b)).expect(201);
  expect((await grant(b)).paidAt).toBeNull();
  const other = await book(h.now + 7200000);
  await intent(other).expect(201);
  const responses = await Promise.all([
    h.webhook(success(other)),
    h
      .http()
      .patch('/reservations/' + other.reservationId + '/cancel')
      .set('Cookie', h.cookie),
  ]);
  expect(responses.map((r) => r.status)).toEqual([201, 200]);
  expect(
    (
      await h.db.reservation.findUniqueOrThrow({
        where: { id: other.reservationId },
      })
    ).status,
  ).toBe('CANCELLED');
  await unlock(other).expect(403);
});

it('throttles authenticated attempts without consuming an unlock or leaking the token', async () => {
  const b = await book();
  for (let i = 0; i < 8; i++) await unlock(b).expect(403);
  expect((await unlock(b).expect(429)).body).toMatchObject({
    code: 'RATE_LIMIT',
    retryAfterSeconds: 60,
  });
  expect(await h.db.deviceCommand.count()).toBe(0);
});

it('resolves a timeout using a late device result and never creates a replacement for the same key', async () => {
  const b = await book();
  await pay(b);
  const key = randomUUID();
  const id = (await unlock(b, key).expect(202)).body.commandId;
  await h.next().expect(200);
  h.advance(31000);
  await h.heartbeat();
  expect((await status(b, id).expect(200)).body.status).toBe('OUTCOME_UNKNOWN');
  await unlock(b).expect(409);
  await h.next().expect(204);
  await h.result(id).expect(200);
  await h.result(id).expect(200);
  expect((await unlock(b, key).expect(202)).body).toMatchObject({
    commandId: id,
    status: 'OUTPUT_PULSE_COMPLETED',
  });
  expect(await h.db.deviceCommand.count()).toBe(1);
});

it('only grants a manually confirmed booking once independent payment evidence arrives', async () => {
  const b = await book();
  await intent(b).expect(201);
  await h
    .http()
    .patch('/reservations/' + b.reservationId + '/confirm')
    .set('Cookie', h.cookie)
    .expect(200);
  await unlock(b).expect(403);
  await h.webhook(success(b)).expect(201);
  await unlock(b).expect(202);
});

it('suppresses delivery when the reservation moves to a different locker', async () => {
  const b = await book();
  await pay(b);
  await unlock(b).expect(202);
  const other = await h.db.locker.create({
    data: { code: 'E2E-other', location: 'test' },
  });
  await h.db.reservation.update({
    where: { id: b.reservationId },
    data: { lockerId: other.id },
  });
  await h.next().expect(204);
});

it('returns an unavailable response when throttling is unavailable', async () => {
  const prior = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    await expect(
      new RedisCacheService().limitAccess('test', 1, 60),
    ).rejects.toMatchObject({ status: 503 });
  } finally {
    process.env.REDIS_URL = prior;
  }
});

it('recovers a lost POST response by key without creating or retrying an unlock', async () => {
  const b = await book();
  await pay(b);
  const key = randomUUID();
  const lookup = () =>
    h
      .http()
      .get(endpoint(b) + '/unlock-requests')
      .set('Authorization', auth(b))
      .set('Idempotency-Key', key);
  await lookup().expect(404);
  expect(await h.db.deviceCommand.count()).toBe(0);
  const id = (await unlock(b, key).expect(202)).body.commandId;
  h.advance(10000);
  expect((await lookup().expect(200)).body).toMatchObject({
    commandId: id,
    status: 'OUTCOME_UNKNOWN',
  });
  expect(await h.db.deviceCommand.count()).toBe(1);
});

it('refuses to issue customer credentials over plaintext in production mode', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await h
      .http()
      .post(route + '/hold')
      .send({ lockerId: h.lockerId, ...h.range() })
      .expect(403);
    expect(await h.db.customerReservationAccess.count()).toBe(0);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

it('cannot claim an existing paid legacy reservation or read an admin command using a customer credential', async () => {
  const legacy = await h.hold().expect(201);
  await h.webhook(h.event(legacy.body.id)).expect(201);
  const customer = await book();
  await unlock({ ...customer, reservationId: legacy.body.id }).expect(404);
  expect(
    await h.db.customerReservationAccess.findUnique({
      where: { reservationId: legacy.body.id },
    }),
  ).toBeNull();
  const admin = await h.unlock().expect(202);
  await status(customer, admin.body.commandId).expect(404);
});
