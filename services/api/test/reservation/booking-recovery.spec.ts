import { randomBytes, randomUUID, createHash } from 'crypto';
import { PaymentsService } from '../../src/payments/payments.service';
import { Harness } from './harness';
const h = new Harness();
beforeAll(() => h.start());
beforeEach(() => h.reset());
afterEach(() => jest.useRealTimers());
afterAll(() => h.close());
const proof = () => randomBytes(32).toString('base64url');
function creation(token: string, key: string, range = h.range()) {
  return h
    .http()
    .post('/public/reservations/hold')
    .set('Authorization', 'Bearer ' + token)
    .set('Idempotency-Key', key)
    .send({ lockerId: h.lockerId, ...range });
}
function recovery(token: string, key: string) {
  return h
    .http()
    .get('/public/reservations/recovery')
    .set('Authorization', 'Bearer ' + token)
    .set('Idempotency-Key', key);
}
const row = (id: string) =>
  h.db.reservation.findUniqueOrThrow({
    where: { id },
    include: { access: true },
  });

it('recovers a lost creation response with the same proof, terms and original deadline', async () => {
  const token = proof(),
    key = randomUUID(),
    range = h.range();
  const first = await creation(token, key, range).expect(201);
  h.advance(12345);
  const repeated = await creation(token, key, range).expect(201);
  expect(repeated.body.id).toBe(first.body.id);
  expect(repeated.body.expiresAt).toBe(first.body.expiresAt);
  expect(
    Date.parse(first.body.expiresAt) - Date.parse(first.body.serverNow),
  ).toBe(600000);
  expect((await recovery(token, key).expect(200)).body.id).toBe(first.body.id);
  expect(await h.db.reservation.count()).toBe(1);
  expect((await row(first.body.id)).access?.tokenHash).toBe(
    createHash('sha256').update(token).digest('hex'),
  );
  expect(JSON.stringify(repeated.body)).not.toMatch(
    /tokenHash|accessToken|client_secret/,
  );
  await creation(token, key, {
    ...range,
    endTime: new Date(Date.parse(range.endTime) + 1000).toISOString(),
  }).expect(409);
});
it('serializes concurrent creation retries across requests', async () => {
  const token = proof(),
    key = randomUUID(),
    range = h.range();
  const results = await Promise.all([
    creation(token, key, range),
    creation(token, key, range),
    creation(token, key, range),
  ]);
  expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
  expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
  expect(await h.db.reservation.count()).toBe(1);
  await creation(proof(), key, range).expect(404);
});
it('requires ownership for status, recovery and both payment credential endpoints', async () => {
  const token = proof(),
    key = randomUUID(),
    r = (await creation(token, key).expect(201)).body;
  await h
    .http()
    .get('/public/reservations/' + r.id)
    .expect(401);
  await h
    .http()
    .get('/public/reservations/' + r.id)
    .set('Authorization', 'Bearer ' + proof())
    .expect(404);
  await recovery(proof(), key).expect(404);
  await h
    .http()
    .post('/public/payments/create-intent')
    .send({ reservationId: r.id })
    .expect(401);
  await h
    .http()
    .post('/public/payments/create-intent')
    .set('Authorization', 'Bearer ' + proof())
    .send({ reservationId: r.id })
    .expect(404);
  await h
    .http()
    .post('/payments/create-intent')
    .set('Cookie', h.cookie)
    .send({ reservationId: r.id })
    .expect(401);
  expect(h.intent).not.toHaveBeenCalled();
  expect(h.retrieve).not.toHaveBeenCalled();
});
it('sets no-store and refuses forwarded HTTPS claims on an untrusted production connection', async () => {
  const token = proof(),
    key = randomUUID();
  const r = await creation(token, key).expect(201);
  expect(r.headers['cache-control']).toBe('no-store');
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await recovery(token, key).set('X-Forwarded-Proto', 'https').expect(403);
  } finally {
    process.env.NODE_ENV = prior;
  }
});
it.each(['id', 'amount', 'amount_received', 'currency'] as const)(
  'rejects signed success with mismatched %s',
  async (field) => {
    const hold = await h.hold().expect(201);
    await h.pay(hold.body.id).expect(201);
    const payload = JSON.parse(h.event(hold.body.id));
    payload.data.object[field] =
      field === 'id' ? 'pi_wrong' : field === 'currency' ? 'usd' : 1;
    await h.webhook(JSON.stringify(payload)).expect(400);
    const r = await row(hold.body.id);
    expect(r.status).toBe('HOLD');
    expect(r.access?.paidAt).toBeNull();
    expect(await h.db.paymentEvent.count()).toBe(0);
  },
);
it('does not grant payment proof to a legacy reservation without an owner or bound intent', async () => {
  const r = await h.db.reservation.create({
    data: {
      lockerId: h.lockerId,
      startTime: new Date(h.now),
      endTime: new Date(h.now + 3600000),
      expiresAt: new Date(h.now + 600000),
    },
  });
  await h.webhook(h.event(r.id)).expect(201);
  expect((await h.db.paymentEvent.findFirstOrThrow()).outcome).toBe(
    'UNBOUND_LEGACY_PAYMENT',
  );
  expect((await row(r.id)).status).toBe('HOLD');
});
it('retains processing state, reuses a single intent and confirms only verified success', async () => {
  const hold = await h.hold().expect(201);
  await h.pay(hold.body.id).expect(201);
  const pi = h.intents.get('pi_e2e_' + hold.body.id);
  pi.status = 'processing';
  await h
    .webhook(h.event(hold.body.id, 'payment_intent.processing'))
    .expect(201);
  const waiting = await h.pay(hold.body.id).expect(201);
  expect(waiting.body.client_secret).toBeNull();
  expect(waiting.body.reservation.paymentState).toBe('PROCESSING');
  expect(h.intent).toHaveBeenCalledTimes(1);
  pi.status = 'succeeded';
  pi.amount_received = 500;
  const result = await h
    .http()
    .get('/public/reservations/' + hold.body.id)
    .set('Authorization', 'Bearer ' + h.proofs.get(hold.body.id))
    .expect(200);
  expect(result.body.status).toBe('CONFIRMED');
  expect(result.body.paymentState).toBe('SUCCEEDED');
  await h
    .webhook(h.event(hold.body.id, 'payment_intent.payment_failed'))
    .expect(201);
  expect((await row(hold.body.id)).access?.paidAt).not.toBeNull();
});
it.each(['expiry', 'cancel'] as const)(
  'records delayed payment after %s without resurrecting the reservation',
  async (kind) => {
    const hold = await h.hold().expect(201);
    await h.pay(hold.body.id).expect(201);
    const deadline = hold.body.expiresAt;
    if (kind === 'expiry') {
      h.advance(600000);
      await h.expire();
    } else
      await h
        .http()
        .patch('/reservations/' + hold.body.id + '/cancel')
        .set('Cookie', h.cookie)
        .expect(200);
    const payload = h.event(hold.body.id);
    await h.webhook(payload).expect(201);
    await h.webhook(payload).expect(201);
    const r = await row(hold.body.id);
    expect(r.status).toBe(kind === 'expiry' ? 'EXPIRED' : 'CANCELLED');
    expect(r.expiresAt.toISOString()).toBe(deadline);
    expect(r.access?.paymentState).toBe('RECONCILIATION_REQUIRED');
    expect(r.access?.paidAt).toBeNull();
    expect(r.access?.revokedAt).not.toBeNull();
    expect((await h.db.paymentEvent.findFirstOrThrow()).outcome).toBe(
      'LATE_SUCCESS',
    );
  },
);
it('binds and cancels an intent when cancellation wins during Stripe creation; no secret escapes', async () => {
  const hold = await h.hold().expect(201),
    original = h.intent.getMockImplementation()!;
  h.intent.mockImplementationOnce(async (...args: any[]) => {
    const pi = await original(...args);
    await h
      .http()
      .patch('/reservations/' + hold.body.id + '/cancel')
      .set('Cookie', h.cookie)
      .expect(200);
    return pi;
  });
  const response = await h.pay(hold.body.id).expect(201);
  expect(response.body.client_secret).toBeNull();
  expect(response.body.reservation.status).toBe('CANCELLED');
  expect((await row(hold.body.id)).access?.paymentIntentId).toBeTruthy();
  expect(h.cancelIntent).toHaveBeenCalledTimes(1);
});
it('retries failed cancellation and reconciles expired intent without customer traffic', async () => {
  const hold = await h.hold().expect(201);
  await h.pay(hold.body.id).expect(201);
  h.advance(600000);
  await h.expire();
  h.cancelIntent.mockRejectedValueOnce(new Error('Temporary provider outage'));
  const payments = h.app.get(PaymentsService);
  await payments.reconcilePending();
  expect((await row(hold.body.id)).access?.reconciliationReason).toBe(
    'CANCELLATION_PENDING',
  );
  await payments.reconcilePending();
  expect((await row(hold.body.id)).access?.paymentState).toBe('CANCELED');
  expect(h.intents.get('pi_e2e_' + hold.body.id).status).toBe('canceled');
});
it('fails closed when a reversal precedes intent binding', async () => {
  const hold = await h.hold().expect(201);
  const payload = JSON.stringify({
    id: 'evt_reversed_early',
    type: 'charge.refunded',
    data: { object: { payment_intent: 'pi_e2e_' + hold.body.id } },
  });
  await h.webhook(payload).expect(201);
  expect((await h.pay(hold.body.id).expect(201)).body.client_secret).toBeNull();
  expect((await row(hold.body.id)).access?.revokedAt).not.toBeNull();
});

