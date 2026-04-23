import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import Stripe from 'stripe'
import { PrismaService } from '../prisma/prisma.service'
import { ReservationStatus } from '@prisma/client'

@Injectable()
export class PaymentsService {
	private stripe: any

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

		if (reservation.status === ReservationStatus.EXPIRED) {
			throw new BadRequestException('Hold has expired')
		}

		if (reservation.status !== ReservationStatus.HOLD) {
			throw new BadRequestException('Only HOLD reservations can be paid')
		}

		if (reservation.expiresAt <= new Date()) {
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

	async handleWebhook(rawBody: Buffer | undefined, signature: string) {
		if (!rawBody) {
			throw new BadRequestException('Missing raw body')
		}

		if (!signature) {
			throw new BadRequestException('Missing Stripe signature')
		}

		const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

		if (!webhookSecret) {
			throw new BadRequestException('Missing Stripe webhook secret')
		}

		let event

		try {
			event = this.stripe.webhooks.constructEvent(
				rawBody,
				signature,
				webhookSecret,
			)
		} catch (err: any) {
			throw new BadRequestException(
				`Webhook signature verification failed: ${err.message}`,
			)
		}

		const existingEvent = await this.prisma.paymentEvent.findUnique({
			where: {
				stripeEventId: event.id,
			},
		})

		if (existingEvent) {
			return { received: true, duplicate: true }
		}

		await this.prisma.paymentEvent.create({
			data: {
				stripeEventId: event.id,
			},
		})

		if (event.type === 'payment_intent.succeeded') {
			const paymentIntent = event.data.object as any
			const reservationId = paymentIntent.metadata?.reservationId

			if (!reservationId) {
				throw new BadRequestException('Missing reservationId metadata')
			}

			const reservation = await this.prisma.reservation.findUnique({
				where: {
					id: reservationId,
				},
			})

			if (!reservation) {
				throw new NotFoundException('Reservation not found')
			}

			if (reservation.status === ReservationStatus.HOLD) {
				await this.prisma.reservation.update({
					where: {
						id: reservationId,
					},
					data: {
						status: ReservationStatus.CONFIRMED,
					},
				})
			}
		}

		return { received: true }
	}
}