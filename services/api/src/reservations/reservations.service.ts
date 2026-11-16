import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { reservationAmount } from '../customer/access-policy';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHoldDto } from './dto/create-hold.dto';
import { ReservationStatus } from '@prisma/client';
import { RedisCacheService } from '../cache/redis-cache.service';

const LOCKERS_AVAILABILITY_CACHE_PATTERN = 'lockers:availability:*';

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private prisma: PrismaService,
    private cache: RedisCacheService,
  ) {}

  async createHold(
    dto: CreateHoldDto,
    accessTokenHash?: string,
    requestKey?: string,
  ) {
    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid startTime or endTime');
    }

    if (end <= start) {
      throw new BadRequestException('endTime must be after startTime');
    }

    // Serialize the overlap check and insertion across all API processes.
    const reservation = await this.prisma.$transaction(async (tx) => {
      // A stable client-generated key and owner proof exist before the first POST.
      // Serialize retries before taking the locker lock, including across API instances.
      if (requestKey && accessTokenHash) {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'owner:' + accessTokenHash}, 0))`;
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${requestKey}, 0))`;
        const prior = await tx.customerReservationAccess.findUnique({
          where: { requestKey },
          include: { reservation: { include: { locker: true } } },
        });
        if (prior) {
          if (prior.tokenHash !== accessTokenHash)
            throw new NotFoundException('Reservation resource not found');
          const r = prior.reservation;
          if (
            r.lockerId !== dto.lockerId ||
            r.startTime.getTime() !== start.getTime() ||
            r.endTime.getTime() !== end.getTime()
          )
            throw new ConflictException(
              'Creation key is already bound to different booking details',
            );
          return r; // Never extend expiresAt, even after cancellation or expiry.
        }
        if (
          await tx.customerReservationAccess.findUnique({
            where: { tokenHash: accessTokenHash },
          })
        )
          throw new ConflictException(
            'Credential is already bound to a booking',
          );
      }

      await tx.$queryRaw`SELECT "id" FROM "Locker" WHERE "id" = ${dto.lockerId} FOR UPDATE`;
      const locker = await tx.locker.findUnique({
        where: { id: dto.lockerId },
      });

      if (!locker) {
        throw new NotFoundException(`Locker ${dto.lockerId} not found`);
      }

      if (!locker.isActive) {
        throw new BadRequestException('Locker is inactive');
      }

      const now = new Date();

      const overlapping = await tx.reservation.findFirst({
        where: {
          lockerId: dto.lockerId,
          AND: [
            {
              OR: [
                { status: ReservationStatus.CONFIRMED },
                {
                  status: ReservationStatus.HOLD,
                  expiresAt: { gt: now },
                },
              ],
            },
            { startTime: { lt: end } },
            { endTime: { gt: start } },
          ],
        },
      });

      if (overlapping) {
        throw new BadRequestException(
          'Locker is already reserved for that time range',
        );
      }

      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      return tx.reservation.create({
        data: {
          lockerId: dto.lockerId,
          startTime: start,
          endTime: end,
          expiresAt,
          status: ReservationStatus.HOLD,
          ...(accessTokenHash && {
            access: {
              create: {
                tokenHash: accessTokenHash,
                requestKey,
                expectedAmount: reservationAmount({
                  startTime: start,
                  endTime: end,
                }),
                currency: 'cad',
              },
            },
          }),
        },
        include: {
          locker: true,
        },
      });
    });

    await this.invalidateAvailabilityCache();

    return reservation;
  }

  findAll() {
    return this.prisma.reservation.findMany({
      orderBy: { createdAt: 'desc' },
      include: { locker: true },
    });
  }

  async confirm(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
    });

    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    if (reservation.status !== ReservationStatus.HOLD) {
      throw new BadRequestException('Only HOLD reservations can be confirmed');
    }

    if (reservation.expiresAt <= new Date()) {
      throw new BadRequestException('Hold has expired');
    }

    // Compare-and-set: a concurrent cancellation/expiration must not be overwritten.
    const changed = await this.prisma.reservation.updateMany({
      where: {
        id,
        status: ReservationStatus.HOLD,
        expiresAt: { gt: new Date() },
      },
      data: { status: ReservationStatus.CONFIRMED },
    });
    if (!changed.count) {
      throw new BadRequestException('Hold is no longer confirmable');
    }
    const updated = await this.prisma.reservation.findUniqueOrThrow({
      where: { id },
    });

    await this.invalidateAvailabilityCache();

    return updated;
  }

  async cancel(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
    });

    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    if (reservation.status === ReservationStatus.CANCELLED) {
      throw new BadRequestException('Reservation already cancelled');
    }

    if (
      reservation.status === ReservationStatus.HOLD &&
      reservation.expiresAt <= new Date()
    ) {
      throw new BadRequestException('Expired hold cannot be cancelled');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.reservation.findUniqueOrThrow({ where: { id } });
      if (
        current.status === 'CANCELLED' ||
        (current.status === 'HOLD' && current.expiresAt <= new Date())
      )
        throw new BadRequestException('Reservation is no longer cancellable');
      const grant = await tx.customerReservationAccess.findUnique({
        where: { reservationId: id },
      });
      await tx.customerReservationAccess.updateMany({
        where: { reservationId: id, revokedAt: null },
        data: {
          revokedAt: new Date(),
          ...(grant?.paidAt && {
            paymentState: 'RECONCILIATION_REQUIRED',
            reconciliationReason: 'CANCELED_AFTER_PAYMENT',
          }),
        },
      });
      return tx.reservation.update({
        where: { id },
        data: { status: ReservationStatus.CANCELLED },
      });
    });

    await this.invalidateAvailabilityCache();

    return updated;
  }

  @Cron('*/60 * * * * *')
  async expireHolds() {
    const result = await this.prisma.reservation.updateMany({
      where: {
        status: ReservationStatus.HOLD,
        expiresAt: {
          lte: new Date(),
        },
      },
      data: {
        status: ReservationStatus.EXPIRED,
      },
    });

    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} hold(s)`);
      await this.invalidateAvailabilityCache();
    }
  }

  private async invalidateAvailabilityCache() {
    await this.cache.deleteByPattern(LOCKERS_AVAILABILITY_CACHE_PATTERN);
  }
}