it('retries a lost Stripe creation response with the same provider key and no second intent', async () => {
  const hold = await h.hold().expect(201),
    original = h.intent.getMockImplementation()!;
  h.intent.mockImplementationOnce(async (...args: any[]) => {
    await original(...args);
    throw new Error('Lost provider response');
  });
  await h.pay(hold.body.id).expect(500);
  await h.pay(hold.body.id).expect(201);
  expect(h.intents.size).toBe(1);
  expect(h.intent.mock.calls[0][1]).toEqual(h.intent.mock.calls[1][1]);
});
it('records cancellation after verified payment for operator reconciliation', async () => {
  const hold = await h.hold().expect(201);
  await h.pay(hold.body.id).expect(201);
  await h.webhook(h.event(hold.body.id)).expect(201);
  await h
    .http()
    .patch('/reservations/' + hold.body.id + '/cancel')
    .set('Cookie', h.cookie)
    .expect(200);
  const r = await row(hold.body.id);
  expect(r.status).toBe('CANCELLED');
  expect(r.access?.revokedAt).not.toBeNull();
  expect(r.access?.paymentState).toBe('RECONCILIATION_REQUIRED');
});
it('treats an authorized but uncaptured payment as processing, never as payable or paid', async () => {
  const hold = await h.hold().expect(201);
  await h.pay(hold.body.id).expect(201);
  h.intents.get('pi_e2e_' + hold.body.id).status = 'requires_capture';
  const response = await h.pay(hold.body.id).expect(201);
  expect(response.body.client_secret).toBeNull();
  expect(response.body.reservation.paymentState).toBe('PROCESSING');
  expect((await row(hold.body.id)).status).toBe('HOLD');
});

