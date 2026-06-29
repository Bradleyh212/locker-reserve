import { Injectable } from '@nestjs/common'
import { ReservationStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class DashboardService {
	constructor(private prisma: PrismaService) {}

	async getStats() {
		const now = new Date()

		const [
			totalLockers,
			activeLockers,
			pendingHolds,
			confirmedReservations,
			expiredReservations,
			expiredHolds,
			cancelledReservations,
		] = await this.prisma.$transaction([
			this.prisma.locker.count(),
			this.prisma.locker.count({ where: { isActive: true } }),
			this.prisma.reservation.count({
				where: {
					status: ReservationStatus.HOLD,
					expiresAt: { gt: now },
				},
			}),
			this.prisma.reservation.count({
				where: { status: ReservationStatus.CONFIRMED },
			}),
			this.prisma.reservation.count({
				where: { status: ReservationStatus.EXPIRED },
			}),
			this.prisma.reservation.count({
				where: {
					status: ReservationStatus.HOLD,
					expiresAt: { lte: now },
				},
			}),
			this.prisma.reservation.count({
				where: { status: ReservationStatus.CANCELLED },
			}),
		])

		return {
			totalLockers,
			activeLockers,
			inactiveLockers: totalLockers - activeLockers,
			activeReservations: pendingHolds + confirmedReservations,
			pendingHolds,
			confirmedReservations,
			expiredReservations: expiredReservations + expiredHolds,
			cancelledReservations,
		}
	}
}
