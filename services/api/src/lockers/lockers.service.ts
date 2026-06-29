import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ReservationStatus, type Locker } from '@prisma/client'
import { CreateLockerDto } from './dto/create-locker.dto'
import { UpdateLockerDto } from './dto/update-locker.dto'
import { CheckAvailabilityDto } from './dto/check-availability.dto'
import { RedisCacheService } from '../cache/redis-cache.service'

const LOCKERS_LIST_CACHE_KEY = 'lockers:list'
const LOCKERS_LIST_CACHE_TTL_SECONDS = 60
const LOCKERS_AVAILABILITY_CACHE_KEY_PREFIX = 'lockers:availability'
const LOCKERS_AVAILABILITY_CACHE_TTL_SECONDS = 30

@Injectable()
export class LockersService {
	constructor(
		private prisma: PrismaService,
		private cache: RedisCacheService,
	) {}

	async findAll() {
		const cached = await this.cache.get<Locker[]>(LOCKERS_LIST_CACHE_KEY)

		if (cached !== null) {
			return cached
		}

		const lockers = await this.prisma.locker.findMany({
			orderBy: { createdAt: 'desc' },
		})

		await this.cache.set(
			LOCKERS_LIST_CACHE_KEY,
			lockers,
			LOCKERS_LIST_CACHE_TTL_SECONDS,
		)

		return lockers
	}

	async create(dto: CreateLockerDto) {
		try {
			const locker = await this.prisma.locker.create({
				data: {
					code: dto.code,
					location: dto.location,
					isActive: dto.isActive ?? true,
				},
			})

			await this.invalidateLockerCaches()

			return locker
		} catch (e: any) {
			if (e?.code === 'P2002') {
				throw new ConflictException(`Locker code "${dto.code}" already exists`)
			}
			throw e
		}
	}

	async update(id: string, dto: UpdateLockerDto) {
		try {
			const locker = await this.prisma.locker.update({
				where: { id },
				data: dto,
			})

			await this.invalidateLockerCaches()

			return locker
		} catch (e: any) {
			// Prisma "record not found"
			if (e?.code === 'P2025') {
				throw new NotFoundException(`Locker ${id} not found`)
			}
			throw e
		}
	}

	async checkAvailability(dto: CheckAvailabilityDto) {
		const start = new Date(dto.startTime)
		const end = new Date(dto.endTime)

		if (isNaN(start.getTime()) || isNaN(end.getTime())) {
			throw new BadRequestException('Invalid startTime or endTime')
		}

		if (end <= start) {
			throw new BadRequestException('endTime must be after startTime')
		}

		const cacheKey = this.availabilityCacheKey(dto, start, end)
		const cached = await this.cache.get<Locker[]>(cacheKey)

		if (cached !== null) {
			return cached
		}

		const now = new Date()

		const unavailableReservations = await this.prisma.reservation.findMany({
			where: {
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
			select: {
				lockerId: true,
			},
		})

		const unavailableLockerIds = unavailableReservations.map((r) => r.lockerId)

		const lockers = await this.prisma.locker.findMany({
			where: {
				isActive: true,
				...(dto.location ? { location: dto.location } : {}),
				id: {
					notIn: unavailableLockerIds,
				},
			},
			orderBy: {
				code: 'asc',
			},
		})

		await this.cache.set(
			cacheKey,
			lockers,
			LOCKERS_AVAILABILITY_CACHE_TTL_SECONDS,
		)

		return lockers
	}

	private availabilityCacheKey(
		dto: CheckAvailabilityDto,
		start: Date,
		end: Date,
	) {
		const location = dto.location || 'all'
		return `${LOCKERS_AVAILABILITY_CACHE_KEY_PREFIX}:start=${encodeURIComponent(
			start.toISOString(),
		)}:end=${encodeURIComponent(end.toISOString())}:location=${encodeURIComponent(
			location,
		)}`
	}

	private async invalidateLockerCaches() {
		await this.cache.delete(LOCKERS_LIST_CACHE_KEY)
		await this.cache.deleteByPattern(
			`${LOCKERS_AVAILABILITY_CACHE_KEY_PREFIX}:*`,
		)
	}
}
