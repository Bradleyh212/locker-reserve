import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export const HARD_MAX_PULSE_MS = 5000;
export const ONLINE_MS = 15000;
export const COMMAND_TTL_MS = 10000;
export const COOLDOWN_MS = 30000;
const outcomes = ['OUTPUT_PULSE_COMPLETED', 'REJECTED', 'FAILED', 'UNKNOWN'];

@Injectable()
export class DevicesService {
  constructor(private readonly db: PrismaService) {}

  async authenticate(header?: string) {
    if (!header?.startsWith('Bearer ') || header.length > 512)
      throw new UnauthorizedException();
    const tokenHash = createHash('sha256')
      .update(header.slice(7))
      .digest('hex');
    const device = await this.db.lockerDevice.findUnique({
      where: { tokenHash },
    });
    if (!device?.enabled) throw new UnauthorizedException();
    return device;
  }

  async list() {
    const devices = await this.db.lockerDevice.findMany({
      select: {
        id: true,
        lockerId: true,
        enabled: true,
        lastSeen: true,
        doorState: true,
        outputState: true,
        firmwareVersion: true,
        actuationEnabled: true,
        maxPulseMs: true,
        locker: { select: { code: true, isActive: true } },
        commands: { orderBy: { issuedAt: 'desc' }, take: 5 },
      },
    });
    const now = Date.now();
    const serverLimit = Number(process.env.DEVICE_MAX_PULSE_MS ?? 0);
    const configured =
      Number.isInteger(serverLimit) &&
      serverLimit > 0 &&
      serverLimit <= HARD_MAX_PULSE_MS;
    return devices.map((d) => {
      const online = !!d.lastSeen && now - d.lastSeen.getTime() < ONLINE_MS;
      const latest = d.commands[0];
      const cooldownUntil = latest
        ? latest.issuedAt.getTime() + COOLDOWN_MS
        : 0;
      const blockedReason = !d.enabled
        ? 'Device disabled'
        : !d.locker.isActive
          ? 'Locker inactive'
          : !online
            ? 'Device offline; waiting for heartbeat'
            : d.doorState !== 'CLOSED'
              ? 'Door must have a recent CLOSED observation'
              : !configured
                ? 'Physical activation disabled on server'
                : !d.actuationEnabled || d.maxPulseMs <= 0
                  ? 'Physical activation disabled on device'
                  : d.outputState !== 'INACTIVE'
                    ? 'Output is not inactive'
                    : latest && (!latest.result || latest.result === 'UNKNOWN')
                      ? 'Previous command pending or unresolved; inspect before retrying'
                      : cooldownUntil > now
                        ? 'Waiting for cooldown'
                        : null;
      return {
        ...d,
        online,
        unlock: {
          allowed: blockedReason === null,
          blockedReason,
          maxPulseMs: configured ? Math.min(serverLimit, d.maxPulseMs) : 0,
          cooldownUntil: cooldownUntil > now ? new Date(cooldownUntil) : null,
        },
        commands: d.commands.map((c) => ({
          ...c,
          status:
            c.result ??
            (c.expiresAt.getTime() <= now ? 'EXPIRED_UNKNOWN' : 'PENDING'),
        })),
      };
    });
  }

  async heartbeat(id: string, b: any) {
    if (
      !b ||
      !['OPEN', 'CLOSED', 'UNKNOWN'].includes(b.doorState) ||
      !['ACTIVE', 'INACTIVE'].includes(b.outputState) ||
      typeof b.firmwareVersion !== 'string' ||
      b.firmwareVersion.length > 80 ||
      typeof b.actuationEnabled !== 'boolean' ||
      !Number.isInteger(b.maxPulseMs) ||
      b.maxPulseMs < 0 ||
      b.maxPulseMs > HARD_MAX_PULSE_MS
    ) {
      throw new BadRequestException('Invalid heartbeat');
    }
    await this.db.lockerDevice.update({
      where: { id },
      data: {
        lastSeen: new Date(),
        doorState: b.doorState,
        outputState: b.outputState,
        firmwareVersion: b.firmwareVersion,
        actuationEnabled: b.actuationEnabled,
        maxPulseMs: b.maxPulseMs,
      },
    });
    return { accepted: true };
  }

