import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { RedisCacheService } from '../cache/redis-cache.service';

type StripeClient = InstanceType<typeof Stripe>;
type PaymentIntent = Awaited<
  ReturnType<StripeClient['paymentIntents']['retrieve']>
>;
type StripeEvent = ReturnType<StripeClient['webhooks']['constructEvent']>;
type Owned = Prisma.ReservationGetPayload<{
  include: { access: true; locker: true };
}>;
function lockIntent(tx: Prisma.TransactionClient, id: string) {
  return tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
}
const missing = () => new NotFoundException('Reservation resource not found');
const terminal = (r: { status: string; expiresAt: Date }) =>
  r.status === 'CANCELLED' ||
  r.status === 'EXPIRED' ||
  (r.status === 'HOLD' && r.expiresAt.getTime() <= Date.now());

@Injectable()
export class PaymentsService {
  private stripe: StripeClient;
  private sweeping = false;
  constructor(
    private prisma: PrismaService,
    private cache: RedisCacheService,
  ) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2026-03-25.dahlia',
    });
  }
  async owner(id: string, hash?: string) {
    if (typeof id !== 'string' || !hash) throw missing();
    const r = await this.prisma.reservation.findUnique({
      where: { id },
      include: { access: true, locker: true },
    });
    if (!r?.access || r.access.tokenHash !== hash) throw missing();
    return r;
  }
  async snapshot(id: string, hash: string) {
    const r = await this.owner(id, hash),
      a = r.access!;
    return {
      id: r.id,
      lockerId: r.lockerId,
      locker: { code: r.locker.code, location: r.locker.location },
      startTime: r.startTime,
      endTime: r.endTime,
      expiresAt: r.expiresAt,
      serverNow: new Date(),
      status: terminal(r) && r.status === 'HOLD' ? 'EXPIRED' : r.status,
      paymentState: a.paymentState,
      hasPayment: !!a.paymentIntentId,
      canPay:
        r.status === 'HOLD' &&
        !terminal(r) &&
        !a.revokedAt &&
        a.paymentState === 'UNPAID',
      reconciliationRequired: a.paymentState === 'RECONCILIATION_REQUIRED',
      amount: a.expectedAmount,
      currency: a.currency,
    };
  }
  async recover(requestKey: string, hash: string) {
    const a = await this.prisma.customerReservationAccess.findUnique({
      where: { requestKey },
    });
    if (!a || a.tokenHash !== hash) throw missing();
    return this.status(a.reservationId, hash);
  }
  async status(id: string, hash: string) {
    await this.owner(id, hash);
    await this.reconcileReservation(id);
    return this.snapshot(id, hash);
  }
  async createPaymentIntent(id: string, hash?: string) {
    const r = await this.owner(id, hash),
      a = r.access!;
    if (r.status !== 'HOLD' || terminal(r) || a.revokedAt)
      throw new BadRequestException('Reservation is no longer payable');
    if (!a.paymentIntentId) {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: a.expectedAmount,
          currency: a.currency,
          metadata: { reservationId: id },
        },
        { idempotencyKey: `reservation:${id}` },
      );
      // Bind before releasing a secret, including if cancellation won during Stripe work.
      await this.prisma.$transaction(async (tx) => {
        await lockIntent(tx, intent.id);
        await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${id} FOR UPDATE`;
        const current = await tx.customerReservationAccess.findUnique({
          where: { reservationId: id },
        });
        if (!current || current.tokenHash !== hash) throw missing();
        if (current.paymentIntentId && current.paymentIntentId !== intent.id)
          throw new ConflictException('Payment is already bound');
        await tx.customerReservationAccess.update({
          where: { reservationId: id },
          data: {
            paymentIntentId: intent.id,
            ...((await tx.paymentEvent.findFirst({
              where: { reversedIntentId: intent.id },
            }))
              ? {
                  revokedAt: new Date(),
                  paymentState: 'RECONCILIATION_REQUIRED',
                  reconciliationReason: 'PAYMENT_REVERSED',
                }
              : {}),
          },
        });
      });
    }
    // Retrieve current state rather than trusting a cached idempotent create response.
    const intent = await this.reconcileReservation(id),
      reservation = await this.snapshot(id, hash!);
    return {
      reservation,
      client_secret: reservation.canPay
        ? (intent?.client_secret ?? null)
        : null,
      amount: reservation.amount,
      currency: reservation.currency,
    };
  }
  private matches(r: Owned, intent: PaymentIntent) {
    const a = r.access;
    return (
      !!a &&
      intent.id === a.paymentIntentId &&
      intent.metadata?.reservationId === r.id &&
      intent.amount === a.expectedAmount &&
      intent.currency === a.currency &&
      (intent.status !== 'succeeded' ||
        intent.amount_received === a.expectedAmount)
    );
  }
  private async observe(
    tx: Prisma.TransactionClient,
    id: string,
    intent: PaymentIntent,
  ) {
    await lockIntent(tx, intent.id);
    await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${id} FOR UPDATE`;
    const r = await tx.reservation.findUnique({
      where: { id },
      include: { access: true, locker: true },
    });
    if (!r) throw missing();
    if (!r.access) return 'UNBOUND_LEGACY_PAYMENT';
    if (!r.access.paymentIntentId)
      throw new ServiceUnavailableException('Payment binding pending');
    if (!this.matches(r, intent))
      throw new BadRequestException('Payment verification failed');
    const a = r.access,
      now = new Date();
    if (intent.status === 'succeeded') {
      const alreadyPaid =
        !!a.paidAt && r.status === 'CONFIRMED' && !a.revokedAt;
      const payable =
        !terminal(r) &&
        !a.revokedAt &&
        r.expiresAt > now &&
        (r.status === 'HOLD' || r.status === 'CONFIRMED');
      if (alreadyPaid || payable) {
        if (r.status === 'HOLD')
          await tx.reservation.update({
            where: { id },
            data: { status: 'CONFIRMED' },
          });
        await tx.customerReservationAccess.update({
          where: { reservationId: id },
          data: {
            paymentState: 'SUCCEEDED',
            paidAt: a.paidAt ?? now,
            reconciliationReason: null,
            checkedAt: now,
          },
        });
        return 'PAID';
      }
      await tx.customerReservationAccess.update({
        where: { reservationId: id },
        data: {
          paymentState: 'RECONCILIATION_REQUIRED',
          reconciliationReason:
            a.reconciliationReason === 'PAYMENT_REVERSED'
              ? 'PAYMENT_REVERSED'
              : 'LATE_SUCCESS',
          revokedAt: a.revokedAt ?? now,
          checkedAt: now,
        },
      });
      return 'LATE_SUCCESS';
    }
    // A delayed failure/processing report cannot erase established payment proof.
    if (a.paidAt || a.paymentState === 'RECONCILIATION_REQUIRED')
      return 'UNCHANGED';
    const state =
      intent.status === 'canceled'
        ? 'CANCELED'
        : ![
              'requires_payment_method',
              'requires_confirmation',
              'requires_action',
            ].includes(intent.status)
          ? 'PROCESSING'
          : 'UNPAID';
    await tx.customerReservationAccess.update({
      where: { reservationId: id },
      data: {
        paymentState: state,
        checkedAt: now,
        ...(terminal(r) && { revokedAt: a.revokedAt ?? now }),
        reconciliationReason:
          terminal(r) && state !== 'CANCELED' ? 'CANCELLATION_PENDING' : null,
      },
    });
    return state;
  }
  async reconcileReservation(id: string) {
    const r = await this.prisma.reservation.findUnique({
      where: { id },
      include: { access: true, locker: true },
    });
    if (!r?.access?.paymentIntentId) return null;
    let intent = await this.stripe.paymentIntents.retrieve(
      r.access.paymentIntentId,
    );
    if (!this.matches(r, intent))
      throw new BadRequestException('Payment verification failed');
    if (
      (terminal(r) || r.access.revokedAt) &&
      intent.status !== 'succeeded' &&
      intent.status !== 'canceled'
    ) {
      try {
        intent = await this.stripe.paymentIntents.cancel(
          intent.id,
          {},
          { idempotencyKey: `reservation:${id}:cancel` },
        );
      } catch {
        intent = await this.stripe.paymentIntents.retrieve(intent.id);
      }
    }
    const outcome = await this.prisma.$transaction((tx) =>
      this.observe(tx, id, intent),
    );
    if (outcome === 'PAID')
      await this.cache.deleteByPattern('lockers:availability:*');
    return intent;
  }
  @Interval(5000)
  async reconcilePending() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const pending = await this.prisma.customerReservationAccess.findMany({
        where: {
          paymentIntentId: { not: null },
          paymentState: {
            notIn: ['SUCCEEDED', 'CANCELED', 'RECONCILIATION_REQUIRED'],
          },
          OR: [
            { paymentState: 'PROCESSING' },
            { revokedAt: { not: null } },
            {
              reservation: { is: { status: { in: ['CANCELLED', 'EXPIRED'] } } },
            },
            {
              reservation: {
                is: { status: 'HOLD', expiresAt: { lte: new Date() } },
              },
            },
          ],
        },
        orderBy: { checkedAt: { sort: 'asc', nulls: 'first' } },
        take: 25,
      });
      for (const a of pending) {
        try {
          await this.reconcileReservation(a.reservationId);
        } catch {
          /* Durable state remains pending for the next sweep. */
        } finally {
          await this.prisma.customerReservationAccess.update({
            where: { reservationId: a.reservationId },
            data: { checkedAt: new Date() },
          });
        }
      }
    } finally {
      this.sweeping = false;
    }
  }
  async handleWebhook(rawBody: Buffer | undefined, signature: string) {
    if (!rawBody || !signature || !process.env.STRIPE_WEBHOOK_SECRET)
      throw new BadRequestException('Invalid webhook');
    let event: StripeEvent;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      throw new BadRequestException('Webhook signature verification failed');
    }
    const outcome = await this.prisma.$transaction(async (tx) => {
      const inserted = await tx.paymentEvent.createMany({
        data: [{ stripeEventId: event.id }],
        skipDuplicates: true,
      });
      if (!inserted.count) return 'DUPLICATE';
      if (
        event.type === 'charge.refunded' ||
        event.type === 'charge.dispute.created'
      ) {
        const linked = event.data.object.payment_intent;
        const intentId = typeof linked === 'string' ? linked : linked?.id;
        if (intentId) {
          await lockIntent(tx, intentId);
          const a = await tx.customerReservationAccess.findUnique({
            where: { paymentIntentId: intentId },
          });
          if (a) {
            await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${a.reservationId} FOR UPDATE`;
            await tx.customerReservationAccess.update({
              where: { reservationId: a.reservationId },
              data: {
                revokedAt: new Date(),
                paymentState: 'RECONCILIATION_REQUIRED',
                reconciliationReason: 'PAYMENT_REVERSED',
              },
            });
          }
          await tx.paymentEvent.update({
            where: { stripeEventId: event.id },
            data: { reversedIntentId: intentId, outcome: 'PAYMENT_REVERSED' },
          });
        }
        return 'PAYMENT_REVERSED';
      }
      if (
        ![
          'payment_intent.succeeded',
          'payment_intent.processing',
          'payment_intent.payment_failed',
          'payment_intent.canceled',
        ].includes(event.type)
      )
        return 'IGNORED';
      const intent = event.data.object as PaymentIntent,
        id = intent.metadata?.reservationId;
      if (!id || typeof intent.id !== 'string')
        throw new BadRequestException('Missing payment association');
      if (
        (event.type === 'payment_intent.succeeded' &&
          intent.status !== 'succeeded') ||
        (event.type === 'payment_intent.processing' &&
          intent.status !== 'processing') ||
        (event.type === 'payment_intent.canceled' &&
          intent.status !== 'canceled') ||
        (event.type === 'payment_intent.payment_failed' &&
          intent.status !== 'requires_payment_method')
      )
        throw new BadRequestException('Payment event status mismatch');
      const result = await this.observe(tx, id, intent);
      await tx.paymentEvent.update({
        where: { stripeEventId: event.id },
        data: {
          outcome: result,
          reservationId: id,
          paymentIntentId: intent.id,
        },
      });
      return result;
    });
    if (outcome === 'PAID')
      await this.cache.deleteByPattern('lockers:availability:*');
    return outcome === 'DUPLICATE'
      ? { received: true, duplicate: true }
      : { received: true };
  }
}
