import { Harness } from './harness';

const h = new Harness();
beforeAll(() => h.start(), 30000);
beforeEach(() => h.reset());
afterAll(() => h.close());

async function reservation(id: string) {
  return h.db.reservation.findUniqueOrThrow({ where: { id } });
}
async function cacheKeys() {
  return h.redis.keys('lockers:availability:*');
}

describe('availability and holds: HTTP + PostgreSQL + Redis', () => {
  it('caches availability in real Redis and invalidates it after a hold', async () => {
    const range = h.range();
    expect(
      (await h.availability(range).expect(200)).body.map((l: any) => l.id),
    ).toContain(h.lockerId);
    expect(await cacheKeys()).toHaveLength(1);
    const created = await h.hold(range).expect(201);
    const stored = await reservation(created.body.id);
    expect(stored.status).toBe('HOLD');
    expect(stored.expiresAt.getTime()).toBe(h.now + 600000);
    expect(await cacheKeys()).toHaveLength(0);
    expect((await h.availability(range).expect(200)).body).toEqual([]);
    await h.hold(range).expect(400);
    expect(await h.db.reservation.count()).toBe(1);
  });

  it('excludes disabled lockers and refuses their holds', async () => {
    await h
      .http()
      .patch(`/lockers/${h.lockerId}`)
      .set('Cookie', h.cookie)
      .send({ isActive: false })
      .expect(200);
    expect((await h.availability().expect(200)).body).toEqual([]);
    await h.hold().expect(400);
    expect(await h.db.reservation.count()).toBe(0);
  });

  it.each(['same', 'reversed', 'invalid'])(
    'rejects %s time ranges without persisting holds',
    async (kind) => {
      const valid = h.range();
      const range = {
        startTime: valid.startTime,
        endTime:
          kind === 'same'
            ? valid.startTime
            : kind === 'reversed'
              ? new Date(h.now).toISOString()
              : 'not-a-date',
      };
      await h.availability(range).expect(400);
      await h.hold(range).expect(400);
      expect(await h.db.reservation.count()).toBe(0);
    },
  );

  it('permits adjacent reservations but blocks overlap with a confirmed one', async () => {
    const range = h.range();
    const hold = await h.hold(range).expect(201);
    await h
      .http()
      .patch(`/reservations/${hold.body.id}/confirm`)
      .set('Cookie', h.cookie)
      .expect(200);
    expect((await reservation(hold.body.id)).status).toBe('CONFIRMED');
    await h.hold(range).expect(400);
    await h
      .hold({
        startTime: range.endTime,
        endTime: new Date(h.now + 10800000).toISOString(),
      })
      .expect(201);
    expect(await h.db.reservation.count()).toBe(2);
  });

  it('serializes competing holds at a database barrier: exactly one succeeds', async () => {
    const responses = await h.competingHolds(2);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await h.db.reservation.count({ where: { status: 'HOLD' } })).toBe(1);
  });

  it('expires at ten minutes, rejects confirmation, and releases cached availability', async () => {
    const range = h.range();
    const hold = await h.hold(range).expect(201);
    await h.availability(range).expect(200);
    h.advance(600000);
    await h
      .http()
      .patch(`/reservations/${hold.body.id}/confirm`)
      .set('Cookie', h.cookie)
      .expect(400);
    await h.expire();
    expect((await reservation(hold.body.id)).status).toBe('EXPIRED');
    expect(await cacheKeys()).toHaveLength(0);
    expect(
      (await h.availability(range).expect(200)).body.map((l: any) => l.id),
    ).toContain(h.lockerId);
    await h.hold(range).expect(201);
  });

  it('confirms just before expiry; repeated confirmation is rejected', async () => {
    const hold = await h.hold().expect(201);
    h.advance(599999);
    await h
      .http()
      .patch(`/reservations/${hold.body.id}/confirm`)
      .set('Cookie', h.cookie)
      .expect(200);
    h.advance(1);
    await h.expire();
    expect((await reservation(hold.body.id)).status).toBe('CONFIRMED');
    await h
      .http()
      .patch(`/reservations/${hold.body.id}/confirm`)
      .set('Cookie', h.cookie)
      .expect(400);
  });

  it('allows only one concurrent manual confirmation', async () => {
    const hold = await h.hold().expect(201);
    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        h
          .http()
          .patch(`/reservations/${hold.body.id}/confirm`)
          .set('Cookie', h.cookie),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400, 400]);
    expect((await reservation(hold.body.id)).status).toBe('CONFIRMED');
  });

  it('cancellation releases availability, cannot be confirmed, and requires authentication', async () => {
    const range = h.range();
    const hold = await h.hold(range).expect(201);
    await h.http().patch(`/reservations/${hold.body.id}/cancel`).expect(401);
    await h
      .http()
      .patch(`/reservations/${hold.body.id}/cancel`)
      .set('Cookie', h.cookie)
      .expect(200);
    expect((await reservation(hold.body.id)).status).toBe('CANCELLED');
    await h
      .http()
      .patch(`/reservations/${hold.body.id}/confirm`)
      .set('Cookie', h.cookie)
      .expect(400);
    await h
      .http()
      .patch(`/reservations/${hold.body.id}/cancel`)
      .set('Cookie', h.cookie)
      .expect(400);
    expect(
      (await h.availability(range).expect(200)).body.map((l: any) => l.id),
    ).toContain(h.lockerId);
  });
});

