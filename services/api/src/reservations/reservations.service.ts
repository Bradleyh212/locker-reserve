import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { CreateHoldDto } from './dto/create-hold.dto'
import { ReservationStatus } from '@prisma/client'
import { RedisCacheService } from '../cache/redis-cache.service'

const LOCKERS_AVAILABILITY_CACHE_PATTERN = 'lockers:availability:*'

@Injectable()
export class ReservationsService {
	private readonly logger = new Logger(ReservationsService.name)

	constructor(
		private prisma: PrismaService,
		private cache: RedisCacheService,
	) {}

	async createHold(dto: CreateHoldDto) {
		const start = new Date(dto.startTime)
		const end = new Date(dto.endTime)

		if (isNaN(start.getTime()) || isNaN(end.getTime())) {
			throw new BadRequestException('Invalid startTime or endTime')
		}

		if (end <= start) {
			throw new BadRequestException('endTime must be after startTime')
		}

		const locker = await this.prisma.locker.findUnique({
			where: { id: dto.lockerId },
		})

		if (!locker) {
			throw new NotFoundException(`Locker ${dto.lockerId} not found`)
		}

		if (!locker.isActive) {
			throw new BadRequestException('Locker is inactive')
		}

		const now = new Date()

		const overlapping = await this.prisma.reservation.findFirst({
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
		})

		if (overlapping) {
			throw new BadRequestException(
				'Locker is already reserved for that time range',
			)
		}

		const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

		const reservation = await this.prisma.reservation.create({
			data: {
				lockerId: dto.lockerId,
				startTime: start,
				endTime: end,
				expiresAt,
				status: ReservationStatus.HOLD,
			},
			include: {
				locker: true,
			},
		})

		await this.invalidateAvailabilityCache()

		return reservation
	}

	findAll() {
		return this.prisma.reservation.findMany({
			orderBy: { createdAt: 'desc' },
			include: { locker: true },
		})
	}

	async confirm(id: string) {
		const reservation = await this.prisma.reservation.findUnique({
			where: { id },
		})

		if (!reservation) {
			throw new NotFoundException('Reservation not found')
		}

		if (reservation.status !== ReservationStatus.HOLD) {
			throw new BadRequestException('Only HOLD reservations can be confirmed')
		}

		if (reservation.expiresAt <= new Date()) {
			throw new BadRequestException('Hold has expired')
		}

		const updated = await this.prisma.reservation.update({
			where: { id },
			data: {
				status: ReservationStatus.CONFIRMED,
			},
		})

		await this.invalidateAvailabilityCache()

		return updated
	}

	async cancel(id: string) {
		const reservation = await this.prisma.reservation.findUnique({
			where: { id },
		})

		if (!reservation) {
			throw new NotFoundException('Reservation not found')
		}

		if (reservation.status === ReservationStatus.CANCELLED) {
			throw new BadRequestException('Reservation already cancelled')
		}

		if (
			reservation.status === ReservationStatus.HOLD &&
			reservation.expiresAt <= new Date()
		) {
			throw new BadRequestException('Expired hold cannot be cancelled')
		}

		const updated = await this.prisma.reservation.update({
			where: { id },
			data: {
				status: ReservationStatus.CANCELLED,
			},
		})

		await this.invalidateAvailabilityCache()

		return updated
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
		})

		if (result.count > 0) {
			this.logger.log(`Expired ${result.count} hold(s)`)
			await this.invalidateAvailabilityCache()
		}
	}

	private async invalidateAvailabilityCache() {
		await this.cache.deleteByPattern(LOCKERS_AVAILABILITY_CACHE_PATTERN)
	}
}
