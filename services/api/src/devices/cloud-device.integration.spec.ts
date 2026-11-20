import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { DevicesModule } from './devices.module';
import { randomUUID } from 'crypto';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request = require('supertest');
// Only this suite's disposable fixture is passed to the privileged CLI helper.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { credentialOperation } = require('../../scripts/staging-device.cjs');
const suite =
  process.env.RUN_DEVICE_DB_TESTS === '1' ? describe : describe.skip;

suite('cloud non-actuating provisioning and device communication', () => {
  let app: INestApplication,
    db: PrismaService,
    lockerId: string,
    folder: string;
  let token: string, cookie: string;
  const deviceId = 'staging-sim-' + randomUUID();
  const prior = process.env.DEVICE_MAX_PULSE_MS;
  const priorCustomer = process.env.CUSTOMER_UNLOCK_PULSE_MS;
  const options = {
    deviceId,
    actor: 'isolated-test-operator',
    reason: 'Simulated cloud provisioning, no hardware',
  };
  beforeAll(async () => {
    process.env.DEVICE_MAX_PULSE_MS = '0';
    process.env.CUSTOMER_UNLOCK_PULSE_MS = '0';
    const module = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot(), AuthModule, DevicesModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(PrismaService);
    folder = mkdtempSync(join(tmpdir(), 'cloud-device-api-'));
    lockerId = (
      await db.locker.create({
        data: {
          code: deviceId,
          location: 'Isolated simulated cloud device — no hardware',
        },
      })
    ).id;
    const tokenFile = join(folder, 'token');
    await credentialOperation(db, {
      ...options,
      operation: 'create',
      lockerId,
      tokenFile,
    });
    token = readFileSync(tokenFile, 'utf8').trim();
    const jwt = await app
      .get(JwtService)
      .signAsync(
        { sub: options.actor, role: 'admin' },
        { secret: process.env.JWT_SECRET, expiresIn: '5m' },
      );
    cookie = 'locker_reserve_admin=' + jwt;
  });
  afterAll(async () => {
    if (db) {
      await db.deviceCommand.deleteMany({ where: { deviceId } });
      await db.lockerDevice.deleteMany({ where: { id: deviceId } });
      if (lockerId) await db.locker.delete({ where: { id: lockerId } });
    }
    if (app) await app.close();
    if (folder) rmSync(folder, { recursive: true, force: true });
    if (prior === undefined) delete process.env.DEVICE_MAX_PULSE_MS;
    else process.env.DEVICE_MAX_PULSE_MS = prior;
    if (priorCustomer === undefined)
      delete process.env.CUSTOMER_UNLOCK_PULSE_MS;
    else process.env.CUSTOMER_UNLOCK_PULSE_MS = priorCustomer;
  });
  it('authenticates, observes contacts, polls safely, rotates and revokes without changing history', async () => {
    const http = app.getHttpServer();
    const heartbeat = (doorState: string, stamp: number) =>
      request(http)
        .post('/v1/device/heartbeat')
        .set('Authorization', 'Bearer ' + token)
        .send({
          doorState,
          observedAtMs: stamp,
          outputState: 'INACTIVE',
          firmwareVersion: 'staging-sim-no-hardware',
          actuationEnabled: false,
          maxPulseMs: 0,
        });
    const now = Date.now() - 100;
    await heartbeat('CLOSED', now).expect(200, { accepted: true });
    await heartbeat('OPEN', now + 1).expect(200, { accepted: true });
    await heartbeat('CLOSED', now).expect(200, {
      accepted: false,
      ignored: true,
    });
    await heartbeat('CLOSED', now - 20000).expect(400);
    await request(http)
      .get('/v1/device/commands/next')
      .set('Authorization', 'Bearer invalid-fixture')
      .expect(401);
    await request(http)
      .get('/v1/device/commands/next')
      .set('Authorization', 'Bearer ' + token)
      .expect(204);
    await heartbeat('CLOSED', now + 2).expect(200, { accepted: true });
    await request(http)
      .post(`/v1/admin/devices/${deviceId}/unlock-requests`)
      .set('Cookie', cookie)
      .send({ pulseMs: 100, reason: 'simulated cloud request' })
      .expect(403);
    expect(await db.deviceCommand.count({ where: { deviceId } })).toBe(0);
    // Synthetic queued fixture: server zero must prevent delivery even if
    // capability flags were accidentally advertised by a device.
    const command = await db.deviceCommand.create({
      data: {
        deviceId,
        lockerId,
        requestedBy: options.actor,
        reason: 'synthetic history',
        pulseMs: 100,
        expiresAt: new Date(Date.now() + 10000),
      },
    });
    await db.lockerDevice.update({
      where: { id: deviceId },
      data: { actuationEnabled: true, maxPulseMs: 100 },
    });
    await request(http)
      .get('/v1/device/commands/next')
      .set('Authorization', 'Bearer ' + token)
      .expect(204);
    const rotation = join(folder, 'rotated-token');
    await credentialOperation(db, {
      ...options,
      operation: 'rotate',
      tokenFile: rotation,
    });
    await request(http)
      .get('/v1/device/commands/next')
      .set('Authorization', 'Bearer ' + token)
      .expect(401);
    token = readFileSync(rotation, 'utf8').trim();
    await heartbeat('CLOSED', now + 3).expect(200, { accepted: true });
    await credentialOperation(db, { ...options, operation: 'revoke' });
    await heartbeat('OPEN', now + 4).expect(401);
    await request(http)
      .get('/v1/device/commands/next')
      .set('Authorization', 'Bearer ' + token)
      .expect(401);
    expect(
      await db.deviceCommand.findUnique({ where: { id: command.id } }),
    ).toEqual(command);
    const events = await db.deviceEvent.findMany({
      where: { deviceId, type: { startsWith: 'CREDENTIAL_' } },
      orderBy: { timestamp: 'asc' },
    });
    expect(events.map((e) => e.type)).toEqual([
      'CREDENTIAL_CREATE',
      'CREDENTIAL_ROTATE',
      'CREDENTIAL_REVOKE',
    ]);
    expect(JSON.stringify(events)).not.toContain(token);
    expect(
      (await db.lockerDevice.findUniqueOrThrow({ where: { id: deviceId } }))
        .lockerId,
    ).toBe(lockerId);
  });
});
