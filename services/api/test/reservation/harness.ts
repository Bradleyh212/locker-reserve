import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { createHash, randomUUID } from 'crypto';
import { hashSync } from 'bcryptjs';
import { createClient } from 'redis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PaymentsService } from '../../src/payments/payments.service';
import { ReservationsService } from '../../src/reservations/reservations.service';
import Stripe from 'stripe';
type StripeClient = InstanceType<typeof Stripe>;

export class Harness {
  app: INestApplication;
  db: PrismaService;
  redis = createClient({
    url: process.env.REDIS_URL,
    socket: { reconnectStrategy: false },
  });
  cookie: string;
  lockerId: string;
  deviceId = 'reservation-e2e-simulated-device';
  token = 'reservation-e2e-simulated-device-token';
  intent: jest.SpyInstance;
  stripe: StripeClient;
  now: number;
  eventNumber = 0;
  private lease = randomUUID();
  private ownsLease = false;
  private readonly leaseKey = 'reservation-e2e:suite-lock';
  http() {
    return request(this.app.getHttpServer());
  }
  async start() {
    this.redis.on('error', () => {
      /* connect/command promises surface Redis failures. */
    });
    await this.redis.connect();
    this.ownsLease =
      (await this.redis.set(this.leaseKey, this.lease, { NX: true })) === 'OK';
    if (!this.ownsLease)
      throw new Error(
        'Another reservation suite owns this Redis/database pair. Use separate test services.',
      );
    process.env.ADMIN_PASSWORD_HASH = hashSync('e2e-password', 4);
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    this.app = module.createNestApplication({ rawBody: true });
    // Mock only outbound Stripe creation; use the real signature parser/handler.
    this.stripe = (
      this.app.get(PaymentsService) as unknown as { stripe: StripeClient }
    ).stripe;
    this.intent = jest
      .spyOn(this.stripe.paymentIntents, 'create')
      .mockImplementation(
        async (params: any) =>
          ({
            id: `pi_e2e_${params.metadata.reservationId}`,
            object: 'payment_intent',
            client_secret: 'test_fixture_client_secret',
            ...params,
          }) as any,
      );
    this.db = this.app.get(PrismaService);
    await this.app.listen(0, '127.0.0.1');
    // Expiration is invoked explicitly after advancing Date; no cron races or sleeps.
    for (const job of this.app.get(SchedulerRegistry).getCronJobs().values())
      job.stop();
  }
  async reset() {
    if (!this.ownsLease) throw new Error('Test isolation lease not acquired');
    jest.useRealTimers();
    this.now = Date.now();
    jest.useFakeTimers({
      now: this.now,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    await this.db.deviceCommand.deleteMany();
    await this.db.lockerDevice.deleteMany();
    await this.db.reservation.deleteMany();
    await this.db.paymentEvent.deleteMany();
    await this.db.locker.deleteMany();
    const cacheKeys = await this.redis.keys('lockers:*');
    if (cacheKeys.length) await this.redis.del(cacheKeys);
    this.intent.mockClear();
    this.eventNumber = 0;
    this.lockerId = (
      await this.db.locker.create({
        data: { code: 'E2E-101', location: 'test-only' },
      })
    ).id;
    await this.db.lockerDevice.create({
      data: {
        id: this.deviceId,
        lockerId: this.lockerId,
        tokenHash: createHash('sha256').update(this.token).digest('hex'),
      },
    });
    const login = await this.http()
      .post('/auth/login')
      .send({
        email: process.env.ADMIN_EMAIL,
        password: 'e2e-password',
      })
      .expect(201);
    this.cookie = login.headers['set-cookie'][0].split(';')[0];
    await this.heartbeat();
  }
  advance(ms: number) {
    this.now += ms;
    jest.setSystemTime(this.now);
  }
  range(offset = 0) {
    return {
      startTime: new Date(this.now + 3600000 + offset).toISOString(),
      endTime: new Date(this.now + 7200000 + offset).toISOString(),
    };
  }
  hold(range = this.range()) {
    return this.http()
      .post('/public/reservations/hold')
      .send({ lockerId: this.lockerId, ...range });
  }
  availability(range = this.range()) {
    return this.http().get('/public/lockers/availability').query(range);
  }
  heartbeat(doorState = 'CLOSED', outputState = 'INACTIVE') {
    return this.http()
      .post('/v1/device/heartbeat')
      .set('Authorization', `Bearer ${this.token}`)
      .send({
        doorState,
        outputState,
        firmwareVersion: 'e2e-simulator',
        actuationEnabled: true,
        maxPulseMs: 5000,
      })
      .expect(200);
  }
  unlock(pulseMs = 5000) {
    return this.http()
      .post(`/v1/admin/devices/${this.deviceId}/unlock-requests`)
      .set('Cookie', this.cookie)
      .send({ pulseMs, reason: 'Automated simulation; no hardware' });
  }
  next() {
    return this.http()
      .get('/v1/device/commands/next')
      .set('Authorization', `Bearer ${this.token}`);
  }
  result(id: string, result = 'OUTPUT_PULSE_COMPLETED') {
    return this.http()
      .post(`/v1/device/commands/${id}/result`)
      .set('Authorization', `Bearer ${this.token}`)
      .send({ result, reason: 'SIMULATED_NO_HARDWARE' });
  }
  event(
    reservationId: string,
    type = 'payment_intent.succeeded',
    id = `evt_e2e_${++this.eventNumber}`,
  ) {
    return JSON.stringify({
      id,
      object: 'event',
      type,
      data: {
        object: {
          id: `pi_e2e_${reservationId}`,
          object: 'payment_intent',
          metadata: { reservationId },
        },
      },
    });
  }
  webhook(payload: string, signature?: string) {
    const header =
      signature ??
      this.stripe.webhooks.generateTestHeaderString({
        payload,
        secret: process.env.STRIPE_WEBHOOK_SECRET!,
        timestamp: Math.floor(Date.now() / 1000),
      });
    return this.http()
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', header)
      .send(payload);
  }
  expire() {
    return this.app.get(ReservationsService).expireHolds();
  }
  // Hold the locker row so every competing request reaches its database wait
  // before release. Without the service lock, their INSERTs wait only after all
  // overlap reads have passed; with it, they wait before those reads.
  async competingHolds(count: number) {
    let release!: () => void;
    let acquired!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const blocker = this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Locker" WHERE "id" = ${this.lockerId} FOR UPDATE`;
        acquired();
        await gate;
      },
      { timeout: 10000 },
    );
    // Race against blocker failure so setup cannot hang before acquired().
    await Promise.race([locked, blocker]);
    const responses = Array.from({ length: count }, () =>
      this.hold().then((r) => r),
    );
    try {
      const deadline = performance.now() + 5000;
      while (true) {
        const waiting = await this.db.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND pid <> pg_backend_pid()
          AND (query LIKE '%"Locker"%' OR query LIKE '%"Reservation"%')`;
        if (waiting[0].count >= count) break;
        if (performance.now() > deadline)
          throw new Error(
            'Competing hold requests did not reach the database barrier',
          );
      }
    } finally {
      release();
      await blocker;
      await Promise.all(responses);
    }
    return Promise.all(responses);
  }

  async close() {
    jest.useRealTimers();
    try {
      if (this.ownsLease && this.db) {
        await this.db.deviceCommand.deleteMany();
        await this.db.lockerDevice.deleteMany();
        await this.db.reservation.deleteMany();
        await this.db.paymentEvent.deleteMany();
        await this.db.locker.deleteMany();
        const keys = await this.redis.keys('lockers:*');
        if (keys.length) await this.redis.del(keys);
      }
    } finally {
      try {
        if (this.app) await this.app.close();
      } finally {
        try {
          if (this.redis.isOpen) {
            if (this.ownsLease) await this.redis.del(this.leaseKey);
            await this.redis.close();
          }
        } finally {
          if (this.db) await this.db.$disconnect();
          this.intent?.mockRestore();
        }
      }
    }
  }
}
