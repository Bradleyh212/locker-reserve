import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { randomUUID, randomBytes, createHash } from 'crypto';
import request = require('supertest');
import { AuthModule } from '../auth/auth.module';
import { DevicesModule } from './devices.module';
import { PrismaService } from '../prisma/prisma.service';
import { DevicesService } from './devices.service';
import { DeviceReliabilityService } from './device-reliability.service';

const suite =
  process.env.RUN_DEVICE_DB_TESTS === '1' ? describe : describe.skip;
suite('operator acknowledgement HTTP/PostgreSQL safety', () => {
  let app: INestApplication,
    db: PrismaService,
    service: DevicesService,
    cookie: string,
    lockerId: string;
  const deviceId = 'test-review-' + randomUUID(),
    token = randomBytes(32).toString('hex');
  const body = {
    reason: 'Historical outcome cannot be established',
    evidence:
      'Operator inspected the isolated locker and verified its safe physical condition',
    physicalSafetyConfirmed: true,
  };
  const route = (id: string, device = deviceId) =>
    `/v1/admin/devices/${device}/commands/${id}/reconciliation`;
  const unlock = () =>
    request(app.getHttpServer())
      .post(`/v1/admin/devices/${deviceId}/unlock-requests`)
      .set('Cookie', cookie)
      .send({ pulseMs: 100, reason: 'simulated request only' });
  const result = (id: string, value = 'OUTPUT_PULSE_COMPLETED') =>
    request(app.getHttpServer())
      .post(`/v1/device/commands/${id}/result`)
      .set('Authorization', 'Bearer ' + token)
      .send({ result: value, reason: 'SIMULATED_DEVICE_REPORT' });
  const acknowledge = (id: string) =>
    request(app.getHttpServer())
      .post(route(id))
      .set('Cookie', cookie)
      .send(body);
  const make = (data: Record<string, unknown> = {}) =>
    db.deviceCommand.create({
      data: {
        deviceId,
        lockerId,
        requestedBy: 'fixture',
        reason: 'simulated historical command',
        pulseMs: 100,
        issuedAt: new Date(Date.now() - 120000),
        expiresAt: new Date(Date.now() - 110000),
        ...data,
      },
    });
  async function ready() {
    await db.lockerDevice.update({
      where: { id: deviceId },
      data: {
        enabled: true,
        actuationEnabled: true,
        lastSeen: new Date(Date.now() - 50),
        doorObservedAt: new Date(Date.now() - 50),
        doorState: 'CLOSED',
        outputState: 'INACTIVE',
        maxPulseMs: 200,
      },
    });
    await db.locker.update({
      where: { id: lockerId },
      data: { isActive: true },
    });
  }
  async function heartbeat(
    bootId = 'a'.repeat(32),
    uptimeMs = 2000,
    observedAtMs = Date.now(),
  ) {
    return request(app.getHttpServer())
      .post('/v1/device/heartbeat')
      .set('Authorization', 'Bearer ' + token)
      .send({
        doorState: 'CLOSED',
        outputState: 'INACTIVE',
        firmwareVersion: 'simulated',
        actuationEnabled: true,
        maxPulseMs: 200,
        observedAtMs,
        diagnostics: {
          bootId,
          uptimeMs,
          resetReason: 'POWERON',
          wifiDisconnects: 0,
          communicationFailures: 0,
        },
      });
  }
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !['/locker_reservation_e2e', '/locker_ci'].includes(target.pathname) ||
      process.env.NODE_ENV !== 'test'
    )
      throw new Error('Disposable test database required');
    process.env.DEVICE_MAX_PULSE_MS = '200';
    const module = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot(), AuthModule, DevicesModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    const scheduler = app.get(SchedulerRegistry);
    scheduler.getIntervals().forEach((id) => scheduler.deleteInterval(id));
    scheduler.getCronJobs().forEach((job) => job.stop());
    db = app.get(PrismaService);
    service = app.get(DevicesService);
    const locker = await db.locker.create({
      data: { code: deviceId, location: 'automated-test' },
    });
    lockerId = locker.id;
    await db.lockerDevice.create({
      data: {
        id: deviceId,
        lockerId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
      },
    });
    cookie =
      'locker_reserve_admin=' +
      (await app
        .get(JwtService)
        .signAsync(
          { sub: 'reviewing-admin', role: 'admin' },
          { secret: process.env.JWT_SECRET, expiresIn: '10m' },
        ));
  });
  beforeEach(async () => {
    await db.deviceEvent.deleteMany({ where: { deviceId } });
    await db.deviceCommand.deleteMany({ where: { deviceId } });
    await db.deviceHealth.deleteMany({ where: { deviceId } });
    await ready();
  });
  afterAll(async () => {
    if (db) {
      await db.deviceCommand.deleteMany({ where: { deviceId } });
      await db.lockerDevice.deleteMany({ where: { id: deviceId } });
      await db.locker.delete({ where: { id: lockerId } });
    }
    if (app) await app.close();
    delete process.env.DEVICE_MAX_PULSE_MS;
  });
  it('blocks an older unknown beyond the five recent successes at dashboard, enqueue and delivery', async () => {
    await make();
    for (let i = 0; i < 6; i++)
      await make({
        issuedAt: new Date(Date.now() - 90000 + i),
        result: 'OUTPUT_PULSE_COMPLETED',
        completedAt: new Date(Date.now() - 80000),
      });
    const [device] = (await service.list()).filter((d) => d.id === deviceId);
    expect(device.commands).toHaveLength(5);
    expect(device.unresolvedCommandCount).toBe(1);
    expect(device.unlock.allowed).toBe(false);
    await unlock().expect(409);
    const live = await make({
      expiresAt: new Date(Date.now() + 10000),
      issuedAt: new Date(),
    });
    expect(await service.next(deviceId)).toBeNull();
    expect(
      (await db.deviceCommand.findUniqueOrThrow({ where: { id: live.id } }))
        .deliveredAt,
    ).toBeNull();
  });
  it.each([null, 'UNKNOWN'])(
    'preserves %s outcome, records evidence and emits one immutable event on duplicate acknowledgement',
    async (value) => {
      const c = await make({
        result: value,
        resultReason: value ? 'INTERRUPTED' : null,
      });
      await app.get(DeviceReliabilityService).sweep();
      const before = await db.deviceCommand.findUniqueOrThrow({
        where: { id: c.id },
      });
      const first = await acknowledge(c.id).expect(200);
      const second = await acknowledge(c.id).expect(200);
      expect(second.body).toEqual(first.body);
      expect(first.body.unlockRequested).toBe(false);
      expect(first.body.acknowledgement).toMatchObject({
        operatorId: 'reviewing-admin',
        reason: body.reason,
        evidence: body.evidence,
        physicalSafetyConfirmed: true,
        originalResult: value,
      });
      expect(
        await db.deviceCommand.findUniqueOrThrow({ where: { id: c.id } }),
      ).toEqual(before);
      expect(await db.deviceCommand.count({ where: { deviceId } })).toBe(1);
      expect(
        await db.deviceEvent.count({
          where: { commandId: c.id, type: 'COMMAND_UNCERTAINTY_ACKNOWLEDGED' },
        }),
      ).toBe(1);
      const history = await app.get(DeviceReliabilityService).history(deviceId);
      expect(history.unresolvedCommands).toHaveLength(0);
      expect(history.acknowledgements).toHaveLength(1);
      expect(
        history.events.some(
          (e) => e.type === 'COMMAND_UNCERTAINTY_ACKNOWLEDGED',
        ),
      ).toBe(true);
      await request(app.getHttpServer())
        .post(route(c.id))
        .set('Cookie', cookie)
        .send({
          ...body,
          evidence: 'Different evidence cannot replace the first audit',
        })
        .expect(409);
    },
  );
  it('requires a new accepted heartbeat and rejects stale, duplicate and retired-boot reports without opening eligibility', async () => {
    await heartbeat('a'.repeat(32), 1000, Date.now()).then((r) =>
      expect(r.body.accepted).toBe(true),
    );
    const c = await make();
    await acknowledge(c.id).expect(200);
    await unlock().expect(409);
    expect(await service.next(deviceId)).toBeNull();
    await heartbeat('b'.repeat(32), 2000, Date.now() - 30000).then((r) =>
      expect(r.status).toBe(400),
    );
    await heartbeat('a'.repeat(32), 1000, Date.now()).then((r) =>
      expect(r.body.accepted).toBe(false),
    );
    await unlock().expect(409);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await heartbeat('b'.repeat(32), 100, Date.now()).then((r) =>
      expect(r.body.accepted).toBe(true),
    );
    await heartbeat('a'.repeat(32), 3000, Date.now() + 1).then((r) =>
      expect(r.body.accepted).toBe(false),
    );
    expect(
      (await service.list()).find((d) => d.id === deviceId)!.unlock.allowed,
    ).toBe(true);
    expect(await service.next(deviceId)).toBeNull();
    expect(await db.deviceCommand.count({ where: { deviceId } })).toBe(1);
  });
  it('does not use a newly received heartbeat sampled before review to satisfy the post-review readiness gate', async () => {
    await heartbeat('a'.repeat(32), 1000).then((r) =>
      expect(r.body.accepted).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const oldSample = Date.now();
    const c = await make();
    await acknowledge(c.id).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await heartbeat('a'.repeat(32), 2000, oldSample).then((r) =>
      expect(r.body.accepted).toBe(true),
    );
    expect(
      (await service.list()).find((d) => d.id === deviceId)!.unlock.allowed,
    ).toBe(false);
    await unlock().expect(409);
    await heartbeat('a'.repeat(32), 3000).then((r) =>
      expect(r.body.accepted).toBe(true),
    );
    expect(
      (await service.list()).find((d) => d.id === deviceId)!.unlock.allowed,
    ).toBe(true);
  });

  it.each([
    'OPEN',
    'OFFLINE',
    'ACTIVE',
    'DISABLED',
    'UNARMED',
    'LOCKER_INACTIVE',
    'SERVER_DISABLED',
    'COOLDOWN',
  ])('retains %s safety gate after acknowledgement', async (gate) => {
    const c = await make();
    await acknowledge(c.id).expect(200);
    await db.lockerDevice.update({
      where: { id: deviceId },
      data: { lastSeen: new Date(Date.now() + 1) },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (gate === 'OPEN')
      await db.lockerDevice.update({
        where: { id: deviceId },
        data: { doorState: 'OPEN' },
      });
    if (gate === 'OFFLINE')
      await db.lockerDevice.update({
        where: { id: deviceId },
        data: { lastSeen: new Date(0) },
      });
    if (gate === 'ACTIVE')
      await db.lockerDevice.update({
        where: { id: deviceId },
        data: { outputState: 'ACTIVE' },
      });
    if (gate === 'DISABLED')
      await db.lockerDevice.update({
        where: { id: deviceId },
        data: { enabled: false },
      });
    if (gate === 'UNARMED')
      await db.lockerDevice.update({
        where: { id: deviceId },
        data: { actuationEnabled: false },
      });
    if (gate === 'LOCKER_INACTIVE')
      await db.locker.update({
        where: { id: lockerId },
        data: { isActive: false },
      });
    if (gate === 'COOLDOWN')
      await make({
        issuedAt: new Date(),
        result: 'OUTPUT_PULSE_COMPLETED',
        completedAt: new Date(),
      });
    if (gate === 'SERVER_DISABLED') process.env.DEVICE_MAX_PULSE_MS = '0';
    try {
      expect(
        (await service.list()).find((d) => d.id === deviceId)!.unlock.allowed,
      ).toBe(false);
      expect((await unlock()).status).toBeGreaterThanOrEqual(400);
    } finally {
      process.env.DEVICE_MAX_PULSE_MS = '200';
    }
  });
  it('keeps an older unresolved blocker when only a newer unknown is acknowledged', async () => {
    await make();
    const c = await make({ result: 'UNKNOWN' });
    await acknowledge(c.id).expect(200);
    expect(
      (await service.list()).find((d) => d.id === deviceId)!
        .unresolvedCommandCount,
    ).toBe(1);
    await unlock().expect(409);
  });
  it('accepts a late device result separately, keeps audit snapshot, deduplicates repeats and rejects conflicting results', async () => {
    const c = await make();
    await acknowledge(c.id).expect(200);
    await result(c.id).expect(200);
    await result(c.id).expect(200);
    await result(c.id, 'FAILED').expect(409);
    const command = await db.deviceCommand.findUniqueOrThrow({
      where: { id: c.id },
      include: { reconciliation: true },
    });
    expect(command.result).toBe('OUTPUT_PULSE_COMPLETED');
    expect(command.reconciliation!.originalResult).toBeNull();
    expect(
      await db.deviceEvent.count({
        where: {
          commandId: c.id,
          type: 'COMMAND_LATE_RESULT_AFTER_RECONCILIATION',
        },
      }),
    ).toBe(1);
    expect(
      await db.deviceEvent.count({
        where: { commandId: c.id, type: 'COMMAND_UNCERTAINTY_ACKNOWLEDGED' },
      }),
    ).toBe(1);
    expect(
      (await acknowledge(c.id)).body.acknowledgement.originalResult,
    ).toBeNull();
  });
  it('requires a separate explicit new request after review and a fresh accepted heartbeat; never redelivers the acknowledged command', async () => {
    const old = await make();
    await acknowledge(old.id).expect(200);
    expect(await service.next(deviceId)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await heartbeat().then((r) => expect(r.body.accepted).toBe(true));
    expect(await service.next(deviceId)).toBeNull();
    const response = await unlock().expect(202);
    expect(response.body.commandId).not.toBe(old.id);
    const delivered = await service.next(deviceId);
    expect(delivered?.commandId).toBe(response.body.commandId);
    expect(
      (await db.deviceCommand.findUniqueOrThrow({ where: { id: old.id } }))
        .deliveredAt,
    ).toBeNull();
    expect(await db.deviceCommand.count({ where: { deviceId } })).toBe(2);
  });

  it('never overwrites a previously reported UNKNOWN after acknowledgement', async () => {
    const c = await make({
      result: 'UNKNOWN',
      resultReason: 'SIMULATED_DEVICE_REPORT',
      completedAt: new Date(),
    });
    await acknowledge(c.id).expect(200);
    await result(c.id, 'UNKNOWN').expect(200);
    await result(c.id).expect(409);
    expect(
      (await db.deviceCommand.findUniqueOrThrow({ where: { id: c.id } }))
        .result,
    ).toBe('UNKNOWN');
  });
  it('requires authenticated admin role and identity; device/customer credentials cannot acknowledge', async () => {
    const c = await make();
    await request(app.getHttpServer()).post(route(c.id)).send(body).expect(401);
    await request(app.getHttpServer())
      .post(route(c.id))
      .set('Authorization', 'Bearer ' + token)
      .send(body)
      .expect(401);
    for (const actor of [
      { sub: 'customer', role: 'customer' },
      { role: 'admin' },
    ]) {
      const jwt = await app
        .get(JwtService)
        .signAsync(actor, { secret: process.env.JWT_SECRET });
      await request(app.getHttpServer())
        .post(route(c.id))
        .set('Cookie', 'locker_reserve_admin=' + jwt)
        .send(body)
        .expect(403);
    }
    expect(
      await db.deviceCommandReconciliation.count({ where: { deviceId } }),
    ).toBe(0);
  });
  it.each([
    { physicalSafetyConfirmed: false },
    { physicalSafetyConfirmed: 'true' },
    { reason: '   ' },
    { evidence: '   ' },
    { operatorId: 'forged' },
    { reason: 'x'.repeat(501) },
    { evidence: 'x'.repeat(2001) },
  ])(
    'rejects invalid evidence/attestation and extra caller identity: %j',
    async (change) => {
      const c = await make();
      await request(app.getHttpServer())
        .post(route(c.id))
        .set('Cookie', cookie)
        .send({ ...body, ...change })
        .expect(400);
      expect(
        await db.deviceCommandReconciliation.count({ where: { deviceId } }),
      ).toBe(0);
    },
  );
  it('rejects wrong device, missing command, a known result, and an unexpired command', async () => {
    const c = await make();
    await request(app.getHttpServer())
      .post(route(c.id, 'wrong-device'))
      .set('Cookie', cookie)
      .send(body)
      .expect(404);
    await acknowledge(randomUUID()).expect(404);
    await db.deviceCommand.update({
      where: { id: c.id },
      data: { result: 'FAILED' },
    });
    await acknowledge(c.id).expect(409);
    await db.deviceCommand.update({
      where: { id: c.id },
      data: { result: null, expiresAt: new Date(Date.now() + 10000) },
    });
    await acknowledge(c.id).expect(409);
  });
  it('refuses review while another command is live, preventing acknowledgement from releasing a pre-existing queue', async () => {
    const c = await make();
    await make({ expiresAt: new Date(Date.now() + 10000) });
    await acknowledge(c.id).expect(409);
    expect(await service.next(deviceId)).toBeNull();
  });
  it('serializes concurrent acknowledgements and enqueue without creating a command or duplicate audit', async () => {
    const c = await make();
    const outcomes = await Promise.all([
      acknowledge(c.id),
      acknowledge(c.id),
      unlock(),
    ]);
    expect(outcomes.map((r) => r.status)).toEqual([200, 200, 409]);
    expect(await db.deviceCommand.count({ where: { deviceId } })).toBe(1);
    expect(
      await db.deviceCommandReconciliation.count({ where: { deviceId } }),
    ).toBe(1);
    expect(
      await db.deviceEvent.count({
        where: { deviceId, type: 'COMMAND_UNCERTAINTY_ACKNOWLEDGED' },
      }),
    ).toBe(1);
  });
  it('serializes result vs review: device result wins or the immutable acknowledgement survives a late report', async () => {
    const c = await make();
    const [review, report] = await Promise.all([
      acknowledge(c.id),
      result(c.id),
    ]);
    expect([200, 409]).toContain(review.status);
    expect(report.status).toBe(200);
    const command = await db.deviceCommand.findUniqueOrThrow({
      where: { id: c.id },
      include: { reconciliation: true },
    });
    expect(command.result).toBe('OUTPUT_PULSE_COMPLETED');
    expect(!!command.reconciliation).toBe(review.status === 200);
  });
});
