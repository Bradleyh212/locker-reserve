import { Body, Controller, Post } from '@nestjs/common'
import { PaymentsService } from './payments.service'

@Controller('public/payments')
export class PublicPaymentsController {
	constructor(private paymentsService: PaymentsService) {}

	@Post('create-intent')
	async createIntent(@Body() body: { reservationId: string }) {
		return this.paymentsService.createPaymentIntent(body.reservationId)
	}
}
