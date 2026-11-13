import { DeviceReliabilityService } from './device-reliability.service';
import { isFresh, parseDiagnostics } from './device-health';
const diag = {
  bootId: 'a'.repeat(32),
  uptimeMs: 1000,
  resetReason: 'POWERON',
  wifiDisconnects: 0,
  communicationFailures: 0,
};
describe('reliability transitions', () => {
  let db: any, service: DeviceReliabilityService;
  const device = { id: 'd', lastSeen: null as Date | null };
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-04T12:00:00Z'));
    db = {
      deviceHealth: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      deviceEvent: { upsert: jest.fn(), findUnique: jest.fn() },
      deviceCommand: {
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      lockerDevice: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };
    db.$transaction = (fn: any) => fn(db);
    service = new DeviceReliabilityService(db);
    device.lastSeen = null;
  });
  afterEach(() => {
    jest.useRealTimers();
    delete process.env.DEVICE_HEARTBEAT_FRESH_MS;
  });
  const events = () =>
    db.deviceEvent.upsert.mock.calls.map(([arg]: any[]) => arg.create.type);
  it('supports legacy firmware without logging every heartbeat', async () => {
    expect(await service.heartbeat(db, device)).toBe(true);
    expect(events()).toEqual(['DEVICE_FIRST_CONNECTED']);
    db.deviceEvent.upsert.mockClear();
    device.lastSeen = new Date();
    await service.heartbeat(db, device);
    expect(events()).toEqual([]);
  });
  it('observes first boot without inferring a power fault', async () => {
    await service.heartbeat(db, device, diag);
    expect(events()).toEqual([
      'DEVICE_FIRST_CONNECTED',
      'DEVICE_BOOT_OBSERVED',
    ]);
  });
  it('ignores duplicates, older uptimes and retired boots', async () => {
    db.deviceHealth.findUnique.mockResolvedValue(diag);
    expect(await service.heartbeat(db, device, diag)).toBe(false);
    expect(
      await service.heartbeat(db, device, { ...diag, uptimeMs: 999 }),
    ).toBe(false);
    expect(await service.heartbeat(db, device)).toBe(false);
    db.deviceEvent.findUnique.mockResolvedValue({ id: 'old' });
    expect(
      await service.heartbeat(db, device, { ...diag, bootId: 'b'.repeat(32) }),
    ).toBe(false);
    expect(db.deviceHealth.upsert).not.toHaveBeenCalled();
  });
  it('detects reboot and brownout, invalidates queued commands without inventing outcomes', async () => {
    db.deviceHealth.findUnique.mockResolvedValue(diag);
    db.deviceCommand.findMany.mockResolvedValue([{ id: 'c' }]);
    device.lastSeen = new Date();
    await service.heartbeat(db, device, {
      ...diag,
      bootId: 'b'.repeat(32),
      resetReason: 'BROWNOUT',
    });
    expect(events()).toEqual([
      'DEVICE_RESTART_DETECTED',
      'BROWNOUT_REPORTED',
      'REBOOT_WITH_UNRESOLVED_COMMAND',
    ]);
    expect(db.deviceCommand.updateMany.mock.calls[0][0].data).toEqual({
      expiresAt: new Date(),
    });
  });
  it('records missed heartbeat and reconnection even without a prior sweep', async () => {
    device.lastSeen = new Date(Date.now() - 15000);
    await service.heartbeat(db, device, diag);
    expect(events()).toContain('HEARTBEAT_STALE');
    expect(events()).toContain('DEVICE_RECONNECTED');
  });
  it('records counter increases and allowlists diagnostic metadata', async () => {
    device.lastSeen = new Date();
    db.deviceHealth.findUnique.mockResolvedValue(diag);
    await service.heartbeat(db, device, {
      ...diag,
      uptimeMs: 2000,
      wifiDisconnects: 1,
      communicationFailures: 3,
    });
    expect(events()).toEqual([
      'WIFI_INTERRUPTION_REPORTED',
      'COMMUNICATION_FAILURE_REPORTED',
    ]);
    expect(parseDiagnostics({ ...diag, token: 'secret' })).not.toHaveProperty(
      'token',
    );
    expect(() => parseDiagnostics({ ...diag, uptimeMs: -1 })).toThrow();
    expect(() =>
      parseDiagnostics({ ...diag, resetReason: 'broken wire' }),
    ).toThrow();
  });
  it('bounds freshness and refuses future timestamps', () => {
    expect(isFresh(new Date(Date.now() + 1))).toBe(false);
    expect(isFresh(new Date(Date.now() - 14999))).toBe(true);
    expect(isFresh(new Date(Date.now() - 15000))).toBe(false);
    process.env.DEVICE_HEARTBEAT_FRESH_MS = '60000';
    expect(() => isFresh(new Date())).toThrow();
  });
  it('rechecks stale devices under lock and uses stable deduplication keys', async () => {
    device.lastSeen = new Date(Date.now() - 20000);
    db.lockerDevice.findMany.mockResolvedValue([{ id: 'd' }]);
    db.lockerDevice.findUnique.mockResolvedValue(device);
    await service.sweep();
    await service.sweep();
    const calls = db.deviceEvent.upsert.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].where).toEqual(calls[1][0].where);
    device.lastSeen = new Date();
    await service.sweep();
    expect(db.deviceEvent.upsert).toHaveBeenCalledTimes(2);
  });
  it('records expiry without resolving or replaying the command', async () => {
    db.deviceCommand.findMany.mockResolvedValue([{ id: 'c', deviceId: 'd' }]);
    db.deviceCommand.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() - 1),
      result: null,
    });
    await service.sweep();
    expect(events()).toEqual(['COMMAND_EXPIRED_UNKNOWN']);
    expect(db.deviceCommand.update.mock.calls[0][0].data).toEqual({
      expiryObservedAt: new Date(),
    });
  });
  it('aggregates unknown authentication failures without device attribution', async () => {
    await service.authenticationFailure();
    await service.authenticationFailure();
    const calls = db.deviceEvent.upsert.mock.calls;
    expect(calls[0][0].create.deviceId).toBeUndefined();
    expect(calls[0][0].where).toEqual(calls[1][0].where);
  });
});
