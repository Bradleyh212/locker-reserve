import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  reconciliationInput,
  unresolvedCommand,
} from './command-reconciliation';
import { DeviceReliabilityService } from './device-reliability.service';
import { freshnessMs, isFresh, parseDiagnostics } from './device-health';
import { PrismaService } from '../prisma/prisma.service';

export const HARD_MAX_PULSE_MS = 5000;
export const ONLINE_MS = 15000;
export const COMMAND_TTL_MS = 10000;
export const COOLDOWN_MS = 30000;
const outcomes = ['OUTPUT_PULSE_COMPLETED', 'REJECTED', 'FAILED', 'UNKNOWN'];

// Count bench rest time from the server's receipt of the device result.
function cooldownEnd(command: { issuedAt: Date; completedAt?: Date | null }) {
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.DEVICE_BENCH_SHORT_COOLDOWN === '1' &&
    command.completedAt
  ) {
    return command.completedAt.getTime() + 5000;
  }
  return command.issuedAt.getTime() + COOLDOWN_MS;
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly db: PrismaService,
    private readonly reliability: DeviceReliabilityService,
  ) {}

  async authenticate(header?: string) {
    if (!header?.startsWith('Bearer ') || header.length > 512) {
      await this.reliability.authenticationFailure();
      throw new UnauthorizedException();
    }
    const tokenHash = createHash('sha256')
      .update(header.slice(7))
      .digest('hex');
    const device = await this.db.lockerDevice.findUnique({
      where: { tokenHash },
    });
    if (!device?.enabled) {
      await this.reliability.authenticationFailure();
      throw new UnauthorizedException();
    }
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
        commands: {
          orderBy: { issuedAt: 'desc' },
          take: 5,
          include: { reconciliation: true },
        },
        _count: { select: { commands: { where: unresolvedCommand } } },
        commandReconciliations: {
          orderBy: { acknowledgedAt: 'desc' },
          take: 1,
        },
      },
    });
    const now = Date.now();
    const serverLimit = Number(process.env.DEVICE_MAX_PULSE_MS ?? 0);
    const configured =
      Number.isInteger(serverLimit) &&
      serverLimit > 0 &&
      serverLimit <= HARD_MAX_PULSE_MS;
    return devices.map((d) => {
      const online = isFresh(d.lastSeen, now);
      const latest = d.commands[0];
      const review = d.commandReconciliations[0];
      const waitingForHeartbeat =
        !!review && (!d.lastSeen || d.lastSeen <= review.acknowledgedAt);
      const cooldownUntil = latest ? cooldownEnd(latest) : 0;
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
                    : d._count.commands > 0
                      ? 'Previous command pending or unresolved; inspect before retrying'
                      : waitingForHeartbeat
                        ? 'Waiting for an accepted heartbeat after operator acknowledgement'
                        : cooldownUntil > now
                          ? 'Waiting for cooldown'
                          : null;
      const { _count, ...device } = d;
      return {
        ...device,
        unresolvedCommandCount: _count.commands,
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
    const diagnostics = parseDiagnostics(b.diagnostics);
    return this.db.$transaction(async (tx) => {
      // Validate both observation clocks under the shared device lock before
      // recording health events or invalidating commands for a new boot.
      await tx.$queryRaw`SELECT "id" FROM "LockerDevice" WHERE "id" = ${id} FOR UPDATE`;
      const device = await tx.lockerDevice.findUnique({ where: { id } });
      if (!device?.enabled) throw new UnauthorizedException();
      const receivedAt = Date.now();
      const sampled = b.observedAtMs;
      const stamped = sampled !== undefined;
      if (
        stamped &&
        (!Number.isSafeInteger(sampled) ||
          sampled > receivedAt + 2000 ||
          sampled <= receivedAt - freshnessMs())
      ) {
        throw new BadRequestException(
          'Door observation timestamp outside freshness window',
        );
      }
      const observed = stamped ? new Date(sampled) : null;
      if (
        device.doorObservedAt &&
        (!observed || observed <= device.doorObservedAt)
      )
        return { accepted: false, ignored: true };
      if (!(await this.reliability.heartbeat(tx, device, diagnostics)))
        return { accepted: false, ignored: true };
      await tx.lockerDevice.update({
        where: { id },
        data: {
          doorObservedAt: observed,
          lastSeen: new Date(
            stamped ? Math.min(receivedAt, sampled) : receivedAt,
          ),
          doorState: b.doorState,
          outputState: b.outputState,
          firmwareVersion: b.firmwareVersion,
          actuationEnabled: b.actuationEnabled,
          maxPulseMs: b.maxPulseMs,
        },
      });
      return { accepted: true };
    });
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
        include: {
          locker: true,
          commandReconciliations: {
            orderBy: { acknowledgedAt: 'desc' },
            take: 1,
          },
        },
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
        !isFresh(d.lastSeen) ||
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
      const unresolved = await tx.deviceCommand.count({
        where: { deviceId: id, ...unresolvedCommand },
      });
      const review = d.commandReconciliations[0];
      if (review && (!d.lastSeen || d.lastSeen <= review.acknowledgedAt))
        throw new ConflictException(
          'Waiting for an accepted heartbeat after operator acknowledgement',
        );
      if (unresolved || (recent && Date.now() < cooldownEnd(recent))) {
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
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "LockerDevice" WHERE "id" = ${id} FOR UPDATE`;
      const d = await tx.lockerDevice.findUnique({
        where: { id },
        include: {
          locker: true,
          commandReconciliations: {
            orderBy: { acknowledgedAt: 'desc' },
            take: 1,
          },
        },
      });
      if (
        !d?.enabled ||
        !d.locker.isActive ||
        !d.actuationEnabled ||
        !d.lastSeen ||
        !isFresh(d.lastSeen) ||
        d.doorState !== 'CLOSED' ||
        d.outputState !== 'INACTIVE'
      )
        return null;
      const c = await tx.deviceCommand.findFirst({
        where: {
          deviceId: id,
          result: null,
          reconciliation: { is: null },
          expiresAt: { gt: new Date() },
          lockerId: d.lockerId,
        },
        orderBy: { issuedAt: 'asc' },
      });
      if (!c) return null;
      const review = d.commandReconciliations[0];
      if (
        (review && (!d.lastSeen || d.lastSeen <= review.acknowledgedAt)) ||
        (await tx.deviceCommand.count({
          where: { deviceId: id, id: { not: c.id }, ...unresolvedCommand },
        }))
      )
        return null;
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
      if (!c.deliveredAt) {
        await tx.deviceCommand.update({
          where: { id: c.id },
          data: { deliveredAt: new Date() },
        });
        await this.reliability.event(
          tx,
          id,
          'COMMAND_DELIVERY_ATTEMPTED',
          `delivery:${c.id}`,
          { commandId: c.id },
        );
      }
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
    });
  }

  async reconcile(
    id: string,
    commandId: string,
    body: unknown,
    actor?: { sub?: string; role?: string },
  ) {
    const input = reconciliationInput(body, actor);
    return this.db.$transaction(async (tx) => {
      // Same lock order as enqueue, delivery, heartbeat, results and the expiry sweep.
      await tx.$queryRaw`SELECT "id" FROM "LockerDevice" WHERE "id" = ${id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "DeviceCommand" WHERE "id" = ${commandId} FOR UPDATE`;
      const command = await tx.deviceCommand.findUnique({
        where: { id: commandId },
        include: { reconciliation: true },
      });
      if (!command || command.deviceId !== id) throw new NotFoundException();
      if (command.reconciliation) {
        const prior = command.reconciliation;
        if (
          prior.operatorId !== input.operatorId ||
          prior.reason !== input.reason ||
          prior.evidence !== input.evidence
        )
          throw new ConflictException(
            'An immutable acknowledgement already exists',
          );
        return {
          acknowledgement: prior,
          commandOutcome: command.result,
          unlockRequested: false,
        };
      }
      if (
        command.expiresAt.getTime() > Date.now() ||
        (command.result !== null && command.result !== 'UNKNOWN')
      )
        throw new ConflictException(
          'Only expired commands with an unknown outcome may be acknowledged',
        );
      if (
        await tx.deviceCommand.findFirst({
          where: {
            deviceId: id,
            id: { not: commandId },
            result: null,
            expiresAt: { gt: new Date() },
          },
        })
      )
        throw new ConflictException(
          'A live command exists; wait for its outcome or expiry before review',
        );
      const acknowledgement = await tx.deviceCommandReconciliation.create({
        data: {
          commandId,
          deviceId: id,
          ...input,
          originalResult: command.result,
          originalResultReason: command.resultReason,
          originalCompletedAt: command.completedAt,
        },
      });
      await this.reliability.event(
        tx,
        id,
        'COMMAND_UNCERTAINTY_ACKNOWLEDGED',
        `acknowledged:${commandId}`,
        {
          commandId,
          severity: 'WARNING',
          details: {
            operatorId: input.operatorId,
            acknowledgedAt: acknowledgement.acknowledgedAt.toISOString(),
            source: 'OPERATOR_REVIEW',
          },
        },
      );
      return {
        acknowledgement,
        commandOutcome: command.result,
        unlockRequested: false,
      };
    });
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
      // Match heartbeat/delivery lock order. Event foreign keys also lock the device.
      await tx.$queryRaw`SELECT "id" FROM "LockerDevice" WHERE "id" = ${id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "DeviceCommand" WHERE "id" = ${commandId} FOR UPDATE`;
      const c = await tx.deviceCommand.findUnique({
        where: { id: commandId },
        include: { reconciliation: true },
      });
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
      await this.reliability.event(
        tx,
        id,
        c.reconciliation
          ? 'COMMAND_LATE_RESULT_AFTER_RECONCILIATION'
          : b.result === 'UNKNOWN'
            ? 'COMMAND_OUTCOME_UNKNOWN'
            : 'COMMAND_RESULT_RECEIVED',
        `result:${commandId}`,
        {
          commandId,
          severity:
            b.result === 'UNKNOWN' || b.result === 'FAILED'
              ? 'WARNING'
              : 'INFO',
          details: {
            result: b.result,
            ...(c.reconciliation && {
              acknowledgedAt: c.reconciliation.acknowledgedAt.toISOString(),
            }),
          },
        },
      );
      return { accepted: true };
    });
  }
}
