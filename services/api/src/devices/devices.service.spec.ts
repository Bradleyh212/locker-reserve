import { DevicesService } from './devices.service';
import { createHash } from 'crypto';

describe('device command boundaries', () => {
  let db: any, service: DevicesService;
  beforeEach(() => {
    db = {
      lockerDevice: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      deviceCommand: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      firmwareUpdate: { findFirst: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn(),
    };
    db.$transaction = async (fn: any) => fn(db);
    service = new DevicesService(db);
    process.env.DEVICE_MAX_PULSE_MS = '200';
  });
  afterEach(() => delete process.env.DEVICE_MAX_PULSE_MS);
  function ready() {
    db.lockerDevice.findUnique.mockResolvedValue({
      id: 'd',
      lockerId: 'l',
      enabled: true,
      actuationEnabled: true,
      maxPulseMs: 200,
      lastSeen: new Date(),
      outputState: 'INACTIVE',
      doorState: 'CLOSED',
      locker: { isActive: true },
    });
  }
  it('reports server limits and unresolved commands to the dashboard', async () => {
    ready();
    const device = await db.lockerDevice.findUnique();
    device.commands = [];
    device.maxPulseMs = 500;
    db.lockerDevice.findMany.mockResolvedValue([device]);
    expect((await service.list())[0].unlock).toMatchObject({
      allowed: true,
      maxPulseMs: 200,
    });
    delete process.env.DEVICE_MAX_PULSE_MS;
    expect((await service.list())[0].unlock.allowed).toBe(false);
    process.env.DEVICE_MAX_PULSE_MS = '200';
    device.commands = [
      { issuedAt: new Date(0), expiresAt: new Date(1), result: null },
    ];
    const result = (await service.list())[0];
    expect(result.unlock.allowed).toBe(false);
    expect(result.commands[0].status).toBe('EXPIRED_UNKNOWN');
    device.commands = [
      {
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 10000),
        result: 'OUTPUT_PULSE_COMPLETED',
      },
    ];
    expect((await service.list())[0].unlock.blockedReason).toBe(
      'Waiting for cooldown',
    );
  });
  it.each(['OPEN', 'UNKNOWN'])(
    'blocks %s at enqueue, delivery and dashboard',
    async (doorState) => {
      ready();
      const d = await db.lockerDevice.findUnique();
      d.doorState = doorState;
      d.commands = [];
      db.lockerDevice.findMany.mockResolvedValue([d]);
      expect((await service.list())[0].unlock.allowed).toBe(false);
      await expect(
        service.enqueue('d', { pulseMs: 100, reason: 'test' }, 'admin'),
      ).rejects.toThrow();
      expect(await service.next('d')).toBeNull();
      expect(db.deviceCommand.create).not.toHaveBeenCalled();
    },
  );
  it('does not deliver queued commands after heartbeat becomes stale', async () => {
    ready();
    const d = await db.lockerDevice.findUnique();
    d.lastSeen = new Date(Date.now() - 15001);
    expect(await service.next('d')).toBeNull();
    expect(db.deviceCommand.findFirst).not.toHaveBeenCalled();
  });
  it('accepts 5000 but refuses 5001 and an oversized server configuration', async () => {
    ready();
    const d = await db.lockerDevice.findUnique();
    d.maxPulseMs = 5000;
    process.env.DEVICE_MAX_PULSE_MS = '5000';
    db.deviceCommand.create.mockImplementation(async ({ data }: any) => ({
      id: 'c',
      ...data,
    }));
    await expect(
      service.enqueue('d', { pulseMs: 5000, reason: 'boundary test' }, 'admin'),
    ).resolves.toMatchObject({ status: 'QUEUED' });
    await expect(
      service.enqueue('d', { pulseMs: 5001, reason: 'boundary test' }, 'admin'),
    ).rejects.toThrow();
    await expect(
      service.heartbeat('d', {
        doorState: 'CLOSED',
        outputState: 'INACTIVE',
        firmwareVersion: 'test',
        actuationEnabled: true,
        maxPulseMs: 5001,
      }),
    ).rejects.toThrow();
    process.env.DEVICE_MAX_PULSE_MS = '5001';
    await expect(
      service.enqueue('d', { pulseMs: 5000, reason: 'boundary test' }, 'admin'),
    ).rejects.toThrow();
  });
  it('revalidates stored pulse bounds at delivery, independently of enqueue', async () => {
    ready();
    const d = await db.lockerDevice.findUnique();
    d.maxPulseMs = 5000;
    process.env.DEVICE_MAX_PULSE_MS = '5000';
    const command = { id: 'c', lockerId: 'l', pulseMs: 5000 };
    db.deviceCommand.findFirst.mockResolvedValue(command);
    expect(await service.next('d')).toMatchObject({ pulseMs: 5000 });
    for (const pulseMs of [5001, 0, -1, 1.5]) {
      command.pulseMs = pulseMs;
      expect(await service.next('d')).toBeNull();
    }
    command.pulseMs = 5000;
    d.maxPulseMs = 200;
    expect(await service.next('d')).toBeNull();
    d.maxPulseMs = 5000;
    process.env.DEVICE_MAX_PULSE_MS = '200';
    expect(await service.next('d')).toBeNull();
  });
  it('rejects missing and revoked device credentials', async () => {
    await expect(service.authenticate()).rejects.toThrow();
    db.lockerDevice.findUnique.mockResolvedValue({ enabled: false });
    await expect(service.authenticate('Bearer secret')).rejects.toThrow();
    expect(db.lockerDevice.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: createHash('sha256').update('secret').digest('hex') },
    });
  });
  it('rejects invalid heartbeat instead of inventing door state', async () => {
    await expect(
      service.heartbeat('d', { doorState: 'LOCKED' }),
    ).rejects.toThrow();
    expect(db.lockerDevice.update).not.toHaveBeenCalled();
  });
  it('requires explicit operator pulse configuration', async () => {
    delete process.env.DEVICE_MAX_PULSE_MS;
    await expect(
      service.enqueue('d', { pulseMs: 100, reason: 'bench' }, 'admin'),
    ).rejects.toThrow();
  });
  it('rejects excessive pulse and offline device', async () => {
    await expect(
      service.enqueue('d', { pulseMs: 201, reason: 'bench' }, 'admin'),
    ).rejects.toThrow();
    ready();
    const d = await db.lockerDevice.findUnique();
    d.lastSeen = new Date(0);
    await expect(
      service.enqueue('d', { pulseMs: 100, reason: 'bench' }, 'admin'),
    ).rejects.toThrow();
  });
  it('blocks unresolved commands even after their expiry', async () => {
    ready();
    db.deviceCommand.findFirst.mockResolvedValue({
      issuedAt: new Date(0),
      result: null,
    });
    await expect(
      service.enqueue('d', { pulseMs: 100, reason: 'bench' }, 'admin'),
    ).rejects.toThrow();
    expect(db.deviceCommand.create).not.toHaveBeenCalled();
  });
  it('refuses unlock while a firmware update is in flight', async () => {
    ready();
    db.firmwareUpdate.findFirst.mockResolvedValue({ id: 'firmware-update' });
    await expect(
      service.enqueue('d', { pulseMs: 100, reason: 'bench test' }, 'admin'),
    ).rejects.toThrow('A firmware update is in flight');
    expect(db.deviceCommand.create).not.toHaveBeenCalled();
  });
  it('records actor, reason and bounded expiry under a device row lock', async () => {
    ready();
    db.deviceCommand.create.mockImplementation(async ({ data }: any) => ({
      id: 'c',
      ...data,
    }));
    const b = await service.enqueue(
      'd',
      { pulseMs: 100, reason: 'bench test' },
      'admin@example.com',
    );
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.deviceCommand.create.mock.calls[0][0].data).toMatchObject({
      requestedBy: 'admin@example.com',
      reason: 'bench test',
      pulseMs: 100,
      deviceId: 'd',
    });
    expect(b.status).toBe('QUEUED');
    expect(b.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10000);
  });
  it('does not deliver after deactivation', async () => {
    ready();
    const d = await db.lockerDevice.findUnique();
    d.locker.isActive = false;
    expect(await service.next('d')).toBeNull();
    expect(db.deviceCommand.findFirst).not.toHaveBeenCalled();
  });
  it('accepts identical duplicate results but rejects conflicts and other devices', async () => {
    db.deviceCommand.findUnique.mockResolvedValue({
      deviceId: 'd',
      result: 'OUTPUT_PULSE_COMPLETED',
      resultReason: 'DONE',
    });
    await expect(
      service.result('d', 'c', {
        result: 'OUTPUT_PULSE_COMPLETED',
        reason: 'DONE',
      }),
    ).resolves.toEqual({ accepted: true });
    await expect(
      service.result('d', 'c', { result: 'FAILED', reason: 'DONE' }),
    ).rejects.toThrow();
    await expect(
      service.result('other', 'c', {
        result: 'OUTPUT_PULSE_COMPLETED',
        reason: 'DONE',
      }),
    ).rejects.toThrow();
  });
});
