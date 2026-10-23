import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { FirmwareService } from './firmware.service';

describe('firmware OTA service', () => {
  let db: any;
  let service: FirmwareService;
  let releaseDirectory: string;
  const image = Buffer.from([0xe9, 1, 2, 3, 4, 5]);
  const release = {
    id: 'release-1',
    deviceId: 'd',
    version: 'locker-firmware-0.3',
    buildNumber: 3,
    sha256: createHash('sha256').update(image).digest('hex'),
    sizeBytes: image.length,
    fileName: 'release.bin',
    notes: null,
    createdAt: new Date(),
  };

  beforeEach(() => {
    releaseDirectory = mkdtempSync(join(tmpdir(), 'locker-firmware-'));
    mkdirSync(releaseDirectory, { recursive: true });
    writeFileSync(join(releaseDirectory, 'release.bin'), image);
    process.env.OTA_ENABLED = 'true';
    process.env.FIRMWARE_RELEASE_DIR = releaseDirectory;
    delete process.env.OTA_DELIVERED_GRACE_MS;
    delete process.env.OTA_UPDATE_TTL_MS;
    delete process.env.OTA_MAX_IMAGE_BYTES;
    db = {
      lockerDevice: { findUnique: jest.fn() },
      firmwareRelease: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      firmwareUpdate: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      deviceCommand: { findFirst: jest.fn() },
      $queryRaw: jest.fn(),
    };
    db.$transaction = async (fn: any) => fn(db);
    service = new FirmwareService(db);
  });

  afterEach(() => {
    delete process.env.OTA_ENABLED;
    delete process.env.FIRMWARE_RELEASE_DIR;
    rmSync(releaseDirectory, { recursive: true, force: true });
  });

  it('refuses OTA operations while disabled', async () => {
    process.env.OTA_ENABLED = 'false';
    await expect(service.next('d')).rejects.toThrow('Firmware OTA is disabled');
    await expect(service.download('d', 'update-1')).rejects.toThrow(
      'Firmware OTA is disabled',
    );
    await expect(
      service.result('d', 'update-1', { result: 'FAILED' }),
    ).rejects.toThrow('Firmware OTA is disabled');
    await expect(service.listReleases('d')).rejects.toThrow(
      'Firmware OTA is disabled',
    );
    await expect(service.listUpdates('d')).rejects.toThrow(
      'Firmware OTA is disabled',
    );
    await expect(
      service.requestUpdate(
        'd',
        { releaseId: 'r', reason: 'routine update' },
        'admin',
      ),
    ).rejects.toThrow('Firmware OTA is disabled');
  });

  it('delivers a compact manifest and marks first delivery', async () => {
    const update = {
      id: 'update-1',
      deviceId: 'd',
      releaseId: release.id,
      release,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 600000),
      deliveredAt: null,
      result: null,
    };
    db.firmwareUpdate.findMany.mockResolvedValue([update]);
    db.firmwareUpdate.updateMany.mockResolvedValue({ count: 1 });
    const manifest = await service.next('d');
    expect(JSON.stringify(manifest).length).toBeLessThan(2048);
    expect(manifest).toMatchObject({
      protocolVersion: 1,
      updateId: update.id,
      releaseId: release.id,
      version: release.version,
      buildNumber: release.buildNumber,
      sizeBytes: image.length,
      sha256: release.sha256,
    });
    expect(db.firmwareUpdate.updateMany).toHaveBeenCalledWith({
      where: { id: update.id, deliveredAt: null, result: null },
      data: { deliveredAt: expect.any(Date) },
    });
    update.deliveredAt = new Date();
    expect(await service.next('d')).toEqual(manifest);
    expect(db.firmwareUpdate.updateMany).toHaveBeenCalledTimes(1);
  });

  it('requires matching device ownership, unfinished state and delivery grace to download', async () => {
    db.firmwareUpdate.findUnique.mockResolvedValue({
      id: 'update-1',
      deviceId: 'someone-else',
      release,
      result: null,
      expiresAt: new Date(Date.now() + 60000),
      deliveredAt: null,
    });
    await expect(service.download('d', 'update-1')).rejects.toThrow();

    db.firmwareUpdate.findUnique.mockResolvedValue({
      id: 'update-1',
      deviceId: 'd',
      release,
      result: 'UPDATED',
      expiresAt: new Date(Date.now() + 60000),
      deliveredAt: new Date(),
    });
    await expect(service.download('d', 'update-1')).rejects.toThrow();

    db.firmwareUpdate.findUnique.mockResolvedValue({
      id: 'update-1',
      deviceId: 'd',
      release,
      result: null,
      expiresAt: new Date(0),
      deliveredAt: new Date(Date.now() - 300001),
    });
    await expect(service.download('d', 'update-1')).rejects.toThrow();
  });

  it('checks exact on-disk size and returns stored hash and size in the manifest', async () => {
    const update = {
      id: 'update-1',
      deviceId: 'd',
      releaseId: release.id,
      release,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 600000),
      deliveredAt: null,
      result: null,
    };
    db.firmwareUpdate.findMany.mockResolvedValue([update]);
    db.firmwareUpdate.updateMany.mockResolvedValue({ count: 1 });
    expect(await service.next('d')).toMatchObject({
      sha256: release.sha256,
      sizeBytes: image.length,
    });
    writeFileSync(join(releaseDirectory, 'release.bin'), Buffer.from([1, 2]));
    db.firmwareUpdate.findUnique.mockResolvedValue({
      id: 'update-1',
      deviceId: 'd',
      result: null,
      deliveredAt: null,
      expiresAt: new Date(Date.now() + 60000),
      release,
    });
    await expect(service.download('d', update.id)).rejects.toThrow(
      'Firmware release size does not match',
    );
  });

  it('stores the first report, accepts an identical retry, and rejects a conflict', async () => {
    db.firmwareUpdate.findUnique
      .mockResolvedValueOnce({
        id: 'update-1',
        deviceId: 'd',
        result: null,
      })
      .mockResolvedValueOnce({
        id: 'update-1',
        deviceId: 'd',
        result: 'UPDATED',
        resultReason: null,
        reportedFirmwareVersion: 'locker-firmware-0.3',
      })
      .mockResolvedValueOnce({
        id: 'update-1',
        deviceId: 'd',
        result: 'UPDATED',
        resultReason: null,
        reportedFirmwareVersion: 'locker-firmware-0.3',
      });
    db.firmwareUpdate.update.mockResolvedValue({});
    const report = {
      result: 'UPDATED',
      firmwareVersion: 'locker-firmware-0.3',
    };
    await expect(service.result('d', 'update-1', report)).resolves.toEqual({
      accepted: true,
    });
    expect(db.firmwareUpdate.update).toHaveBeenCalledWith({
      where: { id: 'update-1' },
      data: {
        result: 'UPDATED',
        resultReason: null,
        reportedFirmwareVersion: 'locker-firmware-0.3',
        completedAt: expect.any(Date),
      },
    });
    await expect(service.result('d', 'update-1', report)).resolves.toEqual({
      accepted: true,
    });
    await expect(
      service.result('d', 'update-1', { ...report, result: 'FAILED' }),
    ).rejects.toThrow('Conflicting firmware result');
  });

  it('refuses an in-flight command and permits a new update after stale OTA state', async () => {
    db.$transaction = async (fn: any) => fn(db);
    db.lockerDevice.findUnique.mockResolvedValue({
      id: 'd',
      enabled: true,
      lastSeen: new Date(),
      firmwareVersion: 'usb-build',
    });
    db.firmwareRelease.findUnique.mockResolvedValue(release);
    db.firmwareRelease.findFirst.mockResolvedValue(null);
    db.deviceCommand.findFirst.mockResolvedValue({ id: 'command' });
    await expect(
      service.requestUpdate(
        'd',
        { releaseId: release.id, reason: 'routine update' },
        'admin',
      ),
    ).rejects.toThrow('unlock command is still in flight');

    db.deviceCommand.findFirst.mockResolvedValue(null);
    db.firmwareUpdate.findFirst.mockResolvedValue(null);
    db.firmwareUpdate.create.mockResolvedValue({ id: 'new-update' });
    await expect(
      service.requestUpdate(
        'd',
        { releaseId: release.id, reason: 'routine update' },
        'admin',
      ),
    ).resolves.toEqual({ id: 'new-update' });
    expect(db.firmwareUpdate.findFirst.mock.calls[0][0].where.OR).toEqual([
      { deliveredAt: null, expiresAt: { gt: expect.any(Date) } },
      { deliveredAt: { not: null, gt: expect.any(Date) } },
    ]);
    expect(db.firmwareUpdate.create).toHaveBeenCalled();
  });

  it('requires a higher build than a known current version', async () => {
    db.lockerDevice.findUnique.mockResolvedValue({
      id: 'd',
      enabled: true,
      lastSeen: new Date(),
      firmwareVersion: 'locker-firmware-0.2',
    });
    db.firmwareRelease.findUnique.mockResolvedValue(release);
    db.firmwareRelease.findFirst.mockResolvedValue({
      id: 'old-release',
      buildNumber: 3,
    });
    await expect(
      service.requestUpdate(
        'd',
        { releaseId: release.id, reason: 'routine update' },
        'admin',
      ),
    ).rejects.toThrow('Firmware build must increase');
    expect(db.firmwareUpdate.create).not.toHaveBeenCalled();
  });
});
