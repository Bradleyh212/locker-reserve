import {
	Body,
	Controller,
	Headers,
	Post,
	Req,
} from '@nestjs/common'
import type { RawBodyRequest } from '@nestjs/common'
import type { Request } from 'express'
import { PaymentsService } from './payments.service'

@Controller('payments')
export class PaymentsController {
	constructor(private paymentsService: PaymentsService) {}

	@Post('create-intent')
	async createIntent(@Body() body: { reservationId: string }) {
		return this.paymentsService.createPaymentIntent(body.reservationId)
	}

	@Post('webhook')
	async handleWebhook(
		@Req() req: RawBodyRequest<Request>,
		@Headers('stripe-signature') signature: string,
	) {
		return this.paymentsService.handleWebhook(req.rawBody, signature)
	}
}