  async enqueue(id: string, b: any, actor: string) {
    // Disabled by default. Operator must validate hardware and configure the same ceiling on ESP32.
    const limit = Number(process.env.DEVICE_MAX_PULSE_MS ?? 0);
    if (!Number.isInteger(limit) || limit <= 0 || limit > HARD_MAX_PULSE_MS)
      throw new ForbiddenException('Physical activation is not configured');
    if (
      !b ||
      !Number.isInteger(b.pulseMs) ||
      b.pulseMs <= 0 ||
      b.pulseMs > limit ||
      typeof b.reason !== 'string' ||
      b.reason.trim().length < 3 ||
      b.reason.length > 200
    ) {
      throw new BadRequestException(
        'Provide a bounded pulseMs and audit reason',
      );
    }
    return this.db.$transaction(async (tx) => {
      // Serialize competing requests for this physical device, including across API processes.
      await tx.$queryRaw`SELECT "id" FROM "LockerDevice" WHERE "id" = ${id} FOR UPDATE`;
      const d = await tx.lockerDevice.findUnique({
        where: { id },
        include: { locker: true },
      });
      if (!d) throw new NotFoundException();
      if (
        !d.enabled ||
        !d.locker.isActive ||
        !d.actuationEnabled ||
        b.pulseMs > d.maxPulseMs
      )
        throw new ForbiddenException(
          'Device is not armed or locker is inactive',
        );
      if (
        !d.lastSeen ||
        Date.now() - d.lastSeen.getTime() >= ONLINE_MS ||
        d.outputState !== 'INACTIVE' ||
        d.doorState !== 'CLOSED'
      )
        throw new ConflictException(
          'Device is offline, active, or door is not CLOSED',
        );
      const recent = await tx.deviceCommand.findFirst({
        where: { deviceId: id },
        orderBy: { issuedAt: 'desc' },
      });
      if (
        recent &&
        (Date.now() - recent.issuedAt.getTime() < COOLDOWN_MS ||
          !recent.result ||
          recent.result === 'UNKNOWN')
      ) {
        throw new ConflictException(
          'Cooldown or unresolved command; inspect the device before another request',
        );
      }
      const command = await tx.deviceCommand.create({
        data: {
          deviceId: id,
          lockerId: d.lockerId,
          requestedBy: actor,
          reason: b.reason.trim(),
          pulseMs: b.pulseMs,
          expiresAt: new Date(Date.now() + COMMAND_TTL_MS),
        },
      });
      return {
        commandId: command.id,
        status: 'QUEUED',
        expiresAt: command.expiresAt,
      };
    });
  }

  async next(id: string) {
    const d = await this.db.lockerDevice.findUnique({
      where: { id },
      include: { locker: true },
    });
    if (
      !d?.enabled ||
      !d.locker.isActive ||
      !d.actuationEnabled ||
      !d.lastSeen ||
      Date.now() - d.lastSeen.getTime() >= ONLINE_MS ||
      d.doorState !== 'CLOSED' ||
      d.outputState !== 'INACTIVE'
    )
      return null;
    const c = await this.db.deviceCommand.findFirst({
      where: {
        deviceId: id,
        result: null,
        expiresAt: { gt: new Date() },
        lockerId: d.lockerId,
      },
      orderBy: { issuedAt: 'asc' },
    });
    if (!c) return null;
    const limit = Number(process.env.DEVICE_MAX_PULSE_MS ?? 0);
    if (
      !Number.isInteger(limit) ||
      limit <= 0 ||
      limit > HARD_MAX_PULSE_MS ||
      !Number.isInteger(c.pulseMs) ||
      c.pulseMs <= 0 ||
      c.pulseMs > limit ||
      c.pulseMs > d.maxPulseMs
    )
      return null;
    return {
      protocolVersion: 1,
      commandId: c.id,
      deviceId: id,
      lockerId: c.lockerId,
      type: 'UNLOCK_PULSE',
      issuedAt: c.issuedAt,
      expiresAt: c.expiresAt,
      pulseMs: c.pulseMs,
    };
  }

  async result(id: string, commandId: string, b: any) {
    if (
      !b ||
      !outcomes.includes(b.result) ||
      typeof b.reason !== 'string' ||
      b.reason.length > 100
    )
      throw new BadRequestException('Invalid result');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "DeviceCommand" WHERE "id" = ${commandId} FOR UPDATE`;
      const c = await tx.deviceCommand.findUnique({ where: { id: commandId } });
      if (!c || c.deviceId !== id) throw new NotFoundException();
      if (c.result) {
        if (c.result !== b.result || c.resultReason !== b.reason)
          throw new ConflictException('Conflicting result');
        return { accepted: true };
      }
      await tx.deviceCommand.update({
        where: { id: commandId },
        data: {
          result: b.result,
          resultReason: b.reason,
          completedAt: new Date(),
        },
      });
      return { accepted: true };
    });
  }
}