describe('signed Stripe webhooks with mocked external payment creation', () => {
  it('creates a CAD intent for a valid hold with a stable retry idempotency key', async () => {
    const hold = await h.hold().expect(201);
    for (let i = 0; i < 2; i++) {
      const intent = await h
        .http()
        .post('/public/payments/create-intent')
        .send({ reservationId: hold.body.id })
        .expect(201);
      expect(intent.body).toMatchObject({
        amount: 500,
        currency: 'cad',
        metadata: { reservationId: hold.body.id },
      });
    }
    expect(h.intent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ amount: 500 }),
      { idempotencyKey: `reservation:${hold.body.id}` },
    );
    expect(h.intent.mock.calls[1][1]).toEqual(h.intent.mock.calls[0][1]);
    expect((await reservation(hold.body.id)).status).toBe('HOLD');
  });

  it('accepts a signed success once, even with concurrent duplicate delivery', async () => {
    const hold = await h.hold().expect(201);
    await h.availability().expect(200);
    const payload = h.event(hold.body.id);
    const results = await Promise.all([
      h.webhook(payload),
      h.webhook(payload),
      h.webhook(payload),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(results.filter((r) => r.body.duplicate)).toHaveLength(2);
    expect((await reservation(hold.body.id)).status).toBe('CONFIRMED');
    expect(await h.db.paymentEvent.count()).toBe(1);
    expect(await cacheKeys()).toHaveLength(0);
  });

  it('records failure events without confirming; a later success confirms and a delayed failure does not undo it', async () => {
    const hold = await h.hold().expect(201);
    await h
      .webhook(h.event(hold.body.id, 'payment_intent.payment_failed'))
      .expect(201);
    expect((await reservation(hold.body.id)).status).toBe('HOLD');
    await h.webhook(h.event(hold.body.id)).expect(201);
    await h
      .webhook(h.event(hold.body.id, 'payment_intent.payment_failed'))
      .expect(201);
    expect((await reservation(hold.body.id)).status).toBe('CONFIRMED');
    expect(await h.db.paymentEvent.count()).toBe(3);
  });

  it('rejects invalid/missing signatures and tampered payloads without recording events', async () => {
    const hold = await h.hold().expect(201);
    const payload = h.event(hold.body.id);
    await h.webhook(payload, 'invalid').expect(400);
    const signature = h.stripe.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET!,
    });
    await h
      .webhook(payload.replace('succeeded', 'payment_failed'), signature)
      .expect(400);
    await h
      .http()
      .post('/payments/webhook')
      .send(JSON.parse(payload))
      .expect(400);
    expect(await h.db.paymentEvent.count()).toBe(0);
    expect((await reservation(hold.body.id)).status).toBe('HOLD');
  });

  it.each(['deadline', 'expired', 'cancelled'])(
    'does not resurrect a %s hold on late payment',
    async (state) => {
      const hold = await h.hold().expect(201);
      if (state === 'cancelled')
        await h
          .http()
          .patch(`/reservations/${hold.body.id}/cancel`)
          .set('Cookie', h.cookie)
          .expect(200);
      else {
        h.advance(600000);
        if (state === 'expired') await h.expire();
      }
      const prior = (await reservation(hold.body.id)).status;
      await h
        .http()
        .post('/public/payments/create-intent')
        .send({ reservationId: hold.body.id })
        .expect(400);
      expect(h.intent).not.toHaveBeenCalled();
      await h.webhook(h.event(hold.body.id)).expect(201);
      expect((await reservation(hold.body.id)).status).toBe(prior);
      expect(await h.db.paymentEvent.count()).toBe(1);
    },
  );

  it('rolls back event deduplication on handler error so the same delivery can be retried', async () => {
    const payload = h.event('missing-reservation');
    await h.webhook(payload).expect(404);
    expect(await h.db.paymentEvent.count()).toBe(0);
    await h.db.reservation.create({
      data: {
        id: 'missing-reservation',
        lockerId: h.lockerId,
        status: 'HOLD',
        startTime: new Date(h.now),
        endTime: new Date(h.now + 3600000),
        expiresAt: new Date(h.now + 600000),
      },
    });
    await h.webhook(payload).expect(201);
    expect((await reservation('missing-reservation')).status).toBe('CONFIRMED');
    expect(await h.db.paymentEvent.count()).toBe(1);
  });

  it('does not update a confirmed reservation on another success event', async () => {
    const hold = await h.hold().expect(201);
    await h.webhook(h.event(hold.body.id)).expect(201);
    const confirmed = await reservation(hold.body.id);
    h.advance(1000);
    await h.webhook(h.event(hold.body.id)).expect(201);
    expect((await reservation(hold.body.id)).updatedAt).toEqual(
      confirmed.updatedAt,
    );
    expect(await h.db.paymentEvent.count()).toBe(2);
  });

  it('does not consume success events with missing metadata', async () => {
    const payload = JSON.stringify({
      id: 'evt_missing_metadata',
      type: 'payment_intent.succeeded',
      data: { object: { metadata: {} } },
    });
    await h.webhook(payload).expect(400);
    await h.webhook(payload).expect(400);
    expect(await h.db.paymentEvent.count()).toBe(0);
  });

  it('rejects stale Stripe signatures through the real timestamp tolerance check', async () => {
    const hold = await h.hold().expect(201);
    const payload = h.event(hold.body.id);
    const signature = h.stripe.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET!,
      timestamp: Math.floor(h.now / 1000) - 301,
    });
    await h.webhook(payload, signature).expect(400);
    expect(await h.db.paymentEvent.count()).toBe(0);
  });

  it('keeps cancellation final when success and cancellation compete', async () => {
    const hold = await h.hold().expect(201);
    const results = await Promise.all([
      h.webhook(h.event(hold.body.id)),
      h
        .http()
        .patch(`/reservations/${hold.body.id}/cancel`)
        .set('Cookie', h.cookie),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 200]);
    expect((await reservation(hold.body.id)).status).toBe('CANCELLED');
  });
});

