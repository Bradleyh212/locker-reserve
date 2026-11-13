import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { bearerHash } from '../customer/access-policy';
import { ReservationCredentialGuard } from '../customer/reservation-credential.guard';
import { PaymentsService } from './payments.service';
@Controller('public/payments')
@UseGuards(ReservationCredentialGuard)
export class PublicPaymentsController {
  constructor(private payments: PaymentsService) {}
  @Post('create-intent')
  create(
    @Body() body: { reservationId: string },
    @Headers('authorization') header?: string,
  ) {
    return this.payments.createPaymentIntent(
      body?.reservationId,
      bearerHash(header),
    );
  }
}
