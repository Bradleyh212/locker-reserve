import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { lstat } from 'fs/promises';
import { basename, dirname, resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { ONLINE_MS } from './devices.service';

const results = ['UPDATED', 'REJECTED', 'FAILED', 'UNKNOWN'];
const DEFAULT_MAX_IMAGE_BYTES = 1310720;
const DEFAULT_UPDATE_TTL_MS = 600000;
const DEFAULT_DELIVERED_GRACE_MS = 300000;
const COMMAND_UNRESOLVED_GRACE_MS = 15000;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

@Injectable()
export class FirmwareService {
  constructor(private readonly db: PrismaService) {}

  isEnabled() {
    return process.env.OTA_ENABLED === 'true';
  }

  private requireEnabled() {
    if (!this.isEnabled())
      throw new ForbiddenException('Firmware OTA is disabled');
    this.releaseDirectory();
  }

  private configuredNumber(name: string, fallback: number) {
    const value = process.env[name];
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0)
      throw new InternalServerErrorException(`${name} is invalid`);
    return parsed;
  }

  private releaseDirectory() {
    const configured = process.env.FIRMWARE_RELEASE_DIR;
    if (!configured)
      throw new InternalServerErrorException(
        'Firmware release directory is not configured',
      );
    return resolve(configured);
  }

  private safeReleasePath(fileName: string) {
    if (
      !fileName ||
      fileName === '.' ||
      fileName === '..' ||
      fileName.includes('/') ||
      fileName.includes('\\') ||
      basename(fileName) !== fileName
    )
      throw new NotFoundException('Firmware release file is unavailable');
    const directory = this.releaseDirectory();
    const filePath = resolve(directory, fileName);
    if (dirname(filePath) !== directory)
      throw new NotFoundException('Firmware release file is unavailable');
    return filePath;
  }

  private async releaseFile(release: { fileName: string; sizeBytes: number }) {
    const filePath = this.safeReleasePath(release.fileName);
    try {
      const details = await lstat(filePath);
      if (!details.isFile())
        throw new NotFoundException('Firmware release file is unavailable');
      if (details.size !== release.sizeBytes)
        throw new ConflictException('Firmware release size does not match');
      return { filePath, sizeBytes: details.size };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      )
        throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new NotFoundException('Firmware release file is unavailable');
      throw error;
    }
  }

  async listReleases(deviceId: string) {
    this.requireEnabled();
    if (!deviceId) throw new BadRequestException('deviceId is required');
    return this.db.firmwareRelease.findMany({
      where: { deviceId },
      orderBy: [{ createdAt: 'desc' }, { buildNumber: 'desc' }],
      select: {
        id: true,
        deviceId: true,
        version: true,
        buildNumber: true,
        sha256: true,
        sizeBytes: true,
        notes: true,
        createdAt: true,
      },
    });
  }

  async next(deviceId: string) {
    this.requireEnabled();
    const now = new Date();
    const graceStart = new Date(
      now.getTime() -
        this.configuredNumber(
          'OTA_DELIVERED_GRACE_MS',
          DEFAULT_DELIVERED_GRACE_MS,
        ),
    );
    const updates = await this.db.firmwareUpdate.findMany({
      where: {
        deviceId,
        result: null,
        OR: [
          { deliveredAt: null, expiresAt: { gt: now } },
          { deliveredAt: { not: null, gt: graceStart } },
        ],
      },
      include: { release: true },
      orderBy: { issuedAt: 'desc' },
    });

    for (const update of updates) {
      try {
        await this.releaseFile(update.release);
      } catch {
        continue;
      }
      if (!update.deliveredAt) {
        await this.db.firmwareUpdate.updateMany({
          where: { id: update.id, deliveredAt: null, result: null },
          data: { deliveredAt: now },
        });
      }
      return {
        protocolVersion: 1,
        updateId: update.id,
        releaseId: update.releaseId,
        version: update.release.version,
        buildNumber: update.release.buildNumber,
        sizeBytes: update.release.sizeBytes,
        sha256: update.release.sha256,
        issuedAt: update.issuedAt,
        expiresAt: update.expiresAt,
      };
    }
    return null;
  }

  async download(deviceId: string, updateId: string) {
    this.requireEnabled();
    const update = await this.db.firmwareUpdate.findUnique({
      where: { id: updateId },
      include: { release: true },
    });
    if (!update || update.deviceId !== deviceId || update.result)
      throw new NotFoundException();
    const now = Date.now();
    const graceMs = this.configuredNumber(
      'OTA_DELIVERED_GRACE_MS',
      DEFAULT_DELIVERED_GRACE_MS,
    );
    const allowed = update.deliveredAt
      ? update.deliveredAt.getTime() + graceMs > now
      : update.expiresAt.getTime() > now;
    if (!allowed) throw new NotFoundException();
    const file = await this.releaseFile(update.release);
    return {
      ...file,
      stream: createReadStream(file.filePath),
    };
  }

  async result(deviceId: string, updateId: string, body: unknown) {
    this.requireEnabled();
    const input = isRecord(body) ? body : null;
    const result = input?.result;
    const reasonValue = input?.reason;
    const firmwareVersionValue = input?.firmwareVersion;
    if (
      !input ||
      typeof result !== 'string' ||
      !results.includes(result) ||
      (reasonValue !== undefined &&
        (typeof reasonValue !== 'string' ||
          !/^[A-Z0-9_]{1,64}$/.test(reasonValue))) ||
      (firmwareVersionValue !== undefined &&
        (typeof firmwareVersionValue !== 'string' ||
          firmwareVersionValue.length > 80))
    )
      throw new BadRequestException('Invalid firmware update result');
    const reason = typeof reasonValue === 'string' ? reasonValue : null;
    const firmwareVersion =
      typeof firmwareVersionValue === 'string' ? firmwareVersionValue : null;

    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "FirmwareUpdate" WHERE "id" = ${updateId} FOR UPDATE`;
      const update = await tx.firmwareUpdate.findUnique({
        where: { id: updateId },
      });
      if (!update || update.deviceId !== deviceId)
        throw new NotFoundException();
      if (update.result) {
        if (
          update.result !== result ||
          update.resultReason !== reason ||
          update.reportedFirmwareVersion !== firmwareVersion
        )
          throw new ConflictException('Conflicting firmware result');
        return { accepted: true };
      }
      await tx.firmwareUpdate.update({
        where: { id: updateId },
        data: {
          result,
          resultReason: reason,
          reportedFirmwareVersion: firmwareVersion,
          completedAt: new Date(),
        },
      });
      return { accepted: true };
    });
  }

  async requestUpdate(deviceId: string, body: unknown, actor: string) {
    this.requireEnabled();
    const input = isRecord(body) ? body : null;
    const releaseId = input?.releaseId;
    const reasonValue = input?.reason;
    if (
      !input ||
      typeof releaseId !== 'string' ||
      !releaseId ||
      typeof reasonValue !== 'string' ||
      reasonValue.trim().length < 3 ||
      reasonValue.length > 200
    )
      throw new BadRequestException('Provide a releaseId and audit reason');
    const reason = reasonValue.trim();

    const ttlMs = this.configuredNumber(
      'OTA_UPDATE_TTL_MS',
      DEFAULT_UPDATE_TTL_MS,
    );
    const maxBytes = this.configuredNumber(
      'OTA_MAX_IMAGE_BYTES',
      DEFAULT_MAX_IMAGE_BYTES,
    );
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "LockerDevice" WHERE "id" = ${deviceId} FOR UPDATE`;
      const device = await tx.lockerDevice.findUnique({
        where: { id: deviceId },
      });
      if (!device) throw new NotFoundException();
      const now = Date.now();
      if (
        !device.enabled ||
        !device.lastSeen ||
        now - device.lastSeen.getTime() >= ONLINE_MS
      )
        throw new ConflictException('Device is disabled or offline');

      const release = await tx.firmwareRelease.findUnique({
        where: { id: releaseId },
      });
      if (!release || release.deviceId !== deviceId)
        throw new NotFoundException('Firmware release not found for device');
      if (
        !Number.isInteger(release.sizeBytes) ||
        release.sizeBytes <= 0 ||
        release.sizeBytes > maxBytes
      )
        throw new ConflictException('Firmware release exceeds configured size');
      await this.releaseFile(release);

      const currentRelease = await tx.firmwareRelease.findFirst({
        where: { deviceId, version: device.firmwareVersion },
      });
      if (currentRelease && release.buildNumber <= currentRelease.buildNumber)
        throw new ConflictException('Firmware build must increase');

      const commandCutoff = new Date(now - COMMAND_UNRESOLVED_GRACE_MS);
      const command = await tx.deviceCommand.findFirst({
        where: {
          deviceId,
          result: null,
          expiresAt: { gt: commandCutoff },
        },
      });
      if (command)
        throw new ConflictException('An unlock command is still in flight');

      const deliveredGrace = new Date(
        now -
          this.configuredNumber(
            'OTA_DELIVERED_GRACE_MS',
            DEFAULT_DELIVERED_GRACE_MS,
          ),
      );
      const inFlight = await tx.firmwareUpdate.findFirst({
        where: {
          deviceId,
          result: null,
          OR: [
            { deliveredAt: null, expiresAt: { gt: new Date(now) } },
            { deliveredAt: { not: null, gt: deliveredGrace } },
          ],
        },
      });
      if (inFlight)
        throw new ConflictException('A firmware update is already in flight');

      return tx.firmwareUpdate.create({
        data: {
          deviceId,
          releaseId: release.id,
          requestedBy: actor,
          reason,
          expiresAt: new Date(now + ttlMs),
        },
        select: {
          id: true,
          deviceId: true,
          releaseId: true,
          issuedAt: true,
          expiresAt: true,
        },
      });
    });
  }

  async listUpdates(deviceId: string, requestedLimit?: string) {
    this.requireEnabled();
    const parsedLimit =
      requestedLimit === undefined ? 5 : Number(requestedLimit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 20)
      throw new BadRequestException('limit must be between 1 and 20');
    return this.db.firmwareUpdate.findMany({
      where: { deviceId },
      orderBy: { issuedAt: 'desc' },
      take: parsedLimit,
      include: {
        release: { select: { version: true, buildNumber: true } },
      },
    });
  }
}
