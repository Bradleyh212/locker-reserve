import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import Stripe from 'stripe'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class PaymentsService {
	private stripe: Stripe.Stripe

	constructor(private prisma: PrismaService) {
		this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
			apiVersion: '2026-03-25.dahlia',
		})
	}

	async createPaymentIntent(reservationId: string) {
		const reservation = await this.prisma.reservation.findUnique({
			where: { id: reservationId },
		})

		if (!reservation) {
			throw new NotFoundException('Reservation not found')
		}

		if (reservation.status === 'EXPIRED') {

			throw new BadRequestException('Hold has expired')

		}

		if (reservation.status !== 'HOLD') {
			throw new BadRequestException('Only HOLD reservations can be paid')
		}

		if (reservation.expiresAt <= new Date()) {				// Old hold that's not auto-updated
			throw new BadRequestException('Hold has expired')
		}

		const start = new Date(reservation.startTime)
		const end = new Date(reservation.endTime)

		const durationHours =
			(end.getTime() - start.getTime()) / (1000 * 60 * 60)

		const pricePerHour = 500
		const amount = Math.max(1, Math.round(durationHours * pricePerHour))

		return this.stripe.paymentIntents.create({
			amount,
			currency: 'cad',
			metadata: {
				reservationId,
			},
		})
	}
}