import { Injectable } from '@nestjs/common'
import { ReservationStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

const RESERVATION_CHART_DAYS = 30

@Injectable()
export class DashboardService {
	constructor(private prisma: PrismaService) {}

	async getStats() {
		const now = new Date()
		const chartStart = this.startOfDay(
			new Date(now.getTime() - (RESERVATION_CHART_DAYS - 1) * 24 * 60 * 60 * 1000),
		)

		const [
			totalLockers,
			activeLockers,
			pendingHolds,
			confirmedReservations,
			expiredReservations,
			expiredHolds,
			cancelledReservations,
			recentReservations,
			chartReservations,
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
			this.prisma.reservation.findMany({
				take: 5,
				orderBy: { createdAt: 'desc' },
				include: { locker: true },
			}),
			this.prisma.reservation.findMany({
				where: {
					createdAt: { gte: chartStart },
				},
				select: {
					createdAt: true,
				},
			}),
		])

		const dailyReservations = this.getDailyReservationCounts(
			chartStart,
			chartReservations.map((reservation) => reservation.createdAt),
		)

		return {
			totalLockers,
			activeLockers,
			inactiveLockers: totalLockers - activeLockers,
			activeReservations: pendingHolds + confirmedReservations,
			pendingHolds,
			confirmedReservations,
			expiredReservations: expiredReservations + expiredHolds,
			cancelledReservations,
			dailyReservations,
			statusBreakdown: [
				{ status: 'CONFIRMED', count: confirmedReservations },
				{ status: 'HOLD', count: pendingHolds },
				{ status: 'EXPIRED', count: expiredReservations + expiredHolds },
				{ status: 'CANCELLED', count: cancelledReservations },
			],
			recentReservations: recentReservations.map((reservation) => ({
				id: reservation.id,
				lockerCode: reservation.locker.code,
				startTime: reservation.startTime,
				endTime: reservation.endTime,
				expiresAt: reservation.expiresAt,
				status: reservation.status,
				createdAt: reservation.createdAt,
				estimatedTotalCents: this.estimateTotalCents(
					reservation.startTime,
					reservation.endTime,
				),
				paymentStatus: this.getPaymentStatus(reservation.status),
			})),
		}
	}

	private getDailyReservationCounts(start: Date, reservationDates: Date[]) {
		const countsByDate = new Map<string, number>()

		for (let index = 0; index < RESERVATION_CHART_DAYS; index += 1) {
			const date = new Date(start)
			date.setDate(start.getDate() + index)
			countsByDate.set(this.dateKey(date), 0)
		}

		for (const reservationDate of reservationDates) {
			const key = this.dateKey(reservationDate)
			countsByDate.set(key, (countsByDate.get(key) ?? 0) + 1)
		}

		return Array.from(countsByDate.entries()).map(([date, count]) => ({
			date,
			count,
		}))
	}

	private startOfDay(date: Date) {
		const next = new Date(date)
		next.setHours(0, 0, 0, 0)
		return next
	}

	private dateKey(date: Date) {
		return date.toISOString().slice(0, 10)
	}

	private estimateTotalCents(startTime: Date, endTime: Date) {
		const durationHours =
			(endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60)

		return Math.max(1, Math.round(durationHours * 500))
	}

	private getPaymentStatus(status: ReservationStatus) {
		switch (status) {
			case ReservationStatus.CONFIRMED:
				return 'Paid'
			case ReservationStatus.HOLD:
				return 'Pending'
			case ReservationStatus.CANCELLED:
				return 'Closed'
			case ReservationStatus.EXPIRED:
			default:
				return 'Expired'
		}
	}
}