it.each(['CONFIRMED', 'CANCELLED', 'EXPIRED'] as const)(
  'never exposes a fresh payment credential for %s',
  async (status) => {
    const hold = await h.hold().expect(201);
    await h.db.reservation.update({
      where: { id: hold.body.id },
      data: { status },
    });
    await h.pay(hold.body.id).expect(400);
    expect(h.intent).not.toHaveBeenCalled();
    const response = await h
      .http()
      .get('/public/reservations/' + hold.body.id)
      .set('Authorization', 'Bearer ' + h.proofs.get(hold.body.id))
      .expect(200);
    expect(response.body.canPay).toBe(false);
    expect(response.body).not.toHaveProperty('client_secret');
  },
);
it('concurrent payment retries bind exactly one intent and share the provider idempotency key', async () => {
  const hold = await h.hold().expect(201);
  const results = await Promise.all([
    h.pay(hold.body.id),
    h.pay(hold.body.id),
    h.pay(hold.body.id),
  ]);
  expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
  expect(h.intents.size).toBe(1);
  expect(
    h.intent.mock.calls.every(
      (call) => call[1].idempotencyKey === 'reservation:' + hold.body.id,
    ),
  ).toBe(true);
  expect((await row(hold.body.id)).access?.paymentIntentId).toBe(
    'pi_e2e_' + hold.body.id,
  );
});
