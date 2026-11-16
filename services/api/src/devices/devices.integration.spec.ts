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
  it('preserves the latest contact across delayed, duplicate, and dropped reports', async () => {
    const http = app.getHttpServer();
    const sample = Date.now() - 200;
    const report = (doorState: string, observedAtMs?: number) => request(http)
      .post('/v1/device/heartbeat').set('Authorization', 'Bearer ' + token)
      .send({ doorState, observedAtMs, outputState: 'INACTIVE', firmwareVersion: 'sim',
        actuationEnabled: true, maxPulseMs: 200 });
    await report('CLOSED', sample).expect(200);
    const start = performance.now();
    await report('OPEN', sample + 100).expect(200, { accepted: true });
    const listed = await request(http).get('/v1/admin/devices').set('Cookie', cookie).expect(200);
    expect(listed.body.find((d: {id: string}) => d.id === deviceId).doorState).toBe('OPEN');
    if (process.env.LOCKER_DOOR_TIMING) console.info('Local heartbeat POST + admin GET ms:', performance.now() - start);
    for (const stamp of [sample, sample + 100, undefined]) {
      await report('CLOSED', stamp).expect(200, { accepted: false, ignored: true });
    }
    await report('CLOSED', Date.now() - 20000).expect(400);
    expect(await db.lockerDevice.findUniqueOrThrow({ where: { id: deviceId } })).toMatchObject({
      doorState: 'OPEN', lastSeen: new Date(sample + 100),
    });
    await request(http).post('/v1/admin/devices/' + deviceId + '/unlock-requests').set('Cookie', cookie)
      .send({ pulseMs: 100, reason: 'stale test' }).expect(409);
    await report('UNKNOWN', sample + 101).expect(200);
    await report('CLOSED', Date.now()).expect(200, { accepted: true });
  });
  beforeEach(async () => {
    await db.lockerDevice.update({ where: { id: deviceId }, data: {
      doorObservedAt: null, lastSeen: null, doorState: 'UNKNOWN', enabled: true,
    } });
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
  it('serializes reboot, expiry and result reporting without lock inversion', async () => {
    const http = app.getHttpServer(),
      auth = 'Bearer ' + token;
    for (let i = 0; i < 5; i++) {
      const c = await db.deviceCommand.create({
        data: {
          deviceId,
          lockerId,
          requestedBy: 'test',
          reason: 'simulated concurrency',
          pulseMs: 100,
          expiresAt: new Date(Date.now() - 1),
        },
      });
      const [heartbeat, result] = await Promise.all([
        request(http)
          .post('/v1/device/heartbeat')
          .set('Authorization', auth)
          .send({
            doorState: 'CLOSED',
            outputState: 'INACTIVE',
            firmwareVersion: 'simulated',
            actuationEnabled: true,
            maxPulseMs: 5000,
            diagnostics: {
              bootId: String(i + 1).repeat(32),
              uptimeMs: 100,
              resetReason: 'SW',
              wifiDisconnects: 0,
              communicationFailures: 0,
            },
          }),
        request(http)
          .post(`/v1/device/commands/${c.id}/result`)
          .set('Authorization', auth)
          .send({ result: 'UNKNOWN', reason: 'SIMULATED_INTERRUPTION' }),
        new DeviceReliabilityService(db).sweep(),
      ]);
      expect(heartbeat.status).toBe(200);
      expect(result.status).toBe(200);
      expect(
        (await db.deviceCommand.findUniqueOrThrow({ where: { id: c.id } }))
          .result,
      ).toBe('UNKNOWN');
      expect(
        await db.deviceEvent.count({
          where: { commandId: c.id, type: 'COMMAND_OUTCOME_UNKNOWN' },
        }),
      ).toBe(1);
    }
  }, 30000);
  it('atomically combines door timestamps, boot changes, reconnects and command recovery', async () => {
    // The background sweep is tested above; keep snapshots deterministic here.
    const scheduler = app.get(SchedulerRegistry);
    for (const interval of scheduler.getIntervals()) scheduler.deleteInterval(interval);
    // Start an independent health session after the preceding recovery scenarios.
    await db.deviceCommand.deleteMany({ where: { deviceId } });
    await db.deviceEvent.deleteMany({ where: { deviceId } });
    await db.deviceHealth.deleteMany({ where: { deviceId } });
    const sampled = Date.now() - 500;
    const diagnostics = {
      bootId: 'c'.repeat(32), uptimeMs: 1000, resetReason: 'POWERON',
      wifiDisconnects: 0, communicationFailures: 0,
    };
    const body = {
      doorState: 'OPEN', observedAtMs: sampled, outputState: 'INACTIVE',
      firmwareVersion: 'simulated', actuationEnabled: true, maxPulseMs: 5000,
      diagnostics,
    };
    const report = (overrides: object = {}) => request(app.getHttpServer())
      .post('/v1/device/heartbeat').set('Authorization', 'Bearer ' + token)
      .send({ ...body, ...overrides });
    await report().expect(200, { accepted: true });
    const command = await db.deviceCommand.create({ data: {
      deviceId, lockerId, requestedBy: 'test', reason: 'simulated recovery',
      pulseMs: 100, expiresAt: new Date(Date.now() + 60000),
    } });
    const snapshot = async () => ({
      device: await db.lockerDevice.findUniqueOrThrow({ where: { id: deviceId } }),
      health: await db.deviceHealth.findUniqueOrThrow({ where: { deviceId } }),
      events: await db.deviceEvent.findMany({ where: { deviceId }, orderBy: { id: 'asc' } }),
      command: await db.deviceCommand.findUniqueOrThrow({ where: { id: command.id } }),
    });
    const before = await snapshot();
    const newBoot = { ...diagnostics, bootId: 'd'.repeat(32), uptimeMs: 100 };
    for (const observedAtMs of [sampled - 1, sampled, undefined]) {
      await report({ observedAtMs, doorState: 'CLOSED', diagnostics: newBoot })
        .expect(200, { accepted: false, ignored: true });
      expect(await snapshot()).toEqual(before);
    }
    for (const observedAtMs of [Date.now() - 60000, Date.now() + 60000, 1.5]) {
      await report({ observedAtMs, doorState: 'CLOSED', diagnostics: newBoot }).expect(400);
      expect(await snapshot()).toEqual(before);
    }
    // A newer door timestamp must not bypass duplicate/decreasing diagnostics.
    for (const d of [diagnostics, { ...diagnostics, uptimeMs: 999 },
      { ...diagnostics, uptimeMs: 2000, wifiDisconnects: -1 }]) {
      await report({ observedAtMs: sampled + 1, doorState: 'CLOSED', diagnostics: d })
        .expect(d.wifiDisconnects < 0 ? 400 : 200);
      expect(await snapshot()).toEqual(before);
    }
    const priorFreshness = process.env.DEVICE_HEARTBEAT_FRESH_MS;
    try {
      process.env.DEVICE_HEARTBEAT_FRESH_MS = '1000';
      await report({ observedAtMs: Date.now() - 2000, diagnostics: newBoot }).expect(400);
      expect(await snapshot()).toEqual(before);
    } finally {
      if (priorFreshness === undefined) delete process.env.DEVICE_HEARTBEAT_FRESH_MS;
      else process.env.DEVICE_HEARTBEAT_FRESH_MS = priorFreshness;
    }
    // Both clocks advance: one atomic reboot observation invalidates old work.
    await report({ observedAtMs: sampled + 2, diagnostics: newBoot })
      .expect(200, { accepted: true });
    const rebooted = await snapshot();
    expect(rebooted.device.doorState).toBe('OPEN');
    expect(rebooted.device.lastSeen).toEqual(new Date(sampled + 2));
    expect(rebooted.health.bootId).toBe(newBoot.bootId);
    expect(rebooted.command.result).toBeNull();
    expect(rebooted.command.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(rebooted.events.filter(e => e.type === 'DEVICE_RESTART_DETECTED')).toHaveLength(1);
    await report({ observedAtMs: sampled + 3, diagnostics: { ...diagnostics, uptimeMs: 9000 } })
      .expect(200, { accepted: false, ignored: true });
    expect(await snapshot()).toEqual(rebooted);
    await db.lockerDevice.update({ where: { id: deviceId }, data: { lastSeen: new Date(Date.now() - 20000) } });
    await report({ observedAtMs: sampled + 4, diagnostics: { ...newBoot, uptimeMs: 200, wifiDisconnects: 1 } })
      .expect(200, { accepted: true });
    const reconnected = await snapshot();
    expect(reconnected.health.offline).toBe(false);
    expect(reconnected.events.map(e => e.type)).toEqual(expect.arrayContaining([
      'DEVICE_RECONNECTED', 'WIFI_INTERRUPTION_REPORTED', 'REBOOT_WITH_UNRESOLVED_COMMAND',
    ]));
  });

});
