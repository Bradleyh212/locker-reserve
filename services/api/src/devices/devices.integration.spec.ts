import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { DevicesModule } from './devices.module';
import { createHash, randomBytes, randomUUID } from 'crypto';
import request = require('supertest');

// Opt in against the local development database only. Fixtures are isolated and removed.
const suite =
  process.env.RUN_DEVICE_DB_TESTS === '1' ? describe : describe.skip;
suite('device HTTP + PostgreSQL integration', () => {
  let app: INestApplication,
    db: PrismaService,
    cookie: string,
    lockerId: string;
  const deviceId = 'test-' + randomUUID(),
    token = randomBytes(32).toString('hex');
  const priorLimit = process.env.DEVICE_MAX_PULSE_MS;
  beforeAll(async () => {
    process.env.DEVICE_MAX_PULSE_MS = '5000';
    const m = await Test.createTestingModule({
      imports: [AuthModule, DevicesModule],
    }).compile();
    app = m.createNestApplication();
    await app.init();
    db = app.get(PrismaService);
    const l = await db.locker.create({
      data: { code: deviceId, location: 'automated-test' },
    });
    lockerId = l.id;
    await db.lockerDevice.create({
      data: {
        id: deviceId,
        lockerId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
      },
    });
    const jwt = await app
      .get(JwtService)
      .signAsync(
        { sub: 'automated-test', role: 'admin' },
        { secret: process.env.JWT_SECRET, expiresIn: '5m' },
      );
    cookie = 'locker_reserve_admin=' + jwt;
  }, 30000);
  afterAll(async () => {
    if (db) {
      await db.deviceCommand.deleteMany({ where: { deviceId } });
      await db.lockerDevice.deleteMany({ where: { id: deviceId } });
      if (lockerId) await db.locker.delete({ where: { id: lockerId } });
      await db.$disconnect();
    }
    if (app) await app.close();
    if (priorLimit === undefined) delete process.env.DEVICE_MAX_PULSE_MS;
    else process.env.DEVICE_MAX_PULSE_MS = priorLimit;
  });
  it('authenticates both sides, serializes requests, re-delivers same ID, and records idempotent results', async () => {
    const http = app.getHttpServer(),
      auth = 'Bearer ' + token;
    await request(http).get('/v1/admin/devices').expect(401);
    await request(http).get('/v1/device/commands/next').expect(401);
    await request(http)
      .post('/v1/device/heartbeat')
      .set('Authorization', auth)
      .send({
        doorState: 'CLOSED',
        outputState: 'INACTIVE',
        firmwareVersion: 'simulated',
        actuationEnabled: true,
        maxPulseMs: 5000,
      })
      .expect(200);
    const list = await request(http)
      .get('/v1/admin/devices')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body.find((d: any) => d.id === deviceId).online).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain('tokenHash');
    // API calls (not dashboard restrictions) enforce door and freshness.
    for (const doorState of ['OPEN', 'UNKNOWN']) {
      await db.lockerDevice.update({
        where: { id: deviceId },
        data: { doorState },
      });
      await request(http)
        .post(`/v1/admin/devices/${deviceId}/unlock-requests`)
        .set('Cookie', cookie)
        .send({ pulseMs: 100, reason: 'blocked door' })
        .expect(409);
    }
    await db.lockerDevice.update({
      where: { id: deviceId },
      data: { doorState: 'CLOSED', lastSeen: new Date(0) },
    });
    await request(http)
      .post(`/v1/admin/devices/${deviceId}/unlock-requests`)
      .set('Cookie', cookie)
      .send({ pulseMs: 100, reason: 'blocked offline' })
      .expect(409);
    await db.lockerDevice.update({
      where: { id: deviceId },
      data: { lastSeen: new Date() },
    });
    await request(http)
      .post(`/v1/admin/devices/${deviceId}/unlock-requests`)
      .set('Cookie', cookie)
      .send({ pulseMs: 5001, reason: 'over hard ceiling' })
      .expect(400);
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(http)
          .post(`/v1/admin/devices/${deviceId}/unlock-requests`)
          .set('Cookie', cookie)
          .send({ pulseMs: 5000, reason: 'automated fake device' }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([202, 409]);
    const id = responses.find((r) => r.status === 202)!.body.commandId;
    // A door change between enqueue and polling prevents delivery.
    await db.lockerDevice.update({
      where: { id: deviceId },
      data: { doorState: 'OPEN' },
    });
    await request(http)
      .get('/v1/device/commands/next')
      .set('Authorization', auth)
      .expect(204);
    await db.lockerDevice.update({
      where: { id: deviceId },
      data: { doorState: 'CLOSED' },
    });
    const first = await request(http)
      .get('/v1/device/commands/next')
      .set('Authorization', auth)
      .expect(200);
    const second = await request(http)
      .get('/v1/device/commands/next')
      .set('Authorization', auth)
      .expect(200);
    expect(first.body.commandId).toBe(id);
    expect(first.body.pulseMs).toBe(5000);
    expect(second.body.commandId).toBe(id);
    expect(first.headers['cache-control']).toBe('no-store');
    const result = {
      result: 'OUTPUT_PULSE_COMPLETED',
      reason: 'SIMULATED_NO_HARDWARE',
    };
    await request(http)
      .post(`/v1/device/commands/${id}/result`)
      .set('Authorization', auth)
      .send(result)
      .expect(200);
    await request(http)
      .post(`/v1/device/commands/${id}/result`)
      .set('Authorization', auth)
      .send(result)
      .expect(200);
    await request(http)
      .post(`/v1/device/commands/${id}/result`)
      .set('Authorization', auth)
      .send({ result: 'FAILED', reason: 'different' })
      .expect(409);
    await request(http)
      .get('/v1/device/commands/next')
      .set('Authorization', auth)
      .expect(204);
    const stored = await db.deviceCommand.findUniqueOrThrow({ where: { id } });
    expect(stored.requestedBy).toBe('automated-test');
    // Expired/unacknowledged commands cannot be replayed or silently replaced.
    await db.deviceCommand.update({
      where: { id },
      data: {
        result: null,
        resultReason: null,
        issuedAt: new Date(0),
        expiresAt: new Date(1000),
      },
    });
    await request(http)
      .get('/v1/device/commands/next')
      .set('Authorization', auth)
      .expect(204);
    await request(http)
      .post(`/v1/admin/devices/${deviceId}/unlock-requests`)
      .set('Cookie', cookie)
      .send({ pulseMs: 100, reason: 'blocked retry' })
      .expect(409);
    await db.lockerDevice.update({
      where: { id: deviceId },
      data: { enabled: false },
    });
    await request(http)
      .get('/v1/device/commands/next')
      .set('Authorization', auth)
      .expect(401);
  }, 30000);
});
