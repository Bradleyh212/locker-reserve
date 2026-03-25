import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHoldDto } from './dto/create-hold.dto';
import { ReservationStatus } from '@prisma/client';

@Injectable()
export class ReservationsService {
	constructor(private prisma: PrismaService) {}

	async createHold(dto: CreateHoldDto) {
		const start = new Date(dto.startTime);
		const end = new Date(dto.endTime);

		if (isNaN(start.getTime()) || isNaN(end.getTime())) {
			throw new BadRequestException('Invalid startTime or endTime');
		}

		if (end <= start) {
			throw new BadRequestException('endTime must be after startTime');
		}

		const locker = await this.prisma.locker.findUnique({
			where: { id: dto.lockerId },
		});

		if (!locker) {
			throw new NotFoundException(`Locker ${dto.lockerId} not found`);
		}

		if (!locker.isActive) {
			throw new BadRequestException('Locker is inactive');
		}

		const now = new Date();

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
		});

		if (overlapping) {
			throw new BadRequestException('Locker is already reserved for that time range');
		}

		const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

		return this.prisma.reservation.create({
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
		});
	}

	findAll() {
		return this.prisma.reservation.findMany({
			orderBy: { createdAt: 'desc' },
			include: { locker: true },
		});
	}
}