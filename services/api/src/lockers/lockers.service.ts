import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationStatus } from '@prisma/client'
import { CreateLockerDto } from './dto/create-locker.dto';
import { UpdateLockerDto } from './dto/update-locker.dto';
import { CheckAvailabilityDto } from './dto/check-availability.dto'

@Injectable()
export class LockersService {
	constructor(private prisma: PrismaService) {}

	findAll() {
		return this.prisma.locker.findMany({
			orderBy: { createdAt: 'desc' },
		});
	}

	async create(dto: CreateLockerDto) {
		try {
			return await this.prisma.locker.create({
				data: {
					code: dto.code,
					location: dto.location,
					isActive: dto.isActive ?? true,
				},
			});
		} catch (e: any) {
			if (e?.code === 'P2002') {
				throw new ConflictException(`Locker code "${dto.code}" already exists`);
			}
			throw e;
		}
	}

	async update(id: string, dto: UpdateLockerDto) {
		try {
			return await this.prisma.locker.update({
				where: { id },
				data: dto,
			});
		} catch (e: any) {
			// Prisma "record not found"
			if (e?.code === 'P2025') {
				throw new NotFoundException(`Locker ${id} not found`);
			}
			throw e;
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

		return this.prisma.locker.findMany({
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
	}
}
