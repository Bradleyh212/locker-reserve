import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	ServiceUnavailableException,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { Prisma, ReservationStatus } from '@prisma/client'
import { RedisCacheService } from '../cache/redis-cache.service'

const LOCKERS_AVAILABILITY_CACHE_PATTERN = 'lockers:availability:*'

function price(r: { startTime: Date; endTime: Date }) {
	return Math.max(1, Math.round((r.endTime.getTime() - r.startTime.getTime()) / 3600000 * 500))
}

// A reversal can precede intent binding or success. Order all three by Stripe intent ID.
function lockIntent(tx: Prisma.TransactionClient, id: string) {
	return tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${id}, 0))`
}

@Injectable()
export class PaymentsService {
	private stripe: any

	constructor(
		private prisma: PrismaService,
		private cache: RedisCacheService,
	) {
		const Stripe = require('stripe')

		this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
			apiVersion: '2026-03-25.dahlia',
		})
	}

	async createPaymentIntent(reservationId: string, ownerHash?: string) {
		const reservation = await this.prisma.reservation.findUnique({
			where: { id: reservationId },
			include: { access: true },
		})

		if (!reservation || (reservation.access?.tokenHash !== ownerHash)) {
			throw new NotFoundException('Reservation not found')
		}

		if (ownerHash && reservation.access?.revokedAt) throw new ForbiddenException('Reservation payment is unavailable')

		if (reservation.status === ReservationStatus.EXPIRED) {
			throw new BadRequestException('Hold has expired')
		}

		if (reservation.status !== ReservationStatus.HOLD) {
			throw new BadRequestException('Only HOLD reservations can be paid')
		}

		if (reservation.expiresAt <= new Date()) {
			throw new BadRequestException('Hold has expired')
		}

		const amount = price(reservation)

		const intent = await this.stripe.paymentIntents.create(
			{
				amount,
				currency: 'cad',
				metadata: { reservationId },
			},
			{ idempotencyKey: `reservation:${reservationId}` },
		)
		if (ownerHash) {
			// Bind before releasing the client secret. Concurrent callers use Stripe's same idempotency key.
			const usable = await this.prisma.$transaction(async tx => {
				await lockIntent(tx, intent.id)
				const reversal = await tx.paymentEvent.findFirst({ where: { reversedIntentId: intent.id } })
				const bound = await tx.customerReservationAccess.updateMany({
					where: { reservationId, tokenHash: ownerHash, revokedAt: null,
						OR: [{ paymentIntentId: null }, { paymentIntentId: intent.id }],
						reservation: { is: { status: 'HOLD', expiresAt: { gt: new Date() } } },
					},
					data: { paymentIntentId: intent.id, ...(reversal && { revokedAt: new Date() }) },
				})
				return bound.count > 0 && !reversal
			})
			if (!usable) throw new ConflictException('Reservation is no longer payable')
		}
		return intent
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

		// Deduplication and the state transition commit together. A failed handler
		// must not consume the event and prevent Stripe's retry from processing it.
		const outcome = await this.prisma.$transaction(async (tx) => {
			const inserted = await tx.paymentEvent.createMany({
				data: [{ stripeEventId: event.id }],
				skipDuplicates: true,
			})
			if (!inserted.count) return { duplicate: true, changed: false }
			if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
				const linked = event.data.object.payment_intent
				const intentId = typeof linked === 'string' ? linked : linked?.id
				if (typeof intentId === 'string') {
					await lockIntent(tx, intentId)
					await tx.paymentEvent.update({ where: { stripeEventId: event.id }, data: { reversedIntentId: intentId } })
					await tx.customerReservationAccess.updateMany({
						where: { paymentIntentId: intentId, revokedAt: null },
						data: { revokedAt: new Date() },
					})
				}
				return { duplicate: false, changed: false }
			}
			if (event.type !== 'payment_intent.succeeded') {
				return { duplicate: false, changed: false }
			}
			const reservationId = event.data.object.metadata?.reservationId
			if (!reservationId) {
				throw new BadRequestException('Missing reservationId metadata')
			}
			if (typeof event.data.object.id !== 'string') throw new BadRequestException('Missing payment intent ID')
			await lockIntent(tx, event.data.object.id)
			// Serialize confirmation/cancellation and payment proof for this reservation.
			await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${reservationId} FOR UPDATE`
			const reservation = await tx.reservation.findUnique({
				where: { id: reservationId },
				include: { access: true },
			})
			if (!reservation) throw new NotFoundException('Reservation not found')
			const grant = reservation.access
			if (grant) {
				const intent = event.data.object
				if (!grant.paymentIntentId) throw new ServiceUnavailableException('Payment binding pending')
				const expected = price(reservation)
				if (grant.revokedAt || intent.id !== grant.paymentIntentId ||
					intent.status !== 'succeeded' || intent.currency !== 'cad' ||
					intent.amount !== expected || intent.amount_received !== expected) {
					return { duplicate: false, changed: false }
				}
			}
			const changed = await tx.reservation.updateMany({
				where: {
					id: reservationId,
					status: ReservationStatus.HOLD,
					expiresAt: { gt: new Date() },
				},
				data: { status: ReservationStatus.CONFIRMED },
			})
			// A manual confirmation may have won the race. It still needs independent
			// signed payment proof before the reservation can authorize access.
			const alreadyConfirmedInTime = reservation.status === 'CONFIRMED' && reservation.expiresAt > new Date()
			if (grant && (changed.count || alreadyConfirmedInTime)) {
				await tx.customerReservationAccess.updateMany({
					where: { reservationId, paidAt: null, revokedAt: null },
					data: { paidAt: new Date() },
				})
			}
			return { duplicate: false, changed: changed.count > 0 }
		})
		if (outcome.changed) {
			await this.cache.deleteByPattern(LOCKERS_AVAILABILITY_CACHE_PATTERN)
		}
		return outcome.duplicate
			? { received: true, duplicate: true }
			: { received: true }
	}
}