describe('existing admin unlock protocol with a simulated ESP32 (no hardware)', () => {
  it('rejects anonymous requests, wrong device credentials, and invalid pulse limits', async () => {
    await h
      .http()
      .post(`/v1/admin/devices/${h.deviceId}/unlock-requests`)
      .send({ pulseMs: 5000, reason: 'test' })
      .expect(401);
    await h
      .http()
      .get('/v1/device/commands/next')
      .set('Authorization', 'Bearer wrong')
      .expect(401);
    for (const ms of [0, -1, 5001, 0.5]) await h.unlock(ms).expect(400);
    expect(await h.db.deviceCommand.count()).toBe(0);
  });

  it.each(['OPEN', 'UNKNOWN'])(
    'refuses unlock and delivery with door %s',
    async (state) => {
      const command = await h.unlock().expect(202);
      await h.heartbeat(state);
      await h.unlock().expect(409);
      await h.next().expect(204);
      expect(
        (
          await h.db.deviceCommand.findUniqueOrThrow({
            where: { id: command.body.commandId },
          })
        ).result,
      ).toBeNull();
    },
  );

  it.each(['locker', 'device'])('refuses disabled %s', async (kind) => {
    if (kind === 'locker')
      await h.db.locker.update({
        where: { id: h.lockerId },
        data: { isActive: false },
      });
    else
      await h.db.lockerDevice.update({
        where: { id: h.deviceId },
        data: { enabled: false },
      });
    await h.unlock().expect(403);
    await h.next().expect(kind === 'locker' ? 204 : 401);
  });

  it('rejects offline requests and recovers after a fresh heartbeat', async () => {
    h.advance(15000);
    await h.unlock().expect(409);
    await h.next().expect(204);
    await h.heartbeat();
    await h.unlock().expect(202);
  });

  it('redelivers the same command ID without creating another and accepts identical completion only', async () => {
    const command = await h.unlock().expect(202);
    const first = await h.next().expect(200);
    const second = await h.next().expect(200);
    expect(first.body).toEqual(second.body);
    expect(first.body.commandId).toBe(command.body.commandId);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(await h.db.deviceCommand.count()).toBe(1);
    await h.result(command.body.commandId).expect(200);
    const completed = await h.db.deviceCommand.findUniqueOrThrow({
      where: { id: command.body.commandId },
    });
    h.advance(1000);
    await h.result(command.body.commandId).expect(200);
    await h.result(command.body.commandId, 'FAILED').expect(409);
    expect(
      (
        await h.db.deviceCommand.findUniqueOrThrow({
          where: { id: command.body.commandId },
        })
      ).completedAt,
    ).toEqual(completed.completedAt);
    await h.next().expect(204);
  });

  it('expires delivery exactly at ten seconds without claiming a physical outcome', async () => {
    const queued = await h.unlock().expect(202);
    h.advance(9999);
    await h.next().expect(200);
    h.advance(1);
    await h.next().expect(204);
    const stored = await h.db.deviceCommand.findUniqueOrThrow({
      where: { id: queued.body.commandId },
    });
    expect(stored.result).toBeNull();
    expect(stored.completedAt).toBeNull();
  });

  it('keeps an uncompleted command across a brief communication interruption', async () => {
    const queued = await h.unlock().expect(202);
    const first = await h.next().expect(200);
    h.advance(2000);
    await h.heartbeat();
    const redelivered = await h.next().expect(200);
    expect(redelivered.body.commandId).toBe(first.body.commandId);
    expect(redelivered.body.commandId).toBe(queued.body.commandId);
    expect(await h.db.deviceCommand.count()).toBe(1);
  });

  it('refuses an active output and an unarmed device', async () => {
    await h.heartbeat('CLOSED', 'ACTIVE');
    await h.unlock().expect(409);
    await h.heartbeat();
    await h.db.lockerDevice.update({
      where: { id: h.deviceId },
      data: { actuationEnabled: false },
    });
    await h.unlock().expect(403);
    expect(await h.db.deviceCommand.count()).toBe(0);
  });

  it('leaves expired commands unresolved, prevents retry, and accepts a late completion after reconnect', async () => {
    const command = await h.unlock().expect(202);
    await h.next().expect(200);
    h.advance(30001);
    await h.heartbeat();
    await h.next().expect(204);
    await h.unlock().expect(409);
    const list = await h
      .http()
      .get('/v1/admin/devices')
      .set('Cookie', h.cookie)
      .expect(200);
    expect(list.body[0].commands[0].status).toBe('EXPIRED_UNKNOWN');
    expect(list.body[0].unlock.allowed).toBe(false);
    expect(
      (
        await h.db.deviceCommand.findUniqueOrThrow({
          where: { id: command.body.commandId },
        })
      ).result,
    ).toBeNull();
    await h.result(command.body.commandId).expect(200);
    expect(
      (
        await h.db.deviceCommand.findUniqueOrThrow({
          where: { id: command.body.commandId },
        })
      ).result,
    ).toBe('OUTPUT_PULSE_COMPLETED');
    await h.next().expect(204);
    expect(await h.db.deviceCommand.count()).toBe(1);
  });

  it('blocks subsequent unlocks after UNKNOWN even after cooldown', async () => {
    const command = await h.unlock().expect(202);
    await h.result(command.body.commandId, 'UNKNOWN').expect(200);
    h.advance(30001);
    await h.heartbeat();
    await h.unlock().expect(409);
    expect(await h.db.deviceCommand.count()).toBe(1);
  });

  it.each([false, true])(
    'enforces cooldown at its boundary (short bench mode=%s)',
    async (short) => {
      if (short) process.env.DEVICE_BENCH_SHORT_COOLDOWN = '1';
      try {
        const command = await h.unlock().expect(202);
        h.advance(5000);
        await h.result(command.body.commandId).expect(200);
        const stored = await h.db.deviceCommand.findUniqueOrThrow({
          where: { id: command.body.commandId },
        });
        const deadline = short
          ? stored.completedAt!.getTime() + 5000
          : stored.issuedAt.getTime() + 30000;
        h.advance(deadline - h.now - 1);
        await h.heartbeat();
        await h.unlock().expect(409);
        h.advance(1);
        await h.unlock().expect(202);
      } finally {
        delete process.env.DEVICE_BENCH_SHORT_COOLDOWN;
      }
    },
  );
});

