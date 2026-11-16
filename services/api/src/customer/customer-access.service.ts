import { isFresh } from '../devices/device-health';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Reservation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DevicesService, HARD_MAX_PULSE_MS } from '../devices/devices.service';
import { RedisCacheService } from '../cache/redis-cache.service';
import { bearerHash, customerStatus, digest, eligible } from './access-policy';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HISTORY_MS = 24 * 3600000;
const missing = () => new NotFoundException('Reservation resource not found');

@Injectable()
export class CustomerAccessService {
  private logger = new Logger(CustomerAccessService.name);
  constructor(
    private db: PrismaService,
    private devices: DevicesService,
    private cache: RedisCacheService,
  ) {}

  private async owner(id: string, hash: string) {
    const r = await this.db.reservation.findFirst({
      where: {
        id,
        access: { is: { tokenHash: hash } },
        endTime: { gt: new Date(Date.now() - HISTORY_MS) },
      },
      include: { access: true },
    });
    if (!r) throw missing();
    return r;
  }

  private async target(tx: Prisma.TransactionClient, r: Reservation) {
    await tx.$queryRaw`SELECT "id" FROM "Locker" WHERE "id" = ${r.lockerId} FOR SHARE`;
    const device = await tx.lockerDevice.findUnique({
      where: { lockerId: r.lockerId },
      select: { id: true },
    });
    if (!device) throw new ConflictException('Locker is unavailable');
    const pulseMs = Number(process.env.CUSTOMER_UNLOCK_PULSE_MS);
    if (
      !Number.isInteger(pulseMs) ||
      pulseMs < 1 ||
      pulseMs > HARD_MAX_PULSE_MS ||
      pulseMs > Number(process.env.DEVICE_MAX_PULSE_MS ?? 0)
    )
      throw new ForbiddenException('Customer access is unavailable');
    return {
      id: device.id,
      pulse: { pulseMs, reason: 'Reservation access' },
      scope: { reservationId: r.id, lockerId: r.lockerId, endTime: r.endTime },
    };
  }

  async readiness(id: string, header?: string) {
    const hash = bearerHash(header);
    await this.owner(id, hash);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${id} FOR SHARE`;
      const r = await tx.reservation.findUnique({
        where: { id },
        include: { access: true },
      });
      if (!r || r.access?.tokenHash !== hash) throw missing();
      const commands = await tx.deviceCommand.findMany({
        where: { reservationId: id },
        include: { reconciliation: true },
        orderBy: { issuedAt: 'desc' },
        take: 10,
      });
      const base = {
        paymentState: r.access!.paymentState,
        serverNow: new Date(),
        commands: commands.map(customerStatus),
        door: null as null | {
          state: string;
          observedAt: Date | null;
          fresh: boolean;
        },
      };
      if (!eligible(r, Date.now()))
        return { ...base, available: false, code: 'RESERVATION_INELIGIBLE' };
      try {
        const target = await this.target(tx, r);
        await this.devices.checkPulse(
          tx,
          target.id,
          target.pulse,
          target.scope,
        );
        const d = await tx.lockerDevice.findUniqueOrThrow({
          where: { id: target.id },
        });
        return {
          ...base,
          available: true,
          code: 'READY',
          door: {
            state: d.doorState,
            observedAt: d.doorObservedAt,
            fresh: isFresh(d.lastSeen),
          },
        };
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        const d = await tx.lockerDevice.findUnique({
          where: { lockerId: r.lockerId },
        });
        const fresh = !!d && isFresh(d.lastSeen);
        const detail = error.getResponse();
        return {
          ...base,
          available: false,
          code:
            typeof detail === 'object' && 'retryAt' in detail
              ? 'COOLDOWN'
              : 'LOCKER_UNAVAILABLE',
          ...(typeof detail === 'object' && 'retryAt' in detail
            ? { retryAt: detail.retryAt }
            : {}),
          door: d
            ? {
                state: fresh ? d.doorState : 'UNKNOWN',
                observedAt: d.doorObservedAt,
                fresh,
              }
            : null,
        };
      }
    });
  }

  async unlock(
    id: string,
    header: string | undefined,
    key: string | undefined,
  ) {
    const hash = bearerHash(header);
    await this.owner(id, hash);
    if (!key || !UUID.test(key))
      throw new BadRequestException('Idempotency-Key must be a UUID v4');
    await this.cache.limitAccess('unlock:' + id, 8, 60);
    const requestKey = key.toLowerCase();
    const { response, replayed } = await this.db.$transaction(async (tx) => {
      // Serializes retries and cancellation. Lock the payment grant too so revocation
      // and enqueue have a defined order. Device locking is shared with admin requests.
      await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "reservationId" FROM "CustomerReservationAccess" WHERE "reservationId" = ${id} FOR UPDATE`;
      const r = await tx.reservation.findUnique({
        where: { id },
        include: { access: true },
      });
      if (
        !r ||
        r.access?.tokenHash !== hash ||
        r.endTime.getTime() + HISTORY_MS <= Date.now()
      )
        throw missing();
      const previous = await tx.deviceCommand.findUnique({
        where: { reservationId_requestKey: { reservationId: id, requestKey } },
        include: { reconciliation: true },
      });
      if (previous)
        return { response: customerStatus(previous), replayed: true };
      if (!eligible(r, Date.now()))
        throw new ForbiddenException('Reservation is not eligible for access');
      const target = await this.target(tx, r);
      const command = await this.devices.createPulse(
        tx,
        target.id,
        target.pulse,
        'customer-reservation:' + id,
        { ...target.scope, requestKey },
      );
      return { response: customerStatus(command), replayed: false };
    });
    this.logger.log({
      event: 'customer_unlock_request',
      reservationId: id,
      commandId: response.commandId,
      status: response.status,
      replayed,
    });
    return response;
  }

  async lookup(id: string, key: string | undefined, header?: string) {
    await this.owner(id, bearerHash(header));
    if (!key || !UUID.test(key))
      throw new BadRequestException('Idempotency-Key must be a UUID v4');
    const command = await this.db.deviceCommand.findUnique({
      include: { reconciliation: true },
      where: {
        reservationId_requestKey: {
          reservationId: id,
          requestKey: key.toLowerCase(),
        },
      },
    });
    if (!command) throw missing();
    return customerStatus(command);
  }

  async status(id: string, commandId: string, header?: string) {
    await this.owner(id, bearerHash(header));
    const command = await this.db.deviceCommand.findFirst({
      where: { id: commandId, reservationId: id },
      include: { reconciliation: true },
    });
    if (!command) throw missing();
    return customerStatus(command);
  }
}
