import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { DeviceReliabilityService } from './device-reliability.service';
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
      imports: [ScheduleModule.forRoot(), AuthModule, DevicesModule],
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
  it('persists transitions across service instances and rejects stale/rebooted unlocks', async () => {
    const http = app.getHttpServer(),
      auth = 'Bearer ' + token;
    await db.lockerDevice.update({
      where: { id: deviceId },
      data: { enabled: true },
    });
    await db.deviceCommand.deleteMany({ where: { deviceId } });
    const diagnostics = {
      bootId: 'a'.repeat(32),
      uptimeMs: 1000,
      resetReason: 'POWERON',
      wifiDisconnects: 0,
      communicationFailures: 0,
    };
    const heartbeat = () =>
      request(http)
        .post('/v1/device/heartbeat')
        .set('Authorization', auth)
        .send({
          doorState: 'CLOSED',
          outputState: 'INACTIVE',
          firmwareVersion: 'simulated',
          actuationEnabled: true,
          maxPulseMs: 5000,
          diagnostics,
        });
    await heartbeat().expect(200);
    const originalSeen = (
      await db.lockerDevice.findUniqueOrThrow({ where: { id: deviceId } })
    ).lastSeen;
    await Promise.all([heartbeat().expect(200), heartbeat().expect(200)]);
    expect(
      (await db.lockerDevice.findUniqueOrThrow({ where: { id: deviceId } }))
        .lastSeen,
    ).toEqual(originalSeen);
    expect(
      await db.deviceEvent.count({
        where: { deviceId, type: 'DEVICE_BOOT_OBSERVED' },
      }),
    ).toBe(1);
    const old = new Date(Date.now() - 20000);
    await db.lockerDevice.update({
      where: { id: deviceId },
      data: { lastSeen: old },
    });
    await Promise.all([
      new DeviceReliabilityService(db).sweep(),
      new DeviceReliabilityService(db).sweep(),
    ]);
    expect(
      await db.deviceEvent.count({
        where: {
          deviceId,
          type: 'HEARTBEAT_STALE',
          dedupeKey: `${deviceId}:offline:${old.toISOString()}`,
        },
      }),
    ).toBe(1);
    await request(http)
      .post(`/v1/admin/devices/${deviceId}/unlock-requests`)
      .set('Cookie', cookie)
      .send({ pulseMs: 5000, reason: 'stale state' })
      .expect(409);
    diagnostics.uptimeMs += 1000;
    diagnostics.communicationFailures = 2;
    diagnostics.wifiDisconnects = 1;
    await heartbeat().expect(200);
    const queued = await request(http)
      .post(`/v1/admin/devices/${deviceId}/unlock-requests`)
      .set('Cookie', cookie)
      .send({ pulseMs: 5000, reason: 'simulated reboot test' })
      .expect(202);
    const commandId = queued.body.commandId;
    diagnostics.bootId = 'b'.repeat(32);
    diagnostics.uptimeMs = 100;
    diagnostics.resetReason = 'BROWNOUT';
    diagnostics.communicationFailures = 0;
    diagnostics.wifiDisconnects = 0;
    await heartbeat().expect(200);
    await request(http)
      .get('/v1/device/commands/next')
      .set('Authorization', auth)
      .expect(204);
    await request(http)
      .post(`/v1/admin/devices/${deviceId}/unlock-requests`)
      .set('Cookie', cookie)
      .send({ pulseMs: 100, reason: 'must not replace unresolved' })
      .expect(409);
    const command = await db.deviceCommand.findUniqueOrThrow({
      where: { id: commandId },
    });
    expect(command.result).toBeNull();
    expect(command.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    await new DeviceReliabilityService(db).sweep();
    await new DeviceReliabilityService(db).sweep();
    expect(
      await db.deviceEvent.count({
        where: { deviceId, type: 'COMMAND_EXPIRED_UNKNOWN', commandId },
      }),
    ).toBe(1);
    // The device's persisted journal can still supply a late result without any reactivation.
    await request(http)
      .post(`/v1/device/commands/${commandId}/result`)
      .set('Authorization', auth)
      .send({ result: 'UNKNOWN', reason: 'INTERRUPTED_OR_NOT_STARTED' })
      .expect(200);
    await request(http)
      .post(`/v1/device/commands/${commandId}/result`)
      .set('Authorization', auth)
      .send({ result: 'UNKNOWN', reason: 'INTERRUPTED_OR_NOT_STARTED' })
      .expect(200);
    await request(http)
      .get(`/v1/admin/devices/${deviceId}/reliability`)
      .expect(401);
    const history = await request(http)
      .get(`/v1/admin/devices/${deviceId}/reliability`)
      .set('Cookie', cookie)
      .expect(200);
    const types = history.body.events.map((e: any) => e.type);
    for (const type of [
      'DEVICE_RESTART_DETECTED',
      'BROWNOUT_REPORTED',
      'DEVICE_RECONNECTED',
      'REBOOT_WITH_UNRESOLVED_COMMAND',
      'COMMAND_OUTCOME_UNKNOWN',
      'COMMUNICATION_FAILURE_REPORTED',
    ])
      expect(types).toContain(type);
    expect(JSON.stringify(history.body)).not.toContain(token);
    expect(history.body.health.bootId).toBe('b'.repeat(32));
    // Delayed report from a retired boot cannot restore an old CLOSED observation.
    const seen = (
      await db.lockerDevice.findUniqueOrThrow({ where: { id: deviceId } })
    ).lastSeen;
    diagnostics.bootId = 'a'.repeat(32);
    diagnostics.uptimeMs = 9000;
    const ignored = await heartbeat().expect(200);
    expect(ignored.body.ignored).toBe(true);
    expect(
      (await db.lockerDevice.findUniqueOrThrow({ where: { id: deviceId } }))
        .lastSeen,
    ).toEqual(seen);
  }, 30000);
  it('registers background detection and observes a silent device without requests', async () => {
    expect(app.get(SchedulerRegistry).getIntervals().length).toBeGreaterThan(0);
    const stale = new Date(Date.now() - 60000);
    await db.lockerDevice.update({
      where: { id: deviceId },
      data: { lastSeen: stale },
    });
    await db.deviceHealth.update({
      where: { deviceId },
      data: { offline: false },
    });
    const deadline = Date.now() + 8000;
    let observed = false;
    while (Date.now() < deadline) {
      const health = await db.deviceHealth.findUniqueOrThrow({
        where: { deviceId },
      });
      if (health.offline) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(observed).toBe(true);
    expect(
      await db.deviceEvent.count({
        where: { dedupeKey: `${deviceId}:offline:${stale.toISOString()}` },
      }),
    ).toBe(1);
  }, 10000);
});