it('runs availability → hold → signed payment → admin-authorized simulated output completion', async () => {
  const range = {
    startTime: new Date(h.now).toISOString(),
    endTime: new Date(h.now + 3600000).toISOString(),
  };
  expect(
    (await h.availability(range).expect(200)).body.map((l: any) => l.id),
  ).toContain(h.lockerId);
  const hold = await h.hold(range).expect(201);
  const intent = await h
    .http()
    .post('/public/payments/create-intent')
    .send({ reservationId: hold.body.id })
    .expect(201);
  const payload = h.event(hold.body.id);
  await h.webhook(payload).expect(201);
  expect((await reservation(hold.body.id)).status).toBe('CONFIRMED');
  // Actual contract: the admin cookie authorizes this bench action. There is no
  // reservation ownership/payment authorization endpoint on main yet.
  const queued = await h.unlock().expect(202);
  const delivered = await h.next().expect(200);
  expect(delivered.body).toMatchObject({
    protocolVersion: 1,
    commandId: queued.body.commandId,
    type: 'UNLOCK_PULSE',
    deviceId: h.deviceId,
    lockerId: h.lockerId,
    pulseMs: 5000,
  });
  await h.heartbeat('CLOSED', 'ACTIVE');
  h.advance(5000);
  await h.heartbeat('CLOSED', 'INACTIVE');
  await h.result(queued.body.commandId).expect(200);
  const stored = await h.db.deviceCommand.findUniqueOrThrow({
    where: { id: queued.body.commandId },
  });
  expect(stored).toMatchObject({
    result: 'OUTPUT_PULSE_COMPLETED',
    requestedBy: process.env.ADMIN_EMAIL,
    reason: 'Automated simulation; no hardware',
    lockerId: h.lockerId,
  });
  expect(stored.completedAt).not.toBeNull();
  expect(
    await h.db.paymentEvent.count({
      where: { stripeEventId: JSON.parse(payload).id },
    }),
  ).toBe(1);
  expect(intent.body.metadata.reservationId).toBe(hold.body.id);
  expect((await reservation(hold.body.id)).status).toBe('CONFIRMED');
  expect((await h.availability(range).expect(200)).body).toEqual([]);
  const activity = await h
    .http()
    .get('/v1/admin/devices')
    .set('Cookie', h.cookie)
    .expect(200);
  expect(activity.body[0].commands[0].status).toBe('OUTPUT_PULSE_COMPLETED');
  // No assertion about a physical latch: the simulator has no physical hardware.
});

// Explicit scope boundary: a green suite must not imply customer access control.
it('documents that admin bench authorization is independent of reservation/payment state', async () => {
  expect(await h.db.reservation.count()).toBe(0);
  await h.unlock().expect(202);
  expect(await h.db.deviceCommand.count()).toBe(1);
});
