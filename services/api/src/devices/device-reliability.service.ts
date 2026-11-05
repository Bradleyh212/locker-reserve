import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Diagnostics, freshnessMs, isFresh } from './device-health';

type Tx = Prisma.TransactionClient;
@Injectable()
export class DeviceReliabilityService {
  private readonly logger = new Logger(DeviceReliabilityService.name);
  private sweeping = false;
  constructor(private readonly db: PrismaService) {
    freshnessMs();
  }

  async event(
    tx: Tx,
    deviceId: string,
    type: string,
    key: string,
    options: {
      commandId?: string;
      diagnostics?: Diagnostics;
      details?: Prisma.InputJsonObject;
      severity?: string;
    } = {},
  ) {
    await tx.deviceEvent.upsert({
      where: { dedupeKey: `${deviceId}:${key}` },
      update: {},
      create: {
        deviceId,
        type,
        dedupeKey: `${deviceId}:${key}`,
        severity: options.severity ?? 'INFO',
        commandId: options.commandId,
        uptimeMs: options.diagnostics?.uptimeMs,
        resetReason: options.diagnostics?.resetReason,
        details: options.details,
      },
    });
  }

  async authenticationFailure() {
    // Unknown credentials cannot truthfully be attributed to a device. Aggregate globally per minute.
    const key = `auth:${Math.floor(Date.now() / 60000)}`;
    try {
      await this.db.deviceEvent.upsert({
        where: { dedupeKey: key },
        update: { occurrences: { increment: 1 } },
        create: {
          type: 'AUTHENTICATION_FAILURE',
          severity: 'WARNING',
          dedupeKey: key,
        },
      });
    } catch {
      this.logger.warn('Could not record authentication failure');
    }
  }

