import {
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ReservationCredentialGuard } from '../customer/reservation-credential.guard';
import { bearerHash } from '../customer/access-policy';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Post('create-intent')
  @UseGuards(JwtAuthGuard, ReservationCredentialGuard)
  async createIntent(
    @Body() body: { reservationId: string },
    @Headers('authorization') header?: string,
  ) {
    return this.paymentsService.createPaymentIntent(
      body.reservationId,
      bearerHash(header),
    );
  }

  @Post('webhook')
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    return this.paymentsService.handleWebhook(req.rawBody, signature);
  }
}