  // Caller holds the LockerDevice row lock, shared with enqueue and delivery.
  async heartbeat(
    tx: Tx,
    device: { id: string; lastSeen: Date | null },
    d?: Diagnostics,
  ) {
    const previous = await tx.deviceHealth.findUnique({
      where: { deviceId: device.id },
    });
    const now = new Date();
    if (
      d &&
      previous?.bootId === d.bootId &&
      previous.uptimeMs != null &&
      d.uptimeMs <= previous.uptimeMs
    )
      return false; // Duplicate/out-of-order observations must not refresh unlock eligibility.
    if (d && previous?.bootId !== d.bootId) {
      const oldBoot = await tx.deviceEvent.findUnique({
        where: { dedupeKey: `${device.id}:boot:${d.bootId}` },
      });
      if (oldBoot) return false;
    }
    if (
      d &&
      previous?.bootId === d.bootId &&
      (d.communicationFailures < previous.communicationFailures ||
        d.wifiDisconnects < previous.wifiDisconnects)
    )
      return false;
    // Once a device reports diagnostics, require them to avoid rolling health backwards.
    if (previous?.bootId && !d) return false;
    if (device.lastSeen && !isFresh(device.lastSeen, now.getTime())) {
      await this.event(
        tx,
        device.id,
        'HEARTBEAT_STALE',
        `offline:${device.lastSeen.toISOString()}`,
        {
          severity: 'WARNING',
          details: {
            lastHeartbeat: device.lastSeen.toISOString(),
            source: 'SERVER_INFERENCE',
          },
        },
      );
    }
    if (
      !device.lastSeen ||
      previous?.offline ||
      !isFresh(device.lastSeen, now.getTime())
    ) {
      await this.event(
        tx,
        device.id,
        device.lastSeen ? 'DEVICE_RECONNECTED' : 'DEVICE_FIRST_CONNECTED',
        `connected:${device.lastSeen?.toISOString() ?? 'first'}`,
        { diagnostics: d },
      );
    }
    const restarted = !!(d && previous?.bootId && previous.bootId !== d.bootId);
    if (d && previous?.bootId !== d.bootId) {
      await this.event(
        tx,
        device.id,
        restarted ? 'DEVICE_RESTART_DETECTED' : 'DEVICE_BOOT_OBSERVED',
        `boot:${d.bootId}`,
        {
          diagnostics: d,
          details: { bootId: d.bootId, source: 'DEVICE_REPORT' },
        },
      );
      if (d.resetReason === 'BROWNOUT')
        await this.event(
          tx,
          device.id,
          'BROWNOUT_REPORTED',
          `brownout:${d.bootId}`,
          {
            diagnostics: d,
            severity: 'WARNING',
            details: { source: 'DEVICE_REPORT' },
          },
        );
    }
    if (d && previous?.bootId !== d.bootId) {
      // A queued command from a previous boot must never become a fresh activation.
      await tx.deviceCommand.updateMany({
        where: { deviceId: device.id, result: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      });
      const unresolved = await tx.deviceCommand.findMany({
        where: {
          deviceId: device.id,
          OR: [{ result: null }, { result: 'UNKNOWN' }],
        },
      });
      for (const c of unresolved)
        await this.event(
          tx,
          device.id,
          restarted
            ? 'REBOOT_WITH_UNRESOLVED_COMMAND'
            : 'BOOT_WITH_UNRESOLVED_COMMAND',
          `reboot-command:${c.id}:${d!.bootId}`,
          { commandId: c.id, diagnostics: d, severity: 'WARNING' },
        );
    }
    if (d) {
      for (const [field, type] of [
        ['wifiDisconnects', 'WIFI_INTERRUPTION_REPORTED'],
        ['communicationFailures', 'COMMUNICATION_FAILURE_REPORTED'],
      ] as const) {
        const baseline = previous?.bootId === d.bootId ? previous[field] : 0;
        if (d[field] > baseline)
          await this.event(
            tx,
            device.id,
            type,
            `${field}:${d.bootId}:${d[field]}`,
            {
              diagnostics: d,
              severity: 'WARNING',
              details: { count: d[field] - baseline, source: 'DEVICE_REPORT' },
            },
          );
      }
    }
    const data = {
      offline: false,
      ...(d
        ? {
            ...d,
            bootObservedAt:
              previous?.bootId === d.bootId ? previous.bootObservedAt : now,
          }
        : {}),
    };
    await tx.deviceHealth.upsert({
      where: { deviceId: device.id },
      create: { deviceId: device.id, ...data },
      update: data,
    });
    return true;
  }

  // Runs without dashboard traffic. Row locks and dedupe keys work across API processes/restarts.
  @Interval(5000)
  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const stale = await this.db.lockerDevice.findMany({
        where: {
          lastSeen: { not: null },
          OR: [
            { lastSeen: { lte: new Date(Date.now() - freshnessMs()) } },
            { lastSeen: { gt: new Date() } },
          ],
          health: { is: { offline: false } },
        },
        select: { id: true },
        take: 100,
      });
      for (const { id } of stale)
        await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "LockerDevice" WHERE "id" = ${id} FOR UPDATE`;
          const d = await tx.lockerDevice.findUnique({ where: { id } });
          if (!d?.lastSeen || isFresh(d.lastSeen)) return;
          await this.event(
            tx,
            id,
            'HEARTBEAT_STALE',
            `offline:${d.lastSeen.toISOString()}`,
            {
              severity: 'WARNING',
              details: {
                lastHeartbeat: d.lastSeen.toISOString(),
                source: 'SERVER_INFERENCE',
              },
            },
          );
          await tx.deviceHealth.update({
            where: { deviceId: id },
            data: { offline: true },
          });
        });
      const expired = await this.db.deviceCommand.findMany({
        where: {
          result: null,
          expiryObservedAt: null,
          expiresAt: { lte: new Date() },
        },
        select: { id: true, deviceId: true },
        orderBy: { expiresAt: 'desc' },
        take: 100,
      });
      for (const c of expired)
        await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "DeviceCommand" WHERE "id" = ${c.id} FOR UPDATE`;
          const current = await tx.deviceCommand.findUnique({
            where: { id: c.id },
          });
          if (
            !current ||
            current.result ||
            current.expiryObservedAt ||
            current.expiresAt.getTime() > Date.now()
          )
            return;
          await this.event(
            tx,
            c.deviceId,
            'COMMAND_EXPIRED_UNKNOWN',
            `expired:${c.id}`,
            { commandId: c.id, severity: 'WARNING' },
          );
          await tx.deviceCommand.update({
            where: { id: c.id },
            data: { expiryObservedAt: new Date() },
          });
        });
    } catch {
      this.logger.error(
        'Device reliability sweep failed; retrying next interval',
      );
    } finally {
      this.sweeping = false;
    }
  }

  async history(deviceId: string) {
    const device = await this.db.lockerDevice.findUnique({
      where: { id: deviceId },
      select: { lastSeen: true, firmwareVersion: true },
    });
    if (!device) throw new NotFoundException();
    return {
      lastHeartbeat: device.lastSeen,
      online: isFresh(device.lastSeen),
      firmwareVersion: device.firmwareVersion,
      unresolvedCommands: await this.db.deviceCommand.findMany({
        where: { deviceId, OR: [{ result: null }, { result: 'UNKNOWN' }] },
        select: { id: true, issuedAt: true, expiresAt: true, result: true },
        orderBy: { issuedAt: 'desc' },
        take: 50,
      }),
      health: await this.db.deviceHealth.findUnique({ where: { deviceId } }),
      events: await this.db.deviceEvent.findMany({
        where: { deviceId },
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
    };
  }
}